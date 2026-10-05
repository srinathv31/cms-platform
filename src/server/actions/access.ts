"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
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
  type MembershipFacts,
  type Named,
  type RecertDecision,
  type RequestableRole,
} from "@/domain/access-types";
import { PermissionError, REASONS, assertCan } from "@/domain/permissions";
import { TEAM_ROLES, type Action, type PermissionResource, type TeamRole, type Viewer } from "@/domain/types";
import { applyMembershipChange, writeAccessEffects } from "@/server/access-effects";
import { loadMembershipFacts, loadRecertFacts, loadRequestFacts, runAccessSweep } from "@/server/access-sweep";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { accessRequests, memberships, recertifications, recertItems, teams, users } from "@/server/db/schema/ucomp";
import { inTransaction, type Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import { getViewer } from "@/server/viewer";

// Team access: requesting and deciding access, members, inactivity and recertification.
//
// Every action has the same shape (as actions/review.ts):
//   1. the permission check on the team, server-side, with the subject (nobody decides their own
//      request or changes their own access); a refusal is returned, not thrown;
//   2. ONE transaction that applies the access sweep, re-reads the facts, asks the domain (domain/access.ts), writes the change
//      and its audit rows and notifications (server/access-effects.ts);
//   3. `revalidatePath("/", "layout")` + `refresh()`: the switcher summaries, the sidebar card and
//      the settings sections all move.
// A double click or a colleague acting first is refused with the domain's sentence and writes nothing.
// A "use server" file may export only async functions: the helpers below stay private.

const MISSING = {
  team: "This team no longer exists.",
  request: "This request no longer exists.",
  member: "This person is no longer a member.",
  review: "This review no longer exists.",
} as const;

// ── Helpers ───────────────────────────────────────────────────

/** A refusal raised inside a transaction: it rolls the transaction back and becomes the answer. */
class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "Refusal";
  }
}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

/** `assertCan`, with the refusal returned as the action's answer instead of thrown. */
function check(viewer: Viewer, action: Action, resource: PermissionResource): { ok: false; reason: string } | null {
  try {
    assertCan(viewer, action, resource);
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, reason: error.reason };
    throw error;
  }
}

/**
 * The action's transaction. The access sweep runs first, on its own (a refusal mustn't roll it back), so
 * a deadline the demo clock already crossed (a past-due review, day 120) takes effect before the action
 * reads its facts.
 */
async function transact<T extends object>(run: (tx: Tx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const swept = await runAccessSweep();
  const sweptSomething = swept.membershipChanges.length > 0 || swept.recertsClosed.length > 0;
  try {
    return await inTransaction(db, run);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    if (sweptSomething) refreshAfter(); // the refusal changed nothing, but the sweep did
    return { ok: false, reason: error.reason };
  }
}

function refreshAfter() {
  revalidatePath("/", "layout");
  refresh();
}

const invalid = (error: z.ZodError): { ok: false; reason: string } => ({
  ok: false,
  reason: error.issues[0]?.message ?? "Check the details and try again.",
});

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
  if (!ref) refuse(MISSING.member);
  const teamMemberships = await loadMembershipFacts(tx, eq(memberships.teamId, ref.teamId));
  const membership = teamMemberships.find((m) => m.id === membershipId)!;
  const member = await personNamed(tx, membership.userId);
  const team = (await teamNamed(tx, membership.teamId)) ?? refuse(MISSING.team);
  return { membership, teamMemberships, member, team };
}

/**
 * The shared shape of the five member actions: find the membership, check `team.manageMembers` on its
 * team with the member as the subject, then run the domain transition inside one transaction.
 */
async function memberAction(
  input: unknown,
  run: (ctx: {
    membership: MembershipFacts;
    teamMemberships: MembershipFacts[];
    member: Named;
    team: Named;
    actor: Named;
    now: Date;
  }) => { ok: true; membership: MembershipChange | null; effects: AccessEffect[] } | { ok: false; reason: string },
): Promise<ActionResult> {
  const parsed = z.object({ membershipId: Id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const viewer = await getViewer();
  const ref = await findMembership(parsed.data.membershipId);
  if (!ref) return { ok: false, reason: MISSING.member };
  const denied = check(viewer, "team.manageMembers", { teamId: ref.teamId, subjectUserId: ref.userId });
  if (denied) return denied;

  const at = await now();
  const result = await transact(async (tx) => {
    const ctx = await memberContext(tx, parsed.data.membershipId);
    const outcome = run({ ...ctx, actor: actorOf(viewer), now: at });
    if (!outcome.ok) refuse(outcome.reason);
    await commit(tx, outcome.membership, outcome.effects, at, viewer);
    return { ok: true };
  });
  if (result.ok) refreshAfter();
  return result;
}

// ── Requesting and deciding access ───────────────────────────

const RequestInput = z.object({
  teamId: Id,
  role: z.enum(["viewer", "author", "approver"], { message: "Pick Viewer, Author or Approver." }),
  reason: z.string().max(ACCESS_REASON_MAX * 2),
});

/** Anyone asks for Viewer, Author or Approver on a team, with a reason. The team's Team Admins are told. */
export async function requestAccess(input: {
  teamId: string;
  role: RequestableRole;
  reason: string;
}): Promise<ActionResult<{ requestId: string }>> {
  const parsed = RequestInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const viewer = await getViewer();
  // The Auditor is read-only everywhere: no team role for them, so no request either (said plainly).
  if (viewer.platformRole === "auditor") return { ok: false, reason: REASONS.auditorReadOnly };
  const denied = check(viewer, "access.request", { teamId: parsed.data.teamId });
  if (denied) return denied;

  const at = await now();
  const result = await transact<{ requestId: string }>(async (tx) => {
    const team = (await teamNamed(tx, parsed.data.teamId)) ?? refuse(MISSING.team);
    const outcome = requestTransition({
      requester: actorOf(viewer),
      team,
      role: parsed.data.role,
      reason: parsed.data.reason,
      now: at,
      memberships: await loadMembershipFacts(tx, eq(memberships.userId, viewer.userId)),
      requests: await loadRequestFacts(tx, eq(accessRequests.userId, viewer.userId)),
    });
    if (!outcome.ok) refuse(outcome.reason);
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
  });
  if (result.ok) refreshAfter();
  return result;
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
  const parsed = DecideInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const viewer = await getViewer();
  const ref = await db
    .select({ teamId: accessRequests.teamId, userId: accessRequests.userId })
    .from(accessRequests)
    .where(eq(accessRequests.id, parsed.data.requestId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!ref) return { ok: false, reason: MISSING.request };
  const denied = check(viewer, "team.decideAccessRequest", { teamId: ref.teamId, requesterId: ref.userId });
  if (denied) return denied;

  const at = await now();
  const result = await transact(async (tx) => {
    const [request] = await loadRequestFacts(tx, eq(accessRequests.id, parsed.data.requestId));
    if (!request) refuse(MISSING.request);
    const team = (await teamNamed(tx, request.teamId)) ?? refuse(MISSING.team);
    const requester = await personNamed(tx, request.userId);
    // A request made before the requester became an Auditor (or written around the request check)
    // can't be approved: an Auditor holds no team role. Denying it still works.
    if (parsed.data.decision === "approve" && (await isAuditor(tx, request.userId))) {
      refuse(`${requester.name} is an Auditor and can't hold team roles.`);
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
      decision: parsed.data.decision,
      note: parsed.data.note ?? null,
      now: at,
      membership: membership ?? null,
    });
    if (!outcome.ok) refuse(outcome.reason);
    // Compare-and-set on the pending status: a colleague deciding first wins.
    const updated = await tx
      .update(accessRequests)
      .set(outcome.request)
      .where(and(eq(accessRequests.id, request.id), eq(accessRequests.status, "pending")))
      .returning({ id: accessRequests.id });
    if (updated.length === 0) refuse("This request was already decided.");
    await commit(tx, outcome.membership, outcome.effects, at, viewer);
    return { ok: true };
  });
  if (result.ok) refreshAfter();
  return result;
}

// ── Members and inactivity ───────────────────────────────────

const Roles = z.array(z.enum(TEAM_ROLES)).max(TEAM_ROLES.length);

/** Replace a member's roles. A team keeps at least one active Team Admin. */
export async function changeMemberRoles(input: { membershipId: string; roles: TeamRole[] }): Promise<ActionResult> {
  const roles = Roles.safeParse(input?.roles);
  if (!roles.success) return { ok: false, reason: "Pick at least one role." };
  return memberAction(input, (ctx) => changeRoles({ ...ctx, roles: roles.data }));
}

/** Remove a member: the membership is deleted. */
export async function removeMember(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, (ctx) => removeTransition(ctx));
}

/** Restore a suspended or lapsed member with their previous roles (their inactivity clock restarts). */
export async function reinstateMember(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, (ctx) => reinstateTransition(ctx));
}

/** Suspend a member flagged for inactivity (90 days or more without a sign-in). */
export async function suspendInactive(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, (ctx) => suspendTransition(ctx));
}

/** Keep a flagged member: their inactivity clock restarts now. */
export async function keepInactive(input: { membershipId: string }): Promise<ActionResult> {
  return memberAction(input, (ctx) => keepTransition(ctx));
}

// ── Recertification ──────────────────────────────────────────

const RecertItemInput = z.object({ recertId: Id, userId: Id, decision: z.enum(["keep", "remove"]) });

/** Keep or Remove one member in an open review. Remove ends access at once; the last decision closes it. */
export async function decideRecertItem(input: {
  recertId: string;
  userId: string;
  decision: RecertDecision;
}): Promise<ActionResult> {
  const parsed = RecertItemInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { recertId, userId, decision } = parsed.data;
  const viewer = await getViewer();
  const ref = await db
    .select({ teamId: recertifications.teamId })
    .from(recertifications)
    .where(eq(recertifications.id, recertId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!ref) return { ok: false, reason: MISSING.review };
  const denied = check(viewer, "team.manageMembers", { teamId: ref.teamId, subjectUserId: userId });
  if (denied) return denied;

  const at = await now();
  const result = await transact(async (tx) => {
    const [recert] = await loadRecertFacts(tx, eq(recertifications.id, recertId));
    if (!recert) refuse(MISSING.review);
    const team = (await teamNamed(tx, recert.teamId)) ?? refuse(MISSING.team);
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
    if (!outcome.ok) refuse(outcome.reason);
    const updated = await tx
      .update(recertItems)
      .set(outcome.item)
      .where(and(eq(recertItems.recertId, recertId), eq(recertItems.userId, userId), isNull(recertItems.decision)))
      .returning({ userId: recertItems.userId });
    if (updated.length === 0) refuse("This member was already reviewed.");
    if (outcome.completedAt) {
      await tx
        .update(recertifications)
        .set({ completedAt: outcome.completedAt })
        .where(and(eq(recertifications.id, recertId), isNull(recertifications.completedAt)));
    }
    await commit(tx, outcome.membership, outcome.effects, at, viewer);
    return { ok: true };
  });
  if (result.ok) refreshAfter();
  return result;
}

/** Start a review now, due in 30 days, covering the team's members (Team Admins aside). */
export async function startRecertification(input: { teamId: string }): Promise<ActionResult<{ recertId: string }>> {
  const parsed = z.object({ teamId: Id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const viewer = await getViewer();
  const denied = check(viewer, "team.manageMembers", { teamId: parsed.data.teamId });
  if (denied) return denied;

  const at = await now();
  const result = await transact<{ recertId: string }>(async (tx) => {
    const team = (await teamNamed(tx, parsed.data.teamId)) ?? refuse(MISSING.team);
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
    if (!outcome.ok) refuse(outcome.reason);
    const recertId = newId("rc");
    const { items, ...recert } = outcome.recert;
    await tx.insert(recertifications).values({ id: recertId, ...recert, completedAt: null });
    await tx.insert(recertItems).values(items.map((item) => ({ recertId, ...item })));
    await commit(tx, null, outcome.effects, at, viewer);
    return { ok: true, recertId };
  });
  if (result.ok) refreshAfter();
  return result;
}
