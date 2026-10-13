import "server-only";
import { eq, inArray, type SQL } from "drizzle-orm";
import { sortRoles } from "@/domain/access/roles";
import type {
  AccessRequestFacts,
  MembershipFacts,
  Named,
  RecertFacts,
} from "@/domain/access-types";
import type { PlatformRole, TeamRole } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  accessRequests,
  membershipRoles,
  memberships,
  recertifications,
  recertItems,
  teams,
  users,
} from "@/server/db/schema/ucomp";
import type { Tx } from "./transaction";

// The facts team access is decided on, read from this app's own database: memberships with their roles and the
// member's last sign-in, recertifications with their items, access requests, and the names the domain words its
// effects with. The access commands (./access.ts), the access sweep (./sweeps.ts) and the access read models
// load them, inside a transaction through its `tx` when they decide on them. The fake's twins are in
// services/fake/access.ts.

/** The database or a transaction: anything that can read. */
export type Reader = Pick<Db, "select"> | Pick<Tx, "select">;

/**
 * Memberships (any status) with their roles and the member's last sign-in, optionally narrowed
 * (`eq(memberships.teamId, …)`, `eq(memberships.userId, …)`). Ordered by id.
 */
export async function loadMembershipFacts(
  r: Reader,
  where?: SQL,
): Promise<MembershipFacts[]> {
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
    .where(
      inArray(
        membershipRoles.membershipId,
        rows.map((m) => m.id),
      ),
    );
  const rolesBy = new Map<string, TeamRole[]>();
  for (const rr of roleRows)
    rolesBy.set(rr.membershipId, [
      ...(rolesBy.get(rr.membershipId) ?? []),
      rr.role,
    ]);
  return rows.map((m) => ({ ...m, roles: sortRoles(rolesBy.get(m.id) ?? []) }));
}

/** Recertifications with their items, optionally narrowed. Ordered by start, then id; items by user id. */
export async function loadRecertFacts(
  r: Reader,
  where?: SQL,
): Promise<RecertFacts[]> {
  const rows = await r
    .select()
    .from(recertifications)
    .where(where)
    .orderBy(recertifications.startsAt, recertifications.id);
  if (rows.length === 0) return [];
  const items = await r
    .select()
    .from(recertItems)
    .where(
      inArray(
        recertItems.recertId,
        rows.map((x) => x.id),
      ),
    )
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
      .map((i) => ({
        userId: i.userId,
        decision: i.decision,
        decidedBy: i.decidedBy,
        decidedAt: i.decidedAt,
      })),
  }));
}

/** Access requests, optionally narrowed. Oldest first, then by id. */
export async function loadRequestFacts(
  r: Reader,
  where?: SQL,
): Promise<AccessRequestFacts[]> {
  return r
    .select()
    .from(accessRequests)
    .where(where)
    .orderBy(accessRequests.createdAt, accessRequests.id);
}

/** Every team's id and name, by name. */
export async function loadTeamsNamed(r: Reader): Promise<Named[]> {
  return r
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .orderBy(teams.name);
}

/** Everyone's id and name, by id. */
export async function loadPeopleNamed(r: Reader): Promise<Named[]> {
  return r
    .select({ id: users.id, name: users.name })
    .from(users)
    .orderBy(users.id);
}

/** The team by id, or null when there is none. */
export async function teamNamed(r: Reader, id: string): Promise<Named | null> {
  const rows = await r
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** The person by id, with their platform role; a stand-in built from the id when the user row is gone. */
export async function personNamed(
  r: Reader,
  id: string,
): Promise<Named & { platformRole: PlatformRole | null }> {
  const rows = await r
    .select({
      id: users.id,
      name: users.name,
      platformRole: users.platformRole,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? { id, name: id, platformRole: null };
}
