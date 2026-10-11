// What the Team settings sections say.
// The line in a row's strip before the Team Admin confirms, and how a settled row reads. The read
// models fill these in with the demo clock's `now`, so a screen never words a rule or works out a
// date itself.

import { formatShortDate } from "../dates";
import { joinWithAnd } from "../render/errors";
import {
  RECERT_WINDOW_DAYS,
  type MembershipFacts,
  type Named,
  type RecertFacts,
  type RecertItemFacts,
} from "../access-types";
import type { MembershipStatus, TeamRole } from "../types";
import { inactivity, suspensionHeld } from "./inactivity";
import { validateRoles } from "./members";
import { recertPhase, recertDueAt } from "./recertification";
import { ROLE_LABEL, sortRoles, rolesLabel, firstName } from "./roles";

/**
 * The roles editor's line as the Team Admin ticks roles: who the member will be, or, with no role
 * ticked, that they need one (`validateRoles`, which `changeRoles` refuses with). Blocked while there's
 * nothing to save: no role, or the roles they have.
 */
export function describeRoleChange(input: {
  member: Named;
  team: Named;
  from: readonly TeamRole[];
  to: readonly TeamRole[];
}): { line: string; blocked: boolean } {
  const to = sortRoles(input.to);
  if (validateRoles(to)) return { line: `${firstName(input.member.name)} needs at least one role on ${input.team.name}.`, blocked: true };
  return {
    line: `${input.member.name} will be ${rolesLabel(to)} on ${input.team.name}.`,
    blocked: to.join() === sortRoles(input.from).join(),
  };
}

export interface MemberConsequences {
  remove: string;
  /** Restore a suspended or lapsed member, with the roles they had. */
  reinstate: string;
  suspend: string;
  /** Keep a flagged member: the day they're flagged again, from the fresh clock `keepInactive` starts. */
  keep: string;
}

/** What each member action does: Remove, Restore, Suspend and Keep. */
export function memberConsequences(input: { membership: MembershipFacts; member: Named; team: Named; now: Date }): MemberConsequences {
  const { membership, member, team, now } = input;
  const first = firstName(member.name);
  const flaggedAgain = inactivity({ ...membership, inactivityKeptAt: now }, now).flagAt;
  return {
    remove: `${member.name} loses access to ${team.name} and drops off this list. They can ask for access again.`,
    reinstate: `${first} signs in to ${team.name} again as ${rolesLabel(membership.roles)}. The inactivity count restarts today.`,
    suspend: `${first} can't sign in to ${team.name} until you restore them.`,
    keep: `${first} stays on ${team.name}. The count restarts today, so they're flagged again on ${formatShortDate(flaggedAgain, now)} if they still haven't signed in.`,
  };
}

/** What approving and denying a pending access request do. */
export function requestConsequences(input: { requester: Named; role: TeamRole; team: Named }): { approve: string; deny: string } {
  const { requester, role, team } = input;
  return {
    approve: `${requester.name} gets ${ROLE_LABEL[role]} access to ${team.name} and sees its Library the next time they open Stencil.`,
    deny: `${firstName(requester.name)} sees your note and can ask again.`,
  };
}

/** What starting a review now asks of the team, and by when: the deadline `startRecert` sets. */
export function startRecertConsequence(team: Named, now: Date): string {
  const due = formatShortDate(recertDueAt(now), now);
  return `Every member except Team Admins is asked to be kept or removed by ${due}, ${RECERT_WINDOW_DAYS} days from today. Anyone not confirmed by then loses access to ${team.name}.`;
}

/** What removing a member in a review does: their access ends now, not at the deadline. */
export function recertRemoveConsequence(member: Named, team: Named): string {
  return `${member.name} loses access to ${team.name} now, not at the deadline.`;
}

/**
 * The line under a review's numbers. While it runs: who loses access at the deadline. Once it's
 * closed: who lapsed at the deadline (`lapsed`), else that it closed early with every member decided,
 * else that nobody lapsed.
 */
export function recertFootnote(input: {
  recert: Pick<RecertFacts, "startsAt" | "dueAt" | "completedAt">;
  lapsed: readonly Named[];
  team: Named;
  now: Date;
}): string {
  const { recert, now } = input;
  const day = (d: Date) => formatShortDate(d, now);
  if (recertPhase(recert, now) !== "closed") return `Anyone not confirmed by ${day(recert.dueAt)} loses access to ${input.team.name}.`;
  if (input.lapsed.length) return `Access lapsed on ${day(recert.dueAt)} for ${joinWithAnd(input.lapsed.map((p) => p.name))}.`;
  if (recert.completedAt && recert.completedAt.getTime() < recert.dueAt.getTime()) {
    return `Closed on ${day(recert.completedAt)}: every member was decided.`;
  }
  return "Nobody lapsed.";
}

/**
 * How a member's row in a review reads once nothing is left to decide on it, or null while it can
 * still be kept or removed: kept (by whom, when), removed, suspended for inactivity, lapsed at the
 * deadline, or not confirmed before the review closed.
 */
export function recertItemOutcome(input: {
  item: Pick<RecertItemFacts, "decision" | "decidedAt">;
  decidedBy: Named | null;
  /** The member's status now; "removed" when they have no membership on the team. */
  membership: MembershipStatus | "removed";
  recert: Pick<RecertFacts, "startsAt" | "dueAt" | "completedAt">;
  now: Date;
}): string | null {
  const { item, recert, now } = input;
  const day = (d: Date) => formatShortDate(d, now);
  if (item.decision === "keep") {
    return `Kept${input.decidedBy ? ` · ${input.decidedBy.name}` : ""}${item.decidedAt ? `, ${day(item.decidedAt)}` : ""}`;
  }
  if (item.decision === "remove" || input.membership === "removed") return `Removed${item.decidedAt ? ` · ${day(item.decidedAt)}` : ""}`;
  if (input.membership === "suspended") return "Suspended for inactivity";
  if (input.membership === "lapsed") return `Access lapsed ${day(recert.dueAt)}`;
  if (recertPhase(recert, now) === "closed") return "Not confirmed";
  return null;
}

/**
 * An active member past the automatic suspension whom the sweep kept on as their team's last Team
 * Admin (`sweepAccess` records it). The Inactivity section says so in place of a suspension date.
 */
export function heldAsLastAdmin(m: MembershipFacts, now: Date): boolean {
  const idle = inactivity(m, now);
  return m.status === "active" && idle.state === "suspend_due" && suspensionHeld(m, idle);
}
