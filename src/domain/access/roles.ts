// The team roles as people read them: their labels, their order, and which ones can be asked for.

import { REQUESTABLE_ROLES } from "../access-types";
import {
  TEAM_ROLES,
  type MembershipStatus,
  type MembershipStatusReason,
  type TeamRole,
} from "../types";

export const ROLE_LABEL: Record<TeamRole, string> = {
  viewer: "Viewer",
  author: "Author",
  approver: "Approver",
  team_admin: "Team Admin",
};

/** Least to most authority: the order roles are shown and stored in. */
export function sortRoles(roles: readonly TeamRole[]): TeamRole[] {
  return [...new Set(roles)].sort(
    (a, b) => TEAM_ROLES.indexOf(a) - TEAM_ROLES.indexOf(b),
  );
}

/** "Author & Approver" */
export function rolesLabel(roles: readonly TeamRole[]): string {
  return sortRoles(roles)
    .map((r) => ROLE_LABEL[r])
    .join(" & ");
}

/** "Sam" from "Sam Ortiz": how the strips address a person they've already named. */
export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

export function isRequestableRole(
  role: unknown,
): role is (typeof REQUESTABLE_ROLES)[number] {
  return (
    typeof role === "string" &&
    (REQUESTABLE_ROLES as readonly string[]).includes(role)
  );
}

/** "Lapsed: not recertified" · "Suspended: inactive" · "Active". */
export function membershipStatusLabel(
  status: MembershipStatus,
  reason: MembershipStatusReason | null,
): string {
  if (status === "active") return "Active";
  if (status === "lapsed")
    return reason === "recert_unconfirmed" || reason === null
      ? "Lapsed: not recertified"
      : "Lapsed";
  return reason === "inactivity_auto"
    ? "Suspended automatically: inactive"
    : "Suspended: inactive";
}
