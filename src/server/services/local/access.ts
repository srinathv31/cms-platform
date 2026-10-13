import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import {
  changeRoles,
  keepInactive,
  lastAdminRefusal,
  reinstate,
  removeMember,
  suspendInactive,
} from "@/domain/access/members";
import {
  decideAccessRequest,
  requestAccess,
  requestPermission,
} from "@/domain/access/requests";
import { decideRecertItem, startRecert } from "@/domain/access/recertification";
import type {
  AccessEffect,
  MembershipChange,
  MembershipFacts,
  Named,
  Refused,
} from "@/domain/access-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  accessRequests,
  membershipRoles,
  memberships,
  recertifications,
  recertItems,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import type { AccessService } from "../access";
import { notMoved } from "../not-moved";
import type { TestHooks } from "../options";
import type { Changed, RequestContext } from "../types";
import {
  loadMembershipFacts,
  loadRecertFacts,
  loadRequestFacts,
  personNamed,
  teamNamed,
} from "./access-facts";
import { applyMembershipChange, writeAccessEffects } from "./access-effects";
import { check, permit, refuse, runCommand, type LocalDeps } from "./command";
import { runScheduledJobs } from "./sweeps";
import type { Tx } from "./transaction";

// Team access on this app's own database (src/server/services/access.ts says what each command promises). Each runs
// on the command kit (./command.ts): `authorize` reads the request, membership or review the input names only to
// learn its team and person, refuses one that's gone, and checks the permission on the team with the person as the
// subject; the one transaction re-reads the facts (./access-facts.ts), asks the domain (src/domain/access), and
// writes the change with its audit rows and notifications (./access-effects.ts), all dated by the backend's clock.
//
// The lazy trigger: reading the clock, once the permission check has passed, first runs the scheduled jobs at that
// instant (./sweeps.ts), each in its own transaction, so a deadline the clock already crossed (a past-due review,
// day 120) takes effect before the command reads its facts, and a refusal doesn't roll the sweep back. Only this
// implementation does it: the Java API runs them on a schedule, and no contract case relies on it.

const actorOf = (viewer: Viewer): Named => ({
  id: viewer.userId,
  name: viewer.name,
});

/** The membership, read only to learn its team and person for the permission check. */
async function findMembership(membershipId: string) {
  const [ref] = await db
    .select({ teamId: memberships.teamId, userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);
  return ref;
}

/** The team's memberships (any status), for the "at least one Team Admin" rule. */
const teamMembershipsOf = (tx: Tx, teamId: string) =>
  loadMembershipFacts(tx, eq(memberships.teamId, teamId));

/**
 * Another Team Admin's change committing between this command's read and its write, as a test's
 * `beforeCompareAndSet` asks for it: every other active Team Admin of the team loses the role (a Viewer if that
 * leaves them none). SQLite takes writes in turn, so only a test reaches this; the Java API, whose writes don't
 * take turns, locks the team row instead (decision 0062).
 */
async function demoteOtherAdmins(tx: Tx, teamId: string, keep: string) {
  for (const m of await teamMembershipsOf(tx, teamId)) {
    if (m.id === keep || m.status !== "active") continue;
    if (!m.roles.includes("team_admin")) continue;
    await tx
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, m.id),
          eq(membershipRoles.role, "team_admin"),
        ),
      );
    if (m.roles.length === 1)
      await tx
        .insert(membershipRoles)
        .values({ membershipId: m.id, role: "viewer" });
  }
}

/**
 * Writes a membership change with the last-admin guard: `before` is the team as the transaction read it, and once
 * the change is written the team must still have an active Team Admin if it had one (`lastAdminRefusal`), or the
 * command is refused `last_admin` and its writes roll back.
 */
async function writeGuardedChange(
  tx: Tx,
  change: MembershipChange,
  guard: { team: Named; before: readonly MembershipFacts[]; hooks: TestHooks },
) {
  const { team, before, hooks } = guard;
  if (
    change.kind !== "insert" &&
    hooks.beforeCompareAndSet?.({
      table: "memberships",
      id: change.membershipId,
    }) === "competing_write"
  )
    await demoteOtherAdmins(tx, team.id, change.membershipId);
  await applyMembershipChange(tx, change);
  const lost = lastAdminRefusal(
    team,
    before,
    await teamMembershipsOf(tx, team.id),
  );
  if (lost) refuse(lost);
}

/** Writes the effects of an access command, dated by its clock, with the viewer as the actor. */
const writeEffectsOf = (
  tx: Tx,
  effects: readonly AccessEffect[],
  now: Date,
  viewer: Viewer,
) => writeAccessEffects(tx, effects, { now, actorId: viewer.userId });

/** What a member transition is decided with: the membership, its team's memberships, the member and the team. */
interface MemberFacts {
  membership: MembershipFacts;
  teamMemberships: MembershipFacts[];
  member: Named;
  team: Named;
  actor: Named;
  now: Date;
}

type MemberOutcome =
  | { ok: true; membership: MembershipChange | null; effects: AccessEffect[] }
  | Refused;

export function localAccess(deps: LocalDeps): AccessService {
  // The access commands' clock: the backend's, and reading it runs the scheduled jobs at that instant first.
  const commandDeps: LocalDeps = {
    ...deps,
    clock: async () => {
      const now = await deps.clock();
      await runScheduledJobs(now);
      return now;
    },
  };

  /**
   * A member command: find the membership, check `team.manageMembers` on its team with the member as the
   * subject, then decide the transition on the facts read in the transaction and write it, guarded.
   */
  function memberCommand<I extends { membershipId: string }>(
    ctx: RequestContext,
    input: I,
    transition: (facts: MemberFacts, input: I) => MemberOutcome,
  ): Promise<ActionResult<Changed>> {
    return runCommand(commandDeps, ctx, input, {
      authorize: async ({ ctx, input }) => {
        const ref = await findMembership(input.membershipId);
        if (!ref) refuse(ACCESS_REFUSALS.noLongerMember);
        check(ctx.viewer, "team.manageMembers", {
          teamId: ref.teamId,
          subjectUserId: ref.userId,
        });
      },
      transaction: async (tx, { ctx, input, now }) => {
        const [ref] = await tx
          .select({ teamId: memberships.teamId })
          .from(memberships)
          .where(eq(memberships.id, input.membershipId))
          .limit(1);
        if (!ref) refuse(ACCESS_REFUSALS.noLongerMember);
        const teamMemberships = await teamMembershipsOf(tx, ref.teamId);
        const membership = teamMemberships.find(
          (m) => m.id === input.membershipId,
        )!;
        const team =
          (await teamNamed(tx, ref.teamId)) ??
          refuse(REQUEST_REFUSALS.teamGone);
        const outcome = transition(
          {
            membership,
            teamMemberships,
            member: await personNamed(tx, membership.userId),
            team,
            actor: actorOf(ctx.viewer),
            now,
          },
          input,
        );
        if (!outcome.ok) refuse(outcome);
        if (outcome.membership)
          await writeGuardedChange(tx, outcome.membership, {
            team,
            before: teamMemberships,
            hooks: deps.hooks,
          });
        await writeEffectsOf(tx, outcome.effects, now, ctx.viewer);
        return {
          ok: true,
          changed: outcome.membership !== null || outcome.effects.length > 0,
        };
      },
    });
  }

  /** A member command that always changes something or refuses: it answers no `changed`. */
  const memberChange = <I extends { membershipId: string }>(
    ctx: RequestContext,
    input: I,
    transition: (facts: MemberFacts, input: I) => MemberOutcome,
  ): Promise<ActionResult> =>
    memberCommand(ctx, input, transition).then((result) =>
      result.ok ? { ok: true } : result,
    );

  return {
    requestAccess: (ctx, input) =>
      runCommand(commandDeps, ctx, input, {
        authorize: ({ ctx, input }) =>
          permit(requestPermission(ctx.viewer, input.teamId)),
        transaction: async (
          tx,
          { ctx, input, now },
        ): Promise<ActionResult<{ requestId: string }>> => {
          const team =
            (await teamNamed(tx, input.teamId)) ??
            refuse(REQUEST_REFUSALS.teamGone);
          const outcome = requestAccess({
            requester: actorOf(ctx.viewer),
            team,
            role: input.role,
            reason: input.reason,
            now,
            memberships: await loadMembershipFacts(
              tx,
              eq(memberships.userId, ctx.viewer.userId),
            ),
            requests: await loadRequestFacts(
              tx,
              eq(accessRequests.userId, ctx.viewer.userId),
            ),
          });
          if (!outcome.ok) refuse(outcome);
          const requestId = newId("ar");
          await tx.insert(accessRequests).values({
            id: requestId,
            ...outcome.request,
            status: "pending",
            decidedBy: null,
            decidedAt: null,
            decisionNote: null,
          });
          await writeEffectsOf(tx, outcome.effects, now, ctx.viewer);
          return { ok: true, requestId };
        },
      }),

    decideRequest: (ctx, input) =>
      runCommand(commandDeps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const [ref] = await db
            .select({
              teamId: accessRequests.teamId,
              userId: accessRequests.userId,
            })
            .from(accessRequests)
            .where(eq(accessRequests.id, input.requestId))
            .limit(1);
          if (!ref) refuse(REQUEST_REFUSALS.requestGone);
          check(ctx.viewer, "team.decideAccessRequest", {
            teamId: ref.teamId,
            requesterId: ref.userId,
          });
        },
        transaction: async (tx, { ctx, input, now }): Promise<ActionResult> => {
          const [request] = await loadRequestFacts(
            tx,
            eq(accessRequests.id, input.requestId),
          );
          if (!request) refuse(REQUEST_REFUSALS.requestGone);
          const team =
            (await teamNamed(tx, request.teamId)) ??
            refuse(REQUEST_REFUSALS.teamGone);
          const [membership] = await loadMembershipFacts(
            tx,
            and(
              eq(memberships.userId, request.userId),
              eq(memberships.teamId, request.teamId),
            ),
          );
          const outcome = decideAccessRequest({
            request,
            requester: await personNamed(tx, request.userId),
            team,
            actor: actorOf(ctx.viewer),
            decision: input.decision,
            note: input.note ?? null,
            now,
            membership: membership ?? null,
          });
          if (!outcome.ok) refuse(outcome);
          // A colleague deciding it between this read and the write (a test's hook stands in for it here).
          if (
            deps.hooks.beforeCompareAndSet?.({
              table: "access_requests",
              id: request.id,
            }) === "competing_write"
          )
            await tx
              .update(accessRequests)
              .set({ status: "denied" })
              .where(eq(accessRequests.id, request.id));
          // Compare-and-set on the pending status: a colleague deciding first wins.
          const updated = await tx
            .update(accessRequests)
            .set(outcome.request)
            .where(
              and(
                eq(accessRequests.id, request.id),
                eq(accessRequests.status, "pending"),
              ),
            )
            .returning({ id: accessRequests.id });
          if (updated.length === 0) refuse(ACCESS_REFUSALS.decided);
          if (outcome.membership)
            await applyMembershipChange(tx, outcome.membership);
          await writeEffectsOf(tx, outcome.effects, now, ctx.viewer);
          return { ok: true };
        },
      }),

    changeRoles: (ctx, input) =>
      memberCommand(ctx, input, (facts, { roles }) =>
        changeRoles({ ...facts, roles }),
      ),
    removeMember: (ctx, input) =>
      memberChange(ctx, input, (facts) => removeMember(facts)),
    reinstateMember: (ctx, input) =>
      memberChange(ctx, input, (facts) => reinstate(facts)),
    suspendInactive: (ctx, input) =>
      memberChange(ctx, input, (facts) => suspendInactive(facts)),
    keepInactive: (ctx, input) =>
      memberChange(ctx, input, (facts) => keepInactive(facts)),

    decideRecertItem: (ctx, input) =>
      runCommand(commandDeps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const [ref] = await db
            .select({ teamId: recertifications.teamId })
            .from(recertifications)
            .where(eq(recertifications.id, input.recertId))
            .limit(1);
          if (!ref) refuse(REQUEST_REFUSALS.reviewGone);
          check(ctx.viewer, "team.manageMembers", {
            teamId: ref.teamId,
            subjectUserId: input.userId,
          });
        },
        transaction: async (
          tx,
          { ctx, input: { recertId, userId, decision }, now },
        ): Promise<ActionResult> => {
          const [recert] = await loadRecertFacts(
            tx,
            eq(recertifications.id, recertId),
          );
          if (!recert) refuse(REQUEST_REFUSALS.reviewGone);
          const team =
            (await teamNamed(tx, recert.teamId)) ??
            refuse(REQUEST_REFUSALS.teamGone);
          const teamMemberships = await teamMembershipsOf(tx, recert.teamId);
          const outcome = decideRecertItem({
            recert,
            userId,
            member: await personNamed(tx, userId),
            team,
            actor: actorOf(ctx.viewer),
            decision,
            now,
            teamMemberships,
          });
          if (!outcome.ok) refuse(outcome);
          // Another decision on the item between this read and the write (a test's hook stands in for it here).
          if (
            deps.hooks.beforeCompareAndSet?.({
              table: "recert_items",
              id: `${recertId}:${userId}`,
            }) === "competing_write"
          )
            await tx
              .update(recertItems)
              .set({ decision: "keep" })
              .where(
                and(
                  eq(recertItems.recertId, recertId),
                  eq(recertItems.userId, userId),
                ),
              );
          // Compare-and-set on the undecided item: a second decision is refused.
          const updated = await tx
            .update(recertItems)
            .set(outcome.item)
            .where(
              and(
                eq(recertItems.recertId, recertId),
                eq(recertItems.userId, userId),
                isNull(recertItems.decision),
              ),
            )
            .returning({ userId: recertItems.userId });
          if (updated.length === 0) refuse(ACCESS_REFUSALS.alreadyReviewed);
          if (outcome.completedAt) {
            await tx
              .update(recertifications)
              .set({ completedAt: outcome.completedAt })
              .where(
                and(
                  eq(recertifications.id, recertId),
                  isNull(recertifications.completedAt),
                ),
              );
          }
          if (outcome.membership)
            await writeGuardedChange(tx, outcome.membership, {
              team,
              before: teamMemberships,
              hooks: deps.hooks,
            });
          await writeEffectsOf(tx, outcome.effects, now, ctx.viewer);
          return { ok: true };
        },
      }),

    startRecertification: (ctx, input) =>
      runCommand(commandDeps, ctx, input, {
        authorize: ({ ctx, input }) =>
          check(ctx.viewer, "team.manageMembers", { teamId: input.teamId }),
        transaction: async (
          tx,
          { ctx, input, now },
        ): Promise<ActionResult<{ recertId: string }>> => {
          const team =
            (await teamNamed(tx, input.teamId)) ??
            refuse(REQUEST_REFUSALS.teamGone);
          const outcome = startRecert({
            team,
            actor: actorOf(ctx.viewer),
            now,
            memberships: await teamMembershipsOf(tx, team.id),
            unfinished: await loadRecertFacts(
              tx,
              and(
                eq(recertifications.teamId, team.id),
                isNull(recertifications.completedAt),
              ),
            ),
          });
          if (!outcome.ok) refuse(outcome);
          const recertId = newId("rc");
          const { items, ...recert } = outcome.recert;
          await tx
            .insert(recertifications)
            .values({ id: recertId, ...recert, completedAt: null });
          await tx
            .insert(recertItems)
            .values(items.map((item) => ({ recertId, ...item })));
          await writeEffectsOf(tx, outcome.effects, now, ctx.viewer);
          return { ok: true, recertId };
        },
      }),

    requestAccessData: notMoved("access.requestAccessData"),
    members: notMoved("access.members"),
    requests: notMoved("access.requests"),
    recertification: notMoved("access.recertification"),
    inactivity: notMoved("access.inactivity"),
    sidebarCards: notMoved("access.sidebarCards"),
    homeCard: notMoved("access.homeCard"),
  };
}
