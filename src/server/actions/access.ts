"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  ACCESS_REFUSALS,
  changeRoles,
  decideAccessRequest as decideRequestTransition,
  decideRecertItem as decideRecertTransition,
  keepInactive as keepTransition,
  reinstate as reinstateTransition,
  removeMember as removeTransition,
  requestAccess as requestTransition,
  startRecert,
  suspendInactive as suspendTransition,
} from "@/domain/access";
import {
  ACCESS_REASON_MAX,
  DECISION_NOTE_MAX,
  type AccessEffect,
  type ActionResult,
  type MembershipChange,
  type Named,
  type RecertDecision,
  type RequestableRole,
} from "@/domain/access-types";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS, type Refused } from "@/domain/refusals";
import { TEAM_ROLES, type TeamRole, type Viewer } from "@/domain/types";
import { applyMembershipChange, writeAccessEffects } from "@/server/access-effects";
import { loadMembershipFacts, loadRecertFacts, loadRequestFacts, runAccessSweep } from "@/server/access-sweep";
import { db } from "@/server/db/client";
import { accessRequests, memberships, recertifications, recertItems, teams, users } from "@/server/db/schema/ucomp";
import type { Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import { runSunsetSweep } from "@/server/sunset-sweep";
import { check, refuse, serverAction, type ActionSteps } from "./kit";

// Team access: requesting and deciding access, members, inactivity and recertification.
//
// Every action runs the server action kit (kit.ts) through `accessAction`:
//   1. `authorize`: the request, membership or review the input names, read to learn its team and
//      person. One that's gone is refused with its own sentence (a colleague acting first removes it).
//      Then the permission check on the team, server-side, with the subject (nobody decides their own
//      request or changes their own access);
//   2. the access sweep, on its own, then ONE transaction that re-reads the facts, asks the domain
//      (domain/access.ts), and writes the change with its audit rows and notifications
//      (server/access-effects.ts);
//   3. `revalidatePath("/", "layout")` + `refresh()`: the switcher summaries, the sidebar card and
//      the settings sections all move.
// A double click or a colleague acting first is refused with the domain's sentence and writes nothing.
// A "use server" file may export only async functions: the helpers below stay private.

// ── Helpers ───────────────────────────────────────────────────

function refreshAfter() {
  revalidatePath("/", "layout");
  refresh();
}

/**
 * The access sweep, on its own before the action's transaction (a refusal mustn't roll it back), so a
 * deadline the demo clock already crossed (a past-due review, day 120) takes effect before the action
 * reads its facts. The sunset sweep runs beside it, in its own transaction too. When either changed
 * something, the pages refresh whatever the action answers.
 */
async function sweep(): Promise<boolean> {
  const swept = await runAccessSweep();
  const sunsets = await runSunsetSweep();
  const changed = swept.membershipChanges.length > 0 || swept.recertsClosed.length > 0 || sunsets.length > 0;
  if (changed) refreshAfter();
  return changed;
}

/**
 * An access action on the kit: input that doesn't parse is refused with the parser's first problem,
 * the sweep runs once the permission check has passed, and the pages refresh once.
 */
function accessAction<I, F, T extends object = Record<never, never>>(
  raw: unknown,
  steps: Pick<ActionSteps<I, F, T>, "input" | "invalid" | "authorize" | "transaction">,
): Promise<ActionResult<T>> {
  let swept = false;
  return serverAction(raw, {
    invalid: (error) => REQUEST_REFUSALS.invalidInput(error.issues[0]?.message),
    ...steps,
    authorize: async (ctx) => {
      const found = await steps.authorize(ctx);
      swept = await sweep();
      return found;
    },
    after: () => {
      if (!swept) refreshAfter();
    },
  });
}

async function teamNamed(tx: Tx, id: string): Promise<Named | null> {
  const rows = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The person by id; a stand-in built from the id when the user row is gone. */
async function personNamed(tx: Tx, id: string): Promise<Named> {
  const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? { id, name: id };
}

const actorOf = (viewer: Viewer): Named => ({ id: viewer.userId, name: viewer.name });

async function isAuditor(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx.select({ platformRole: users.platformRole }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.platformRole === "auditor";
}

/** Writes a domain result: the membership change, then the audit rows and notifications. */
async function commit(tx: Tx, change: MembershipChange | null, effects: readonly AccessEffect[], at: Date, viewer: Viewer) {
  if (change) await applyMembershipChange(tx, change);
  await writeAccessEffects(tx, effects, { now: at, actorId: viewer.userId });
}

const Id = z.string().min(1).max(64);

/** The membership, read only to learn its team and person for the permission check. */
async function findMembership(membershipId: string) {
  return db
    .select({ id: memberships.id, teamId: memberships.teamId, userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
    .then((rows) => rows[0]);
}

/** Inside the transaction: the membership again, every membership on its team, the person and the team. */
async function memberContext(tx: Tx, membershipId: string) {
  const ref = await tx
    .select({ teamId: memberships.teamId })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!ref) refuse(ACCESS_REFUSALS.noLongerMember);
  const teamMemberships = await loadMembershipFacts(tx, eq(memberships.teamId, ref.teamId));
  const membership = teamMemberships.find((m) => m.id === membershipId)!;
  const member = await personNamed(tx, membership.userId);
  const team = (await teamNamed(tx, membership.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
  return { membership, teamMemberships, member, team };
}

type MemberContext = Awaited<ReturnType<typeof memberContext>> & { actor: Named; now: Date };
type MemberOutcome = { ok: true; membership: MembershipChange | null; effects: AccessEffect[] } | Refused;

const MemberInput = z.object({ membershipId: Id });

/**
 * The shared shape of the five member actions: find the membership, check `team.manageMembers` on its
 * team with the member as the subject, then run the domain transition inside one transaction.
 */
async function memberAction<I extends { membershipId: string }>(
  raw: unknown,
  steps: Pick<ActionSteps<I, void, Record<never, never>>, "input" | "invalid"> & {
    transition: (ctx: MemberContext, input: I) => MemberOutcome;
  },
): Promise<ActionResult> {
  return accessAction(raw, {
    input: steps.input,
    ...(steps.invalid ? { invalid: steps.invalid } : {}),
    authorize: async ({ viewer, input }) => {
      const ref = await findMembership(input.membershipId);
      if (!ref) refuse(ACCESS_REFUSALS.noLongerMember);
      check(viewer, "team.manageMembers", { teamId: ref.teamId, subjectUserId: ref.userId });
    },
    transaction: async (tx, { viewer, input, now: at }) => {
      const ctx = await memberContext(tx, input.membershipId);
      const outcome = steps.transition({ ...ctx, actor: actorOf(viewer), now: at }, input);
      if (!outcome.ok) refuse(outcome);
      await commit(tx, outcome.membership, outcome.effects, at, viewer);
      return { ok: true };
    },
  });
}

// ── Requesting and deciding access ───────────────────────────

const RequestInput = z.object({
  teamId: Id,
  // Any team role parses; the domain refuses one that can't be requested (`pick_requestable_role`).
  role: z.enum(TEAM_ROLES),
  reason: z.string().max(ACCESS_REASON_MAX * 2),
});

/** Anyone asks for Viewer, Author or Approver on a team, with a reason. The team's Team Admins are told. */
export async function requestAccess(input: {
  teamId: string;
  role: RequestableRole;
  reason: string;
}): Promise<ActionResult<{ requestId: string }>> {
  return accessAction(input, {
    input: RequestInput,
    authorize: ({ viewer, input }) => {
      // The Auditor is read-only everywhere: no team role for them, so no request either (said plainly).
      if (viewer.platformRole === "auditor") refuse(REASONS.auditorReadOnly);
      check(viewer, "access.request", { teamId: input.teamId });
    },
    transaction: async (tx, { viewer, input, now: at }) => {
      const team = (await teamNamed(tx, input.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
      const outcome = requestTransition({
        requester: actorOf(viewer),
        team,
        role: input.role,
        reason: input.reason,
        now: at,
        memberships: await loadMembershipFacts(tx, eq(memberships.userId, viewer.userId)),
        requests: await loadRequestFacts(tx, eq(accessRequests.userId, viewer.userId)),
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
      await commit(tx, null, outcome.effects, at, viewer);
      return { ok: true, requestId };
    },
  });
}

const DecideInput = z.object({
  requestId: Id,
  decision: z.enum(["approve", "deny"]),
  note: z.string().max(DECISION_NOTE_MAX * 2).optional(),
});

/** A Team Admin approves (membership created, extended or reinstated) or denies (with a note) a request. */
export async function decideAccessRequest(input: {
  requestId: string;
  decision: "approve" | "deny";
  note?: string;
}): Promise<ActionResult> {
  return accessAction(input, {
    input: DecideInput,
    authorize: async ({ viewer, input }) => {
      const ref = await db
        .select({ teamId: accessRequests.teamId, userId: accessRequests.userId })
        .from(accessRequests)
        .where(eq(accessRequests.id, input.requestId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!ref) refuse(REQUEST_REFUSALS.requestGone);
      check(viewer, "team.decideAccessRequest", { teamId: ref.teamId, requesterId: ref.userId });
    },
    transaction: async (tx, { viewer, input, now: at }) => {
      const [request] = await loadRequestFacts(tx, eq(accessRequests.id, input.requestId));
      if (!request) refuse(REQUEST_REFUSALS.requestGone);
      const team = (await teamNamed(tx, request.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
      const requester = await personNamed(tx, request.userId);
      // A request made before the requester became an Auditor (or written around the request check)
      // can't be approved: an Auditor holds no team role. Denying it still works.
      if (input.decision === "approve" && (await isAuditor(tx, request.userId))) {
        refuse(ACCESS_REFUSALS.auditorRequester(requester.name));
      }
      const [membership] = await loadMembershipFacts(
        tx,
        and(eq(memberships.userId, request.userId), eq(memberships.teamId, request.teamId)),
      );
      const outcome = decideRequestTransition({
        request,
        requester,
        team,
        actor: actorOf(viewer),
        decision: input.decision,
        note: input.note ?? null,
        now: at,
        membership: membership ?? null,
      });
      if (!outcome.ok) refuse(outcome);
      // Compare-and-set on the pending status: a colleague deciding first wins.
      const updated = await tx
        .update(accessRequests)
        .set(outcome.request)
        .where(and(eq(accessRequests.id, request.id), eq(accessRequests.status, "pending")))
        .returning({ id: accessRequests.id });
      if (updated.length === 0) refuse(ACCESS_REFUSALS.decided);
      await commit(tx, outcome.membership, outcome.effects, at, viewer);
      return { ok: true };
    },
  });
}

// ── Members and inactivity ───────────────────────────────────

const RolesInput = MemberInput.extend({ roles: z.array(z.enum(TEAM_ROLES)).max(TEAM_ROLES.length) });

/** Replace a member's roles. A team keeps at least one active Team Admin. */
export async function changeMemberRoles(input: { membershipId: string; roles: TeamRole[] }): Promise<ActionResult> {
  return memberAction(input, {
    input: RolesInput,
    // Roles that don't parse are asked for again, whatever else is wrong.
    invalid: (error) =>
      error.issues.some((issue) => issue.path[0] === "roles")
        ? ACCESS_REFUSALS.pickRoles
        : REQUEST_REFUSALS.invalidInput(error.issues[0]?.message),
    transition: (ctx, { roles }) => changeRoles({ ...ctx, roles }),
  });
}

/** Remove a member: the membership is deleted. */
export async function removeMember(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, { input: MemberInput, transition: (ctx) => removeTransition(ctx) });
}

/** Restore a suspended or lapsed member with their previous roles (their inactivity clock restarts). */
export async function reinstateMember(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, { input: MemberInput, transition: (ctx) => reinstateTransition(ctx) });
}

/** Suspend a member flagged for inactivity (90 days or more without a sign-in). */
export async function suspendInactive(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, { input: MemberInput, transition: (ctx) => suspendTransition(ctx) });
}

/** Keep a flagged member: their inactivity clock restarts now. */
export async function keepInactive(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, { input: MemberInput, transition: (ctx) => keepTransition(ctx) });
}

// ── Recertification ──────────────────────────────────────────

const RecertItemInput = z.object({ recertId: Id, userId: Id, decision: z.enum(["keep", "remove"]) });

/** Keep or Remove one member in an open review. Remove ends access at once; the last decision closes it. */
export async function decideRecertItem(input: {
  recertId: string;
  userId: string;
  decision: RecertDecision;
}): Promise<ActionResult> {
  return accessAction(input, {
    input: RecertItemInput,
    authorize: async ({ viewer, input }) => {
      const ref = await db
        .select({ teamId: recertifications.teamId })
        .from(recertifications)
        .where(eq(recertifications.id, input.recertId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!ref) refuse(REQUEST_REFUSALS.reviewGone);
      check(viewer, "team.manageMembers", { teamId: ref.teamId, subjectUserId: input.userId });
    },
    transaction: async (tx, { viewer, input: { recertId, userId, decision }, now: at }) => {
      const [recert] = await loadRecertFacts(tx, eq(recertifications.id, recertId));
      if (!recert) refuse(REQUEST_REFUSALS.reviewGone);
      const team = (await teamNamed(tx, recert.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
      const member = await personNamed(tx, userId);
      const teamMemberships = await loadMembershipFacts(tx, eq(memberships.teamId, recert.teamId));
      const outcome = decideRecertTransition({
        recert,
        userId,
        member,
        team,
        actor: actorOf(viewer),
        decision,
        now: at,
        teamMemberships,
      });
      if (!outcome.ok) refuse(outcome);
      const updated = await tx
        .update(recertItems)
        .set(outcome.item)
        .where(and(eq(recertItems.recertId, recertId), eq(recertItems.userId, userId), isNull(recertItems.decision)))
        .returning({ userId: recertItems.userId });
      if (updated.length === 0) refuse(ACCESS_REFUSALS.alreadyReviewed);
      if (outcome.completedAt) {
        await tx
          .update(recertifications)
          .set({ completedAt: outcome.completedAt })
          .where(and(eq(recertifications.id, recertId), isNull(recertifications.completedAt)));
      }
      await commit(tx, outcome.membership, outcome.effects, at, viewer);
      return { ok: true };
    },
  });
}

/** Start a review now, due in 30 days, covering the team's members (Team Admins aside). */
export async function startRecertification(input: { teamId: string }): Promise<ActionResult<{ recertId: string }>> {
  return accessAction(input, {
    input: z.object({ teamId: Id }),
    authorize: ({ viewer, input }) => check(viewer, "team.manageMembers", { teamId: input.teamId }),
    transaction: async (tx, { viewer, input, now: at }) => {
      const team = (await teamNamed(tx, input.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
      const outcome = startRecert({
        team,
        actor: actorOf(viewer),
        now: at,
        memberships: await loadMembershipFacts(tx, eq(memberships.teamId, team.id)),
        unfinished: await loadRecertFacts(
          tx,
          and(eq(recertifications.teamId, team.id), isNull(recertifications.completedAt)),
        ),
      });
      if (!outcome.ok) refuse(outcome);
      const recertId = newId("rc");
      const { items, ...recert } = outcome.recert;
      await tx.insert(recertifications).values({ id: recertId, ...recert, completedAt: null });
      await tx.insert(recertItems).values(items.map((item) => ({ recertId, ...item })));
      await commit(tx, null, outcome.effects, at, viewer);
      return { ok: true, recertId };
    },
  });
}
