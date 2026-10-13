// Managing members: change roles, remove, suspend, keep and reinstate. Nobody changes their own access,
// and a team always keeps at least one active Team Admin.

import { REASONS } from "../permissions";
import { refuse, type Refusal } from "../refusals";
import type {
  AccessEffect,
  MembershipChange,
  MembershipFacts,
  Named,
  Ok,
  Refused,
} from "../access-types";
import { TEAM_ROLES, type TeamRole } from "../types";
import { inactivity } from "./inactivity";
import { ACCESS_REFUSALS } from "./refusals";
import { sortRoles } from "./roles";

/** Why a member can't be given this set of roles, or null: they keep at least one. */
export function validateRoles(roles: readonly TeamRole[]): Refusal | null {
  return roles.some((r) => (TEAM_ROLES as readonly string[]).includes(r))
    ? null
    : ACCESS_REFUSALS.pickRoles;
}

interface MemberInput {
  membership: MembershipFacts;
  member: Named;
  team: Named;
  actor: Named;
  now: Date;
}

/** Every membership on the team (any status): for the "at least one Team Admin" rule. */
type TeamMemberships = { teamMemberships: readonly MembershipFacts[] };

function otherActiveAdmins(
  teamMemberships: readonly MembershipFacts[],
  membership: MembershipFacts,
): number {
  return teamMemberships.filter(
    (m) =>
      m.id !== membership.id &&
      m.teamId === membership.teamId &&
      m.status === "active" &&
      m.roles.includes("team_admin"),
  ).length;
}

export function losesLastAdmin(
  teamMemberships: readonly MembershipFacts[],
  membership: MembershipFacts,
  nextRoles: readonly TeamRole[] | null,
): boolean {
  const isAdmin =
    membership.status === "active" && membership.roles.includes("team_admin");
  const staysAdmin = nextRoles?.includes("team_admin") ?? false;
  return (
    isAdmin &&
    !staysAdmin &&
    otherActiveAdmins(teamMemberships, membership) === 0
  );
}

export function changeRoles(
  input: MemberInput & TeamMemberships & { roles: readonly TeamRole[] },
):
  | Ok<{ membership: MembershipChange | null; effects: AccessEffect[] }>
  | Refused {
  const { membership, member, team, actor } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status !== "active") return refuse(ACCESS_REFUSALS.notActive);
  const rolesProblem = validateRoles(input.roles);
  if (rolesProblem) return refuse(rolesProblem);
  const roles = sortRoles(
    input.roles.filter((r) => (TEAM_ROLES as readonly string[]).includes(r)),
  );
  const from = sortRoles(membership.roles);
  if (from.join() === roles.join())
    return { ok: true, membership: null, effects: [] };
  if (losesLastAdmin(input.teamMemberships, membership, roles))
    return refuse(ACCESS_REFUSALS.lastAdmin(team.name));

  return {
    ok: true,
    membership: { kind: "update", membershipId: membership.id, set: { roles } },
    effects: [
      {
        kind: "audit",
        action: "access.role_changed",
        teamId: team.id,
        details: { userId: member.id, userName: member.name, from, to: roles },
      },
      {
        kind: "notification",
        notification: "roles_changed",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        facts: { actorName: actor.name, teamName: team.name, roles },
        link: { to: "library", teamId: team.id },
      },
    ],
  };
}

export function removeMember(
  input: MemberInput & TeamMemberships,
): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (losesLastAdmin(input.teamMemberships, membership, null))
    return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  return {
    ok: true,
    membership: { kind: "delete", membershipId: membership.id },
    effects: [
      {
        kind: "audit",
        action: "access.removed",
        teamId: team.id,
        details: {
          userId: member.id,
          userName: member.name,
          roles: sortRoles(membership.roles),
          status: membership.status,
        },
      },
      {
        kind: "notification",
        notification: "access_removed",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        facts: { actorName: actor.name, teamName: team.name },
        link: { to: "request-access" },
      },
    ],
  };
}

/** A Team Admin suspends a member flagged for inactivity (90 days or more). */
export function suspendInactive(
  input: MemberInput & TeamMemberships,
): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor, now } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status !== "active") return refuse(ACCESS_REFUSALS.notActive);
  const state = inactivity(membership, now);
  if (state.state === "ok") return refuse(ACCESS_REFUSALS.notFlagged);
  if (losesLastAdmin(input.teamMemberships, membership, null))
    return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  return {
    ok: true,
    membership: {
      kind: "update",
      membershipId: membership.id,
      set: {
        status: "suspended",
        statusReason: "inactivity",
        statusChangedAt: now,
      },
    },
    effects: [
      {
        kind: "audit",
        action: "access.suspended",
        teamId: team.id,
        details: {
          userId: member.id,
          userName: member.name,
          reason: "inactivity",
          daysInactive: state.daysInactive,
        },
      },
      {
        kind: "notification",
        notification: "access_suspended",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        facts: {
          userId: member.id,
          userName: member.name,
          teamName: team.name,
          daysInactive: state.daysInactive,
          actorName: actor.name,
        },
        link: { to: "request-access" },
      },
    ],
  };
}

/** A Team Admin keeps a flagged member: the inactivity clock restarts now. */
export function keepInactive(
  input: MemberInput,
): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor, now } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status !== "active") return refuse(ACCESS_REFUSALS.notActive);
  const state = inactivity(membership, now);
  if (state.state === "ok") return refuse(ACCESS_REFUSALS.notFlagged);
  return {
    ok: true,
    membership: {
      kind: "update",
      membershipId: membership.id,
      set: { inactivityKeptAt: now, inactivityFlaggedAt: null },
    },
    effects: [
      {
        kind: "audit",
        action: "access.kept",
        teamId: team.id,
        details: {
          userId: member.id,
          userName: member.name,
          daysInactive: state.daysInactive,
        },
      },
    ],
  };
}

export function reinstatedSet(now: Date, roles?: TeamRole[]) {
  return {
    status: "active" as const,
    statusReason: null,
    statusChangedAt: now,
    inactivityFlaggedAt: null,
    // A fresh inactivity clock, or the sweep would suspend them again straight away.
    inactivityKeptAt: now,
    ...(roles ? { roles } : {}),
  };
}

/** A Team Admin restores a suspended or lapsed member with their previous roles. */
export function reinstate(
  input: MemberInput,
): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor, now } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status === "active")
    return refuse(ACCESS_REFUSALS.alreadyActive);
  return {
    ok: true,
    membership: {
      kind: "update",
      membershipId: membership.id,
      set: reinstatedSet(now),
    },
    effects: [
      {
        kind: "audit",
        action: "access.reinstated",
        teamId: team.id,
        details: {
          userId: member.id,
          userName: member.name,
          from: membership.status,
          reason: membership.statusReason,
          roles: sortRoles(membership.roles),
        },
      },
      {
        kind: "notification",
        notification: "access_granted",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        facts: { actorName: actor.name, teamName: team.name },
        link: { to: "library", teamId: team.id },
      },
    ],
  };
}
