import "server-only";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { sortRoles, sweepAccess } from "@/domain/access";
import type {
  AccessRequestFacts,
  MembershipFacts,
  Named,
  RecertFacts,
  SweepInput,
  SweepResult,
} from "@/domain/access-types";
import type { TeamRole } from "@/domain/types";
import { now } from "@/server/clock";
import { db, type Db } from "@/server/db/client";
import {
  accessRequests,
  membershipRoles,
  memberships,
  recertifications,
  recertItems,
  teams,
  users,
} from "@/server/db/schema/ucomp";
import { applyMembershipChange, writeAccessEffects } from "./access-effects";
import { inTransaction, type Tx } from "./effects";

// The clock-driven access sweep (domain/access.ts `sweepAccess`) and the fact readers the access
// actions and queries share. The sweep runs on "Advance clock" and on a persona switch (the demo's
// sign-in), never on a timer: it applies every deadline the demo clock has crossed since the last
// run, backdated to the instant each was crossed, in ONE transaction. Running it twice changes
// nothing, so a concurrent second sweep (two tabs) finds nothing left to do.

/** The database or a transaction: anything that can read. */
export type Reader = Pick<Db, "select"> | Pick<Tx, "select">;

// ── Facts ─────────────────────────────────────────────────────

/**
 * Memberships (any status) with their roles and the member's last sign-in, optionally narrowed
 * (`eq(memberships.teamId, …)`, `eq(memberships.userId, …)`). Ordered by id.
 */
export async function loadMembershipFacts(r: Reader, where?: SQL): Promise<MembershipFacts[]> {
  const rows = await r
    .select({
      id: memberships.id,
      userId: memberships.userId,
      teamId: memberships.teamId,
      status: memberships.status,
      statusReason: memberships.statusReason,
      statusChangedAt: memberships.statusChangedAt,
      addedAt: memberships.addedAt,
      lastActiveAt: users.lastActiveAt,
      inactivityFlaggedAt: memberships.inactivityFlaggedAt,
      inactivityKeptAt: memberships.inactivityKeptAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(memberships.id);
  if (rows.length === 0) return [];
  const roleRows = await r
    .select()
    .from(membershipRoles)
    .where(inArray(membershipRoles.membershipId, rows.map((m) => m.id)));
  const rolesBy = new Map<string, TeamRole[]>();
  for (const rr of roleRows) rolesBy.set(rr.membershipId, [...(rolesBy.get(rr.membershipId) ?? []), rr.role]);
  return rows.map((m) => ({ ...m, roles: sortRoles(rolesBy.get(m.id) ?? []) }));
}

/** Recertifications with their items, optionally narrowed. Ordered by start, then id. */
export async function loadRecertFacts(r: Reader, where?: SQL): Promise<RecertFacts[]> {
  const rows = await r
    .select()
    .from(recertifications)
    .where(where)
    .orderBy(recertifications.startsAt, recertifications.id);
  if (rows.length === 0) return [];
  const items = await r
    .select()
    .from(recertItems)
    .where(inArray(recertItems.recertId, rows.map((x) => x.id)))
    .orderBy(recertItems.userId);
  return rows.map((x) => ({
    id: x.id,
    teamId: x.teamId,
    label: x.label,
    startsAt: x.startsAt,
    dueAt: x.dueAt,
    completedAt: x.completedAt,
    items: items
      .filter((i) => i.recertId === x.id)
      .map((i) => ({ userId: i.userId, decision: i.decision, decidedBy: i.decidedBy, decidedAt: i.decidedAt })),
  }));
}

/** Access requests, optionally narrowed. Oldest first. */
export async function loadRequestFacts(r: Reader, where?: SQL): Promise<AccessRequestFacts[]> {
  return r.select().from(accessRequests).where(where).orderBy(accessRequests.createdAt, accessRequests.id);
}

export async function loadTeamsNamed(r: Reader): Promise<Named[]> {
  return r.select({ id: teams.id, name: teams.name }).from(teams).orderBy(teams.name);
}

export async function loadPeopleNamed(r: Reader): Promise<Named[]> {
  return r.select({ id: users.id, name: users.name }).from(users).orderBy(users.id);
}

/** Everything `sweepAccess` reads: every membership, the open reviews, team and people names. */
export async function loadSweepInput(r: Reader, at: Date): Promise<SweepInput> {
  const [ms, recerts, teamList, people] = [
    await loadMembershipFacts(r),
    await loadRecertFacts(r, isNull(recertifications.completedAt)),
    await loadTeamsNamed(r),
    await loadPeopleNamed(r),
  ];
  return { now: at, memberships: ms, recerts, teams: teamList, people };
}

// ── The sweep ─────────────────────────────────────────────────

const isEmpty = (r: SweepResult) =>
  r.membershipChanges.length === 0 && r.recertsClosed.length === 0 && r.effects.length === 0;

/** Writes a sweep's result inside the caller's transaction: memberships, closed reviews, then effects. */
export async function applySweep(tx: Tx, result: SweepResult, at: Date): Promise<void> {
  for (const change of result.membershipChanges) await applyMembershipChange(tx, change);
  for (const closed of result.recertsClosed) {
    await tx
      .update(recertifications)
      .set({ completedAt: closed.completedAt })
      .where(and(eq(recertifications.id, closed.id), isNull(recertifications.completedAt)));
  }
  // Team Admin recipients are read after the changes: nobody whose access just ended is told.
  await writeAccessEffects(tx, result.effects, { now: at, actorId: null });
}

/**
 * Applies everything the demo clock crossed since the last sweep (lapses at a review's deadline,
 * the 90-day flag, the 120-day automatic suspension) and returns what it did. A read outside the
 * transaction keeps the common case (nothing to do) free of a write lock; when there is work, the
 * transaction reads again and decides from that, so two sweeps at once apply it only once.
 */
export async function runAccessSweep(): Promise<SweepResult> {
  const at = await now();
  if (isEmpty(sweepAccess(await loadSweepInput(db, at)))) {
    return { membershipChanges: [], recertsClosed: [], effects: [] };
  }
  return inTransaction(db, async (tx) => {
    const result = sweepAccess(await loadSweepInput(tx, at));
    if (!isEmpty(result)) await applySweep(tx, result, at);
    return result;
  });
}
