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
import { sortRoles } from "@/domain/access/roles";
import type {
  AccessEffect,
  AccessRequestFacts,
  MembershipChange,
  MembershipFacts,
  Named,
  RecertFacts,
  Refused,
} from "@/domain/access-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { PlatformRole, Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import type { AccessService } from "../access";
import { notMoved } from "../not-moved";
import type { TestHooks } from "../options";
import { answerFor, check, permit, refuse } from "../refuse";
import type { Changed, RequestContext } from "../types";
import { writeFakeAccessEffects } from "./access-effects";
import type { FakeDeps } from "./index";
import type {
  AccessRequestRow,
  FakeState,
  MembershipRow,
  RecertificationRow,
} from "./state";
import type { FakeTx } from "./store";

// Team access in memory: the twin of services/local/access.ts, the same steps in the same order and the same domain
// rules (src/domain/access), over the fake's arrays. The facts are loaded as services/local/access-facts.ts loads
// them, in the same order. It has no lazy trigger: the scheduled jobs run only when a case runs them
// (`runScheduledJobs`), as on the Java API.

/** SQLite's default (BINARY) order, which the local implementation's ORDER BY uses. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── The facts (services/local/access-facts.ts) ────────────────

/** Memberships (any status) with their roles and the member's last sign-in, those `where` keeps. Ordered by id. */
export function membershipFacts(
  state: FakeState,
  where: (m: MembershipRow) => boolean = () => true,
): MembershipFacts[] {
  return state.memberships
    .filter(where)
    .flatMap((m) => {
      const user = state.users.find((u) => u.id === m.userId);
      if (!user) return [];
      return [
        {
          id: m.id,
          userId: m.userId,
          teamId: m.teamId,
          status: m.status,
          statusReason: m.statusReason,
          statusChangedAt: m.statusChangedAt,
          addedAt: m.addedAt,
          lastActiveAt: user.lastActiveAt,
          inactivityFlaggedAt: m.inactivityFlaggedAt,
          inactivityKeptAt: m.inactivityKeptAt,
          roles: sortRoles(
            state.membershipRoles
              .filter((r) => r.membershipId === m.id)
              .map((r) => r.role),
          ),
        },
      ];
    })
    .sort((a, b) => byCodePoint(a.id, b.id));
}

/** Recertifications with their items, those `where` keeps. Ordered by start, then id; items by user id. */
export function recertFacts(
  state: FakeState,
  where: (r: RecertificationRow) => boolean = () => true,
): RecertFacts[] {
  return state.recertifications
    .filter(where)
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() || byCodePoint(a.id, b.id),
    )
    .map((x) => ({
      id: x.id,
      teamId: x.teamId,
      label: x.label,
      startsAt: x.startsAt,
      dueAt: x.dueAt,
      completedAt: x.completedAt,
      items: state.recertItems
        .filter((i) => i.recertId === x.id)
        .sort((a, b) => byCodePoint(a.userId, b.userId))
        .map((i) => ({
          userId: i.userId,
          decision: i.decision,
          decidedBy: i.decidedBy,
          decidedAt: i.decidedAt,
        })),
    }));
}

/** Access requests, those `where` keeps. Oldest first, then by id. */
export function requestFacts(
  state: FakeState,
  where: (r: AccessRequestRow) => boolean = () => true,
): AccessRequestFacts[] {
  return state.accessRequests
    .filter(where)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        byCodePoint(a.id, b.id),
    )
    .map((r) => ({ ...r }));
}

/** The team by id, or null. */
export function teamNamed(state: FakeState, id: string): Named | null {
  const team = state.teams.find((t) => t.id === id);
  return team ? { id: team.id, name: team.name } : null;
}

/** The person by id, with their platform role; a stand-in built from the id when the user row is gone. */
export function personNamed(
  state: FakeState,
  id: string,
): Named & { platformRole: PlatformRole | null } {
  const user = state.users.find((u) => u.id === id);
  return user
    ? { id: user.id, name: user.name, platformRole: user.platformRole }
    : { id, name: id, platformRole: null };
}

// ── Writes (services/local/access-effects.ts `applyMembershipChange`) ──

/** Applies one membership change, as `applyMembershipChange` does: `roles` replaces the role rows. */
export function applyFakeMembershipChange(
  tx: FakeTx,
  change: MembershipChange,
): string {
  const { state } = tx;
  const replaceRoles = (membershipId: string, roles: readonly string[]) => {
    for (const row of state.membershipRoles.filter(
      (r) => r.membershipId === membershipId,
    ))
      tx.delete("membershipRoles", row);
    for (const role of roles)
      tx.insert("membershipRoles", {
        membershipId,
        role: role as MembershipFacts["roles"][number],
      });
  };
  switch (change.kind) {
    case "insert": {
      const id = newId("m");
      const { roles, ...row } = change.membership;
      tx.insert("memberships", {
        id,
        ...row,
        status: "active",
        statusChangedAt: null,
        statusReason: null,
        inactivityFlaggedAt: null,
        inactivityKeptAt: null,
      });
      replaceRoles(id, roles);
      return id;
    }
    case "update": {
      const { roles, ...set } = change.set;
      const row = state.memberships.find((m) => m.id === change.membershipId);
      if (row && Object.keys(set).length)
        tx.update("memberships", row, set as Partial<MembershipRow>);
      if (roles) replaceRoles(change.membershipId, roles);
      return change.membershipId;
    }
    case "delete": {
      replaceRoles(change.membershipId, []);
      const row = state.memberships.find((m) => m.id === change.membershipId);
      if (row) tx.delete("memberships", row);
      return change.membershipId;
    }
  }
}

// ── The command kit ───────────────────────────────────────────

/**
 * Runs one command as the local command kit does: the clock first, then the command, synchronously; a refusal,
 * raised or returned, undoes what it wrote and becomes the answer.
 */
export async function fakeCommand<T extends object>(
  deps: Pick<FakeDeps, "store" | "clock">,
  run: (tx: FakeTx, now: Date) => ActionResult<T>,
): Promise<ActionResult<T>> {
  const now = await deps.clock();
  try {
    return deps.store.command((tx) => {
      const answer = run(tx, now);
      if (!answer.ok) refuse(answer);
      return answer;
    });
  } catch (error) {
    return answerFor(error);
  }
}

const actorOf = (viewer: Viewer): Named => ({
  id: viewer.userId,
  name: viewer.name,
});

/** The twin of the local competing write: every other active Team Admin of the team loses the role. */
function demoteOtherAdmins(tx: FakeTx, teamId: string, keep: string) {
  for (const m of membershipFacts(tx.state, (m) => m.teamId === teamId)) {
    if (m.id === keep || m.status !== "active") continue;
    if (!m.roles.includes("team_admin")) continue;
    const row = tx.state.membershipRoles.find(
      (r) => r.membershipId === m.id && r.role === "team_admin",
    )!;
    tx.delete("membershipRoles", row);
    if (m.roles.length === 1)
      tx.insert("membershipRoles", { membershipId: m.id, role: "viewer" });
  }
}

/** A membership change with the last-admin guard, as the local `writeGuardedChange`. */
function writeGuardedChange(
  tx: FakeTx,
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
    demoteOtherAdmins(tx, team.id, change.membershipId);
  applyFakeMembershipChange(tx, change);
  const lost = lastAdminRefusal(
    team,
    before,
    membershipFacts(tx.state, (m) => m.teamId === team.id),
  );
  if (lost) refuse(lost);
}

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

export function fakeAccess(deps: FakeDeps): AccessService {
  const { hooks } = deps;
  const effectsOf = (
    tx: FakeTx,
    effects: readonly AccessEffect[],
    now: Date,
    viewer: Viewer,
  ) => writeFakeAccessEffects(tx, effects, { now, actorId: viewer.userId });

  function memberCommand<I extends { membershipId: string }>(
    ctx: RequestContext,
    input: I,
    transition: (facts: MemberFacts, input: I) => MemberOutcome,
  ): Promise<ActionResult<Changed>> {
    return fakeCommand(deps, (tx, now) => {
      const { state } = tx;
      const ref = state.memberships.find((m) => m.id === input.membershipId);
      if (!ref) refuse(ACCESS_REFUSALS.noLongerMember);
      check(ctx.viewer, "team.manageMembers", {
        teamId: ref.teamId,
        subjectUserId: ref.userId,
      });
      const teamMemberships = membershipFacts(
        state,
        (m) => m.teamId === ref.teamId,
      );
      const membership = teamMemberships.find(
        (m) => m.id === input.membershipId,
      )!;
      const team =
        teamNamed(state, ref.teamId) ?? refuse(REQUEST_REFUSALS.teamGone);
      const outcome = transition(
        {
          membership,
          teamMemberships,
          member: personNamed(state, membership.userId),
          team,
          actor: actorOf(ctx.viewer),
          now,
        },
        input,
      );
      if (!outcome.ok) refuse(outcome);
      if (outcome.membership)
        writeGuardedChange(tx, outcome.membership, {
          team,
          before: teamMemberships,
          hooks,
        });
      effectsOf(tx, outcome.effects, now, ctx.viewer);
      return {
        ok: true,
        changed: outcome.membership !== null || outcome.effects.length > 0,
      };
    });
  }

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
      fakeCommand(deps, (tx, now): ActionResult<{ requestId: string }> => {
        const { state } = tx;
        permit(requestPermission(ctx.viewer, input.teamId));
        const team =
          teamNamed(state, input.teamId) ?? refuse(REQUEST_REFUSALS.teamGone);
        const outcome = requestAccess({
          requester: actorOf(ctx.viewer),
          team,
          role: input.role,
          reason: input.reason,
          now,
          memberships: membershipFacts(
            state,
            (m) => m.userId === ctx.viewer.userId,
          ),
          requests: requestFacts(state, (r) => r.userId === ctx.viewer.userId),
        });
        if (!outcome.ok) refuse(outcome);
        const requestId = newId("ar");
        tx.insert("accessRequests", {
          id: requestId,
          ...outcome.request,
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        });
        effectsOf(tx, outcome.effects, now, ctx.viewer);
        return { ok: true, requestId };
      }),

    decideRequest: (ctx, input) =>
      fakeCommand(deps, (tx, now): ActionResult => {
        const { state } = tx;
        const row = state.accessRequests.find((r) => r.id === input.requestId);
        if (!row) refuse(REQUEST_REFUSALS.requestGone);
        check(ctx.viewer, "team.decideAccessRequest", {
          teamId: row.teamId,
          requesterId: row.userId,
        });
        const [request] = requestFacts(state, (r) => r.id === row.id);
        const team =
          teamNamed(state, request!.teamId) ??
          refuse(REQUEST_REFUSALS.teamGone);
        const [membership] = membershipFacts(
          state,
          (m) => m.userId === row.userId && m.teamId === row.teamId,
        );
        const outcome = decideAccessRequest({
          request: request!,
          requester: personNamed(state, row.userId),
          team,
          actor: actorOf(ctx.viewer),
          decision: input.decision,
          note: input.note ?? null,
          now,
          membership: membership ?? null,
        });
        if (!outcome.ok) refuse(outcome);
        // A colleague deciding it between this read and the write (a test's hook stands in for it).
        if (
          hooks.beforeCompareAndSet?.({
            table: "access_requests",
            id: row.id,
          }) === "competing_write"
        )
          tx.update("accessRequests", row, { status: "denied" });
        // Compare-and-set on the pending status: a colleague deciding first wins.
        if (row.status !== "pending") refuse(ACCESS_REFUSALS.decided);
        tx.update("accessRequests", row, outcome.request);
        if (outcome.membership)
          applyFakeMembershipChange(tx, outcome.membership);
        effectsOf(tx, outcome.effects, now, ctx.viewer);
        return { ok: true };
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

    decideRecertItem: (ctx, { recertId, userId, decision }) =>
      fakeCommand(deps, (tx, now): ActionResult => {
        const { state } = tx;
        const row = state.recertifications.find((r) => r.id === recertId);
        if (!row) refuse(REQUEST_REFUSALS.reviewGone);
        check(ctx.viewer, "team.manageMembers", {
          teamId: row.teamId,
          subjectUserId: userId,
        });
        const [recert] = recertFacts(state, (r) => r.id === recertId);
        const team =
          teamNamed(state, row.teamId) ?? refuse(REQUEST_REFUSALS.teamGone);
        const teamMemberships = membershipFacts(
          state,
          (m) => m.teamId === row.teamId,
        );
        const outcome = decideRecertItem({
          recert: recert!,
          userId,
          member: personNamed(state, userId),
          team,
          actor: actorOf(ctx.viewer),
          decision,
          now,
          teamMemberships,
        });
        if (!outcome.ok) refuse(outcome);
        const item = state.recertItems.find(
          (i) => i.recertId === recertId && i.userId === userId,
        )!;
        // Another decision on the item between this read and the write (a test's hook stands in for it).
        if (
          hooks.beforeCompareAndSet?.({
            table: "recert_items",
            id: `${recertId}:${userId}`,
          }) === "competing_write"
        )
          tx.update("recertItems", item, { decision: "keep" });
        // Compare-and-set on the undecided item: a second decision is refused.
        if (item.decision !== null) refuse(ACCESS_REFUSALS.alreadyReviewed);
        tx.update("recertItems", item, outcome.item);
        if (outcome.completedAt && row.completedAt === null)
          tx.update("recertifications", row, {
            completedAt: outcome.completedAt,
          });
        if (outcome.membership)
          writeGuardedChange(tx, outcome.membership, {
            team,
            before: teamMemberships,
            hooks,
          });
        effectsOf(tx, outcome.effects, now, ctx.viewer);
        return { ok: true };
      }),

    startRecertification: (ctx, input) =>
      fakeCommand(deps, (tx, now): ActionResult<{ recertId: string }> => {
        const { state } = tx;
        check(ctx.viewer, "team.manageMembers", { teamId: input.teamId });
        const team =
          teamNamed(state, input.teamId) ?? refuse(REQUEST_REFUSALS.teamGone);
        const outcome = startRecert({
          team,
          actor: actorOf(ctx.viewer),
          now,
          memberships: membershipFacts(state, (m) => m.teamId === team.id),
          unfinished: recertFacts(
            state,
            (r) => r.teamId === team.id && r.completedAt === null,
          ),
        });
        if (!outcome.ok) refuse(outcome);
        const recertId = newId("rc");
        const { items, ...recert } = outcome.recert;
        tx.insert("recertifications", {
          id: recertId,
          ...recert,
          completedAt: null,
        });
        for (const item of items)
          tx.insert("recertItems", { recertId, ...item });
        effectsOf(tx, outcome.effects, now, ctx.viewer);
        return { ok: true, recertId };
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
