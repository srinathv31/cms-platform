import { execute, marks, select, selectOne, update } from "./db";
import type { MembershipRecord } from "./records";

// People and their access: team memberships with their roles, and when each person last signed in.

/** A person's membership of a team with its roles, or undefined when they aren't a member. */
export async function membershipOf(
  userId: string,
  teamId: string,
): Promise<MembershipRecord | undefined> {
  const membership = await selectOne(
    "SELECT id, user_id, team_id, status FROM memberships WHERE user_id = ? AND team_id = ?",
    [userId, teamId],
  );
  if (!membership) return undefined;
  const roles = await select(
    "SELECT role FROM membership_roles WHERE membership_id = ? ORDER BY role",
    [membership.id],
  );
  return {
    id: String(membership.id),
    userId: String(membership.user_id),
    teamId: String(membership.team_id),
    status: String(membership.status),
    roles: roles.map((row) => String(row.role)),
  };
}

/** The ids of the team's active members who hold the Approver role, sorted. */
export async function approversOf(teamId: string): Promise<string[]> {
  return (
    await select(
      `SELECT DISTINCT m.user_id AS id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
       WHERE m.team_id = ? AND m.status = 'active' AND r.role = 'approver'
       ORDER BY m.user_id`,
      [teamId],
    )
  ).map((row) => String(row.id));
}

/** Gives a member a role on their team. For a spec to undo through `Changes.grantRole`. */
export async function addRole(
  membershipId: string,
  role: string,
): Promise<void> {
  await execute(
    "INSERT INTO membership_roles (membership_id, role) VALUES (?, ?)",
    [membershipId, role],
  );
}

export async function removeRole(
  membershipId: string,
  role: string,
): Promise<void> {
  await execute(
    "DELETE FROM membership_roles WHERE membership_id = ? AND role = ?",
    [membershipId, role],
  );
}

/** Remembers when each of these people last signed in. The returned function puts it back. */
export async function rememberSignIns(
  userIds: readonly string[],
): Promise<() => Promise<void>> {
  const before =
    userIds.length === 0
      ? []
      : await select(
          `SELECT id, last_active_at FROM users WHERE id IN (${marks(userIds.length)})`,
          [...userIds],
        );
  return async () => {
    for (const user of before)
      await update("users", "id", user.id, {
        last_active_at: user.last_active_at ?? null,
      });
  };
}
