// Team access: requesting and deciding access, managing members, quarterly recertification and
// inactivity, plus the clock-driven sweep that applies deadlines. Pure TypeScript: every function
// takes `now` (the demo clock) and returns what to write (`changes`) and what to record (`effects`);
// server code applies both in one transaction. Contracts: ./access-types.ts.
//
// The rules (build plan, "Teams, access and administration"; plan §12 Q5, final):
//   - Anyone may ask for Viewer, Author or Approver on a team, with a reason. One pending request
//     per team. A Team Admin of that team approves or denies (a denial needs a note), never their own.
//   - Nobody changes their own access, and a team always keeps at least one active Team Admin.
//   - Recertification: each member (Team Admins aside) is kept or removed by the deadline. Removing
//     ends access at once. Anyone still unconfirmed when the deadline arrives lapses AT the deadline
//     (now >= dueAt), and the review closes.
//   - Inactivity: measured from the latest of the last sign-in, the date added, and a Team Admin's
//     last Keep (or reinstatement). Flagged at 90 days; the Team Admin may Suspend or Keep;
//     suspended automatically at 120 days.
//   - Boundaries are inclusive: the instant a deadline or a day count is reached, it applies.

import { formatLongDate, formatShortDate } from "./dates";
import { REASONS } from "./permissions";
import { refusal, refuse, type Refusal } from "./refusals";
import { joinWithAnd } from "./render/errors";
import {
  ACCESS_REASON_MAX,
  DECISION_NOTE_MAX,
  INACTIVITY_FLAG_DAYS,
  INACTIVITY_SUSPEND_DAYS,
  RECERT_WINDOW_DAYS,
  REQUESTABLE_ROLES,
  type AccessEffect,
  type AccessRequestFacts,
  type MembershipChange,
  type MembershipFacts,
  type MembershipSet,
  type Named,
  type Ok,
  type RecertDecision,
  type RecertFacts,
  type RecertItemFacts,
  type RecertPhase,
  type RecertProgress,
  type Refused,
  type SweepInput,
  type SweepResult,
} from "./access-types";
import { TEAM_ROLES, type MembershipStatus, type MembershipStatusReason, type TeamRole } from "./types";

export const DAY_MS = 86_400_000;

export const ROLE_LABEL: Record<TeamRole, string> = {
  viewer: "Viewer",
  author: "Author",
  approver: "Approver",
  team_admin: "Team Admin",
};

/** Refusals: a code to branch on, and the one-line wording the UI shows where the person tried. */
export const ACCESS_REFUSALS = {
  giveReason: refusal("request_reason_missing", "Add a reason."),
  reasonTooLong: refusal("request_reason_too_long", `Keep the reason under ${ACCESS_REASON_MAX} characters.`),
  pickRole: refusal("pick_requestable_role", "Pick Viewer, Author or Approver."),
  /** Approving an Auditor's request: no team role can be given to an Auditor. */
  auditorRequester: refusal("requester_is_auditor", (person: string) => `${person} is an Auditor and can't hold team roles.`),
  hasRole: refusal("has_role", (role: TeamRole, team: string) => `You already have ${ROLE_LABEL[role]} access to ${team}.`),
  pending: refusal("request_pending", (team: string) => `You already asked for access to ${team}.`),
  decided: refusal("request_decided", "This request was already decided."),
  denyNote: refusal("deny_note_missing", "Add a note to explain the decision."),
  noteTooLong: refusal("decision_note_too_long", `Keep the note under ${DECISION_NOTE_MAX} characters.`),
  pickRoles: refusal("no_roles", "Pick at least one role."),
  lastAdmin: refusal("last_admin", (team: string) => `${team} needs at least one Team Admin.`),
  notActive: refusal("membership_not_active", "This member's access isn't active."),
  alreadyActive: refusal("membership_already_active", "This member's access is already active."),
  notFlagged: refusal("not_inactive", `This member signed in within ${INACTIVITY_FLAG_DAYS} days.`),
  reviewNotStarted: refusal("recert_not_started", (startsAt: Date) => `This review starts on ${formatLongDate(startsAt)}.`),
  reviewClosed: refusal("recert_closed", (closedAt: Date) => `This review closed on ${formatLongDate(closedAt)}.`),
  notInReview: refusal("not_in_recert", "This person isn't part of this review."),
  alreadyReviewed: refusal("already_recertified", "This member was already reviewed."),
  noLongerMember: refusal("no_longer_member", "This person is no longer a member."),
  reviewOpen: refusal("recert_open", "A review is already open."),
  nobodyToReview: refusal("nobody_to_recertify", "There's nobody to review."),
} as const;

// ── Roles ────────────────────────────────────────────────────────────────────

/** Least to most authority: the order roles are shown and stored in. */
export function sortRoles(roles: readonly TeamRole[]): TeamRole[] {
  return [...new Set(roles)].sort((a, b) => TEAM_ROLES.indexOf(a) - TEAM_ROLES.indexOf(b));
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

/** Why a member can't be given this set of roles, or null: they keep at least one. */
export function validateRoles(roles: readonly TeamRole[]): Refusal | null {
  return roles.some((r) => (TEAM_ROLES as readonly string[]).includes(r)) ? null : ACCESS_REFUSALS.pickRoles;
}

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

export function isRequestableRole(role: unknown): role is (typeof REQUESTABLE_ROLES)[number] {
  return typeof role === "string" && (REQUESTABLE_ROLES as readonly string[]).includes(role);
}

/** "Lapsed: not recertified" · "Suspended: inactive" · "Active". */
export function membershipStatusLabel(status: MembershipStatus, reason: MembershipStatusReason | null): string {
  if (status === "active") return "Active";
  if (status === "lapsed") return reason === "recert_unconfirmed" || reason === null ? "Lapsed: not recertified" : "Lapsed";
  return reason === "inactivity_auto" ? "Suspended automatically: inactive" : "Suspended: inactive";
}

// ── Inactivity ───────────────────────────────────────────────────────────────

/** The instant the inactivity clock runs from: the latest of last sign-in, date added, and last Keep. */
export function inactivityAnchor(m: Pick<MembershipFacts, "addedAt" | "lastActiveAt" | "inactivityKeptAt">): Date {
  const times = [m.addedAt, m.lastActiveAt, m.inactivityKeptAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return new Date(Math.max(...times));
}

export type InactivityState = "ok" | "flagged" | "suspend_due";

export interface Inactivity {
  /** Whole days since the anchor (floor). */
  daysInactive: number;
  /** anchor + 90 days: flagged from this instant. */
  flagAt: Date;
  /** anchor + 120 days: suspended automatically from this instant. */
  suspendAt: Date;
  state: InactivityState;
}

export function inactivity(
  m: Pick<MembershipFacts, "addedAt" | "lastActiveAt" | "inactivityKeptAt">,
  now: Date,
): Inactivity {
  const anchor = inactivityAnchor(m).getTime();
  const flagAt = new Date(anchor + INACTIVITY_FLAG_DAYS * DAY_MS);
  const suspendAt = new Date(anchor + INACTIVITY_SUSPEND_DAYS * DAY_MS);
  const t = now.getTime();
  const state: InactivityState = t >= suspendAt.getTime() ? "suspend_due" : t >= flagAt.getTime() ? "flagged" : "ok";
  return { daysInactive: Math.max(0, Math.floor((t - anchor) / DAY_MS)), flagAt, suspendAt, state };
}

// ── Recertification: reading ─────────────────────────────────────────────────

/**
 * upcoming: before startsAt. open: from startsAt until the deadline. closed: completed, or the
 * deadline has arrived (now >= dueAt) even if the sweep hasn't written it yet.
 */
export function recertPhase(r: Pick<RecertFacts, "startsAt" | "dueAt" | "completedAt">, now: Date): RecertPhase {
  if (r.completedAt) return "closed";
  if (now.getTime() >= r.dueAt.getTime()) return "closed";
  if (now.getTime() < r.startsAt.getTime()) return "upcoming";
  return "open";
}

/**
 * Who a review covers: the team's active members, Team Admins aside (nobody recertifies themselves,
 * and the team's admins are reviewed by the platform, outside this prototype). Sorted by user id.
 */
export function recertSubjects(memberships: readonly MembershipFacts[], teamId: string): string[] {
  return memberships
    .filter((m) => m.teamId === teamId && m.status === "active" && !m.roles.includes("team_admin"))
    .map((m) => m.userId)
    .sort();
}

/**
 * Progress: "4 of 6 confirmed" counts decided items (kept or removed). An undecided item whose person
 * no longer has a membership on the team (removed on the Members page) counts as removed.
 */
export function recertProgress(r: Pick<RecertFacts, "items" | "teamId">, memberships: readonly MembershipFacts[]): RecertProgress {
  const members = new Set(memberships.filter((m) => m.teamId === r.teamId).map((m) => m.userId));
  let kept = 0;
  let removed = 0;
  for (const item of r.items) {
    if (item.decision === "keep") kept += 1;
    else if (item.decision === "remove" || !members.has(item.userId)) removed += 1;
  }
  const total = r.items.length;
  const decided = kept + removed;
  return { total, decided, kept, removed, pending: total - decided, label: `${decided} of ${total} confirmed` };
}

/** "Q1 2027": the calendar quarter (UTC) of the deadline. */
export function quarterLabel(dueAt: Date): string {
  return `Q${Math.floor(dueAt.getUTCMonth() / 3) + 1} ${dueAt.getUTCFullYear()}`;
}

// ── Requesting and deciding access ──────────────────────────────────────────

export interface NewAccessRequest {
  userId: string;
  teamId: string;
  role: TeamRole;
  reason: string;
  createdAt: Date;
}

export function requestAccess(input: {
  requester: Named;
  team: Named;
  role: TeamRole;
  reason: string;
  now: Date;
  /** The requester's memberships (any team, any status). */
  memberships: readonly MembershipFacts[];
  /** The requester's requests (any team, any status). */
  requests: readonly AccessRequestFacts[];
}): Ok<{ request: NewAccessRequest; effects: AccessEffect[] }> | Refused {
  const { requester, team, role, now } = input;
  if (!isRequestableRole(role)) return refuse(ACCESS_REFUSALS.pickRole);
  const reason = input.reason.trim();
  if (!reason) return refuse(ACCESS_REFUSALS.giveReason);
  if (reason.length > ACCESS_REASON_MAX) return refuse(ACCESS_REFUSALS.reasonTooLong);
  if (input.requests.some((r) => r.teamId === team.id && r.userId === requester.id && r.status === "pending")) {
    return refuse(ACCESS_REFUSALS.pending(team.name));
  }
  const current = input.memberships.find((m) => m.teamId === team.id && m.userId === requester.id);
  if (current?.status === "active" && current.roles.includes(role)) return refuse(ACCESS_REFUSALS.hasRole(role, team.name));

  return {
    ok: true,
    request: { userId: requester.id, teamId: team.id, role, reason, createdAt: now },
    effects: [
      {
        kind: "audit",
        action: "access.requested",
        teamId: team.id,
        details: { userId: requester.id, userName: requester.name, role, reason },
      },
      {
        kind: "notification",
        notification: "access_requested",
        to: { kind: "team_admins", teamId: team.id, exceptUserIds: [requester.id] },
        teamId: team.id,
        title: `${requester.name} asked for ${ROLE_LABEL[role]} access to ${team.name}.`,
        body: reason,
        link: { to: "settings", teamId: team.id, section: "access-requests" },
      },
    ],
  };
}

export interface RequestDecisionFields {
  status: "approved" | "denied";
  decidedBy: string;
  decidedAt: Date;
  decisionNote: string | null;
}

/**
 * Why `actor` can't decide the request at all, or null: nobody decides their own, and a request is
 * decided once. The access requests read model asks it for every row's Approve and Deny.
 */
export function requestDecisionRefusal(request: Pick<AccessRequestFacts, "userId" | "status">, actor: Named): Refusal | null {
  if (actor.id === request.userId) return REASONS.ownRequest;
  if (request.status !== "pending") return ACCESS_REFUSALS.decided;
  return null;
}

/**
 * The first reason a decision's note can't be sent, or null: a denial needs one (the requester reads
 * it), and a note stays under DECISION_NOTE_MAX. The Deny strip runs it as the admin types.
 */
export function validateDecisionNote(decision: "approve" | "deny", note: string | null | undefined): Refusal | null {
  const trimmed = (note ?? "").trim();
  if (trimmed.length > DECISION_NOTE_MAX) return ACCESS_REFUSALS.noteTooLong;
  if (decision === "deny" && !trimmed) return ACCESS_REFUSALS.denyNote;
  return null;
}

/**
 * Approve: a new membership with the role; an active member gains the role; a suspended or lapsed
 * member is reinstated with exactly the requested role (and a fresh inactivity clock).
 * Deny: needs a note, which the requester sees.
 */
export function decideAccessRequest(input: {
  request: AccessRequestFacts;
  requester: Named;
  team: Named;
  actor: Named;
  decision: "approve" | "deny";
  note?: string | null;
  now: Date;
  /** The requester's membership on the request's team, if any (any status). */
  membership: MembershipFacts | null;
}): Ok<{ request: RequestDecisionFields; membership: MembershipChange | null; effects: AccessEffect[] }> | Refused {
  const { request, requester, team, actor, decision, now, membership } = input;
  const refusal = requestDecisionRefusal(request, actor) ?? validateDecisionNote(decision, input.note);
  if (refusal) return refuse(refusal);
  const note = (input.note ?? "").trim();

  const fields: RequestDecisionFields = {
    status: decision === "approve" ? "approved" : "denied",
    decidedBy: actor.id,
    decidedAt: now,
    decisionNote: note || null,
  };
  const role = request.role;

  if (decision === "deny") {
    return {
      ok: true,
      request: fields,
      membership: null,
      effects: [
        {
          kind: "audit",
          action: "access.denied",
          teamId: team.id,
          details: { requestId: request.id, userId: requester.id, userName: requester.name, role, note },
        },
        {
          kind: "notification",
          notification: "access_denied",
          to: { kind: "user", userId: requester.id },
          teamId: team.id,
          title: `${actor.name} declined your request for ${ROLE_LABEL[role]} access to ${team.name}.`,
          body: note,
          link: { to: "request-access" },
        },
      ],
    };
  }

  let change: MembershipChange;
  let roles: TeamRole[];
  if (!membership) {
    roles = [role];
    change = { kind: "insert", membership: { userId: requester.id, teamId: team.id, roles, addedAt: now, addedBy: actor.id } };
  } else if (membership.status === "active") {
    roles = sortRoles([...membership.roles, role]);
    change = { kind: "update", membershipId: membership.id, set: { roles } };
  } else {
    roles = [role];
    change = {
      kind: "update",
      membershipId: membership.id,
      set: reinstatedSet(now, roles),
    };
  }

  return {
    ok: true,
    request: fields,
    membership: change,
    effects: [
      {
        kind: "audit",
        action: "access.granted",
        teamId: team.id,
        details: { requestId: request.id, userId: requester.id, userName: requester.name, role, roles, note: note || null },
      },
      {
        kind: "notification",
        notification: "access_granted",
        to: { kind: "user", userId: requester.id },
        teamId: team.id,
        title: `${actor.name} approved your ${ROLE_LABEL[role]} access to ${team.name}.`,
        body: note || undefined,
        link: { to: "library", teamId: team.id },
      },
    ],
  };
}

// ── Members ──────────────────────────────────────────────────────────────────

interface MemberInput {
  membership: MembershipFacts;
  member: Named;
  team: Named;
  actor: Named;
  now: Date;
}

/** Every membership on the team (any status): for the "at least one Team Admin" rule. */
type TeamMemberships = { teamMemberships: readonly MembershipFacts[] };

function otherActiveAdmins(teamMemberships: readonly MembershipFacts[], membership: MembershipFacts): number {
  return teamMemberships.filter(
    (m) =>
      m.id !== membership.id && m.teamId === membership.teamId && m.status === "active" && m.roles.includes("team_admin"),
  ).length;
}

function losesLastAdmin(
  teamMemberships: readonly MembershipFacts[],
  membership: MembershipFacts,
  nextRoles: readonly TeamRole[] | null,
): boolean {
  const isAdmin = membership.status === "active" && membership.roles.includes("team_admin");
  const staysAdmin = nextRoles?.includes("team_admin") ?? false;
  return isAdmin && !staysAdmin && otherActiveAdmins(teamMemberships, membership) === 0;
}

export function changeRoles(
  input: MemberInput & TeamMemberships & { roles: readonly TeamRole[] },
): Ok<{ membership: MembershipChange | null; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status !== "active") return refuse(ACCESS_REFUSALS.notActive);
  const rolesProblem = validateRoles(input.roles);
  if (rolesProblem) return refuse(rolesProblem);
  const roles = sortRoles(input.roles.filter((r) => (TEAM_ROLES as readonly string[]).includes(r)));
  const from = sortRoles(membership.roles);
  if (from.join() === roles.join()) return { ok: true, membership: null, effects: [] };
  if (losesLastAdmin(input.teamMemberships, membership, roles)) return refuse(ACCESS_REFUSALS.lastAdmin(team.name));

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
        title: `${actor.name} changed your roles on ${team.name} to ${rolesLabel(roles)}.`,
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
  if (losesLastAdmin(input.teamMemberships, membership, null)) return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  return {
    ok: true,
    membership: { kind: "delete", membershipId: membership.id },
    effects: [
      {
        kind: "audit",
        action: "access.removed",
        teamId: team.id,
        details: { userId: member.id, userName: member.name, roles: sortRoles(membership.roles), status: membership.status },
      },
      {
        kind: "notification",
        notification: "access_removed",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        title: `${actor.name} removed your access to ${team.name}.`,
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
  if (losesLastAdmin(input.teamMemberships, membership, null)) return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  return {
    ok: true,
    membership: {
      kind: "update",
      membershipId: membership.id,
      set: { status: "suspended", statusReason: "inactivity", statusChangedAt: now },
    },
    effects: [
      {
        kind: "audit",
        action: "access.suspended",
        teamId: team.id,
        details: { userId: member.id, userName: member.name, reason: "inactivity", daysInactive: state.daysInactive },
      },
      {
        kind: "notification",
        notification: "access_suspended",
        to: { kind: "user", userId: member.id },
        teamId: team.id,
        title: `${actor.name} suspended your access to ${team.name} after ${state.daysInactive} days without a sign-in.`,
        link: { to: "request-access" },
      },
    ],
  };
}

/** A Team Admin keeps a flagged member: the inactivity clock restarts now. */
export function keepInactive(input: MemberInput): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
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
        details: { userId: member.id, userName: member.name, daysInactive: state.daysInactive },
      },
    ],
  };
}

function reinstatedSet(now: Date, roles?: TeamRole[]) {
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
export function reinstate(input: MemberInput): Ok<{ membership: MembershipChange; effects: AccessEffect[] }> | Refused {
  const { membership, member, team, actor, now } = input;
  if (actor.id === membership.userId) return refuse(REASONS.ownAccess);
  if (membership.status === "active") return refuse(ACCESS_REFUSALS.alreadyActive);
  return {
    ok: true,
    membership: { kind: "update", membershipId: membership.id, set: reinstatedSet(now) },
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
        title: `${actor.name} restored your access to ${team.name}.`,
        link: { to: "library", teamId: team.id },
      },
    ],
  };
}

// ── Recertification: acting ─────────────────────────────────────────────────

export interface NewRecert {
  teamId: string;
  label: string;
  startsAt: Date;
  dueAt: Date;
  items: RecertItemFacts[];
}

/** When a review started at `now` is due: RECERT_WINDOW_DAYS later. */
export function recertDueAt(now: Date): Date {
  return new Date(now.getTime() + RECERT_WINDOW_DAYS * DAY_MS);
}

/** A Team Admin starts a review now, due in 30 days, covering the team's members (Team Admins aside). */
export function startRecert(input: {
  team: Named;
  actor: Named;
  now: Date;
  memberships: readonly MembershipFacts[];
  /** The team's recertifications that aren't closed (open or upcoming). */
  unfinished: readonly Pick<RecertFacts, "startsAt" | "dueAt" | "completedAt">[];
}): Ok<{ recert: NewRecert; effects: AccessEffect[] }> | Refused {
  const { team, actor, now } = input;
  if (input.unfinished.some((r) => recertPhase(r, now) !== "closed")) return refuse(ACCESS_REFUSALS.reviewOpen);
  const subjects = recertSubjects(input.memberships, team.id);
  if (subjects.length === 0) return refuse(ACCESS_REFUSALS.nobodyToReview);
  const dueAt = recertDueAt(now);
  const label = quarterLabel(dueAt);
  return {
    ok: true,
    recert: {
      teamId: team.id,
      label,
      startsAt: now,
      dueAt,
      items: subjects.map((userId) => ({ userId, decision: null, decidedBy: null, decidedAt: null })),
    },
    effects: [
      {
        kind: "audit",
        action: "recert.started",
        teamId: team.id,
        details: { label, dueAt: dueAt.toISOString(), members: subjects.length },
      },
      {
        kind: "notification",
        notification: "recert_due",
        to: { kind: "team_admins", teamId: team.id, exceptUserIds: [actor.id] },
        teamId: team.id,
        title: `${label} access review for ${team.name} is due ${formatLongDate(dueAt)}.`,
        body: `Confirm ${subjects.length} members.`,
        link: { to: "settings", teamId: team.id, section: "recertification" },
      },
    ],
  };
}

/**
 * Keep or Remove one member while the review is open. Remove ends their access at once. The review
 * closes early once every member is decided.
 */
export function decideRecertItem(input: {
  recert: RecertFacts;
  userId: string;
  member: Named;
  team: Named;
  actor: Named;
  decision: RecertDecision;
  now: Date;
  /** Every membership on the team (any status). */
  teamMemberships: readonly MembershipFacts[];
}): Ok<{
  item: { decision: RecertDecision; decidedBy: string; decidedAt: Date };
  membership: MembershipChange | null;
  completedAt: Date | null;
  effects: AccessEffect[];
}> | Refused {
  const { recert, userId, member, team, actor, decision, now } = input;
  if (actor.id === userId) return refuse(REASONS.ownAccess);
  const phase = recertPhase(recert, now);
  if (phase === "upcoming") return refuse(ACCESS_REFUSALS.reviewNotStarted(recert.startsAt));
  if (phase === "closed") return refuse(ACCESS_REFUSALS.reviewClosed(recert.completedAt ?? recert.dueAt));
  const item = recert.items.find((i) => i.userId === userId);
  if (!item) return refuse(ACCESS_REFUSALS.notInReview);
  if (item.decision !== null) return refuse(ACCESS_REFUSALS.alreadyReviewed);
  const membership = input.teamMemberships.find((m) => m.userId === userId && m.teamId === recert.teamId) ?? null;
  if (!membership) return refuse(ACCESS_REFUSALS.noLongerMember);
  if (decision === "remove" && losesLastAdmin(input.teamMemberships, membership, null)) {
    return refuse(ACCESS_REFUSALS.lastAdmin(team.name));
  }

  const decided = { decision, decidedBy: actor.id, decidedAt: now };
  const effects: AccessEffect[] = [
    {
      kind: "audit",
      action: decision === "keep" ? "recert.kept" : "recert.removed",
      teamId: team.id,
      details: { recertId: recert.id, label: recert.label, userId, userName: member.name, roles: sortRoles(membership.roles) },
    },
  ];
  let change: MembershipChange | null = null;
  if (decision === "remove") {
    change = { kind: "delete", membershipId: membership.id };
    effects.push({
      kind: "notification",
      notification: "access_removed",
      to: { kind: "user", userId },
      teamId: team.id,
      title: `Your access to ${team.name} was removed in the ${recert.label} access review.`,
      link: { to: "request-access" },
    });
  }

  // Close early when nobody is left to decide.
  const items = recert.items.map((i) => (i.userId === userId ? { ...i, ...decided } : i));
  const remaining = decision === "remove" ? input.teamMemberships.filter((m) => m.id !== membership.id) : input.teamMemberships;
  const progress = recertProgress({ items, teamId: recert.teamId }, remaining);
  let completedAt: Date | null = null;
  if (progress.pending === 0) {
    completedAt = now;
    effects.push({
      kind: "audit",
      action: "recert.closed",
      teamId: team.id,
      details: { recertId: recert.id, label: recert.label, kept: progress.kept, removed: progress.removed, lapsed: 0 },
    });
  }
  return { ok: true, item: decided, membership: change, completedAt, effects };
}

// ── What the Team settings sections say ──────────────────────────────────────
// The line in a row's strip before the Team Admin confirms, and how a settled row reads. The read
// models fill these in with the demo clock's `now`, so a screen never words a rule or works out a
// date itself.

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

// ── The sweep: what the clock did since last time ───────────────────────────

type Boundary =
  | { kind: "lapse"; at: Date; recert: RecertFacts }
  | { kind: "auto_suspend"; at: Date; daysInactive: number };

/** One active membership's view of the sweep: its clock and what would end it, earliest first. */
interface SweepPlan {
  m: MembershipFacts;
  idle: Inactivity;
  boundaries: Boundary[];
  /** The team's last active Team Admin: nothing the clock crossed ends their access (see below). */
  held: boolean;
}

/**
 * The 90-day flag already recorded for the CURRENT inactivity clock. A flag set before a sign-in
 * (which moves the clock) is stale and doesn't count, so the next 90 days flag again.
 */
function flaggedFor(m: MembershipFacts, idle: Inactivity): boolean {
  return m.inactivityFlaggedAt !== null && m.inactivityFlaggedAt.getTime() >= idle.flagAt.getTime();
}

/**
 * The automatic suspension was already held back for the current clock: the sweep marks a held
 * last Team Admin with `inactivityFlaggedAt = suspendAt` (they stay flagged), so it says so once.
 */
function suspensionHeld(m: MembershipFacts, idle: Inactivity): boolean {
  return m.inactivityFlaggedAt !== null && m.inactivityFlaggedAt.getTime() >= idle.suspendAt.getTime();
}

/**
 * Applies every deadline the demo clock has reached, backdated to the instant each was reached:
 *   - an open review whose deadline arrived (now >= dueAt): unconfirmed active members lapse at
 *     dueAt (a current Team Admin never does), and the review closes at dueAt;
 *   - an active member at 120 days (now >= anchor + 120d) is suspended at that instant;
 *   - an active member at 90 days who isn't flagged yet is flagged at anchor + 90d (Team Admins are
 *     told, unless the same sweep also ended the membership).
 * When several boundaries hit one membership, the earliest wins (a tie goes to the review); the
 * others no longer apply because the membership is no longer active.
 *
 * A team always keeps an active Team Admin: when the clock would end the access of every active
 * Team Admin a team has, the one whose access would end last is kept (`access.kept_last_admin`, at
 * the boundary) and the Platform Admins are told. They stay flagged on the Inactivity page, where a
 * Team Admin added later can suspend them.
 *
 * Idempotent: applying the result and sweeping again at the same `now` changes nothing. Effects come
 * out in time order.
 */
export function sweepAccess(input: SweepInput): SweepResult {
  const { now } = input;
  const t = now.getTime();
  const teamName = (id: string) => input.teams.find((x) => x.id === id)?.name ?? id;
  const personName = (id: string) => input.people.find((x) => x.id === id)?.name ?? id;

  const due = input.recerts
    .filter((r) => r.completedAt === null && r.dueAt.getTime() <= t)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));

  // 1. What would end each active membership, earliest first; a tie goes to the review.
  const plans: SweepPlan[] = [...input.memberships]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((m) => m.status === "active")
    .map((m) => {
      const boundaries: Boundary[] = [];
      // A review never ends a current Team Admin (they're outside a review when it starts, too):
      // someone promoted while it ran stays on its list but doesn't lapse at the deadline.
      const reviewed = !m.roles.includes("team_admin");
      for (const r of due) {
        if (!reviewed || r.teamId !== m.teamId) continue;
        const item = r.items.find((i) => i.userId === m.userId);
        if (item && item.decision === null) boundaries.push({ kind: "lapse", at: r.dueAt, recert: r });
      }
      const idle = inactivity(m, now);
      if (idle.state === "suspend_due" && !suspensionHeld(m, idle)) {
        boundaries.push({ kind: "auto_suspend", at: idle.suspendAt, daysInactive: INACTIVITY_SUSPEND_DAYS });
      }
      boundaries.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === "lapse" ? -1 : 1));
      return { m, idle, boundaries, held: false };
    });

  // 2. The last Team Admin rule: if every active Team Admin of a team would go, keep the last to go.
  const admins = plans.filter((p) => p.m.roles.includes("team_admin"));
  for (const teamId of new Set(admins.map((p) => p.m.teamId))) {
    const here = admins.filter((p) => p.m.teamId === teamId);
    if (here.some((p) => p.boundaries.length === 0)) continue;
    const last = here.reduce((a, b) => {
      const d = a.boundaries[0]!.at.getTime() - b.boundaries[0]!.at.getTime();
      return d > 0 || (d === 0 && a.m.id > b.m.id) ? a : b;
    });
    last.held = true;
  }

  const membershipChanges: MembershipChange[] = [];
  const effects: AccessEffect[] = [];
  const lapsedByRecert = new Map<string, number>();

  for (const { m, idle, boundaries, held } of plans) {
    const team = { id: m.teamId, name: teamName(m.teamId) };
    const member = { id: m.userId, name: personName(m.userId) };
    const first = held ? undefined : boundaries[0];

    // The 90-day flag, if it came before whatever ended the membership.
    const set: MembershipSet = {};
    const flagged = idle.state !== "ok" && !flaggedFor(m, idle) && (!first || idle.flagAt.getTime() < first.at.getTime());
    if (flagged) {
      set.inactivityFlaggedAt = idle.flagAt;
      effects.push({
        kind: "audit",
        action: "access.flagged_inactive",
        teamId: team.id,
        actorId: null,
        at: idle.flagAt,
        details: {
          userId: member.id,
          userName: member.name,
          lastActiveAt: inactivityAnchor(m).toISOString(),
          suspendsAt: idle.suspendAt.toISOString(),
        },
      });
      if (!first) {
        effects.push({
          kind: "notification",
          notification: "inactivity_flagged",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name} hasn't signed in for ${INACTIVITY_FLAG_DAYS} days.`,
          body: `Access to ${team.name} is suspended automatically on ${formatLongDate(idle.suspendAt)}.`,
          link: { to: "settings", teamId: team.id, section: "inactivity" },
          at: idle.flagAt,
        });
      }
    }

    if (held) {
      for (const b of boundaries) {
        if (b.kind === "auto_suspend") set.inactivityFlaggedAt = idle.suspendAt; // "held once" marker
        effects.push(...keptLastAdminEffects(b, team, member));
      }
    } else if (first?.kind === "lapse") {
      Object.assign(set, { status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: first.at } satisfies MembershipSet);
      lapsedByRecert.set(first.recert.id, (lapsedByRecert.get(first.recert.id) ?? 0) + 1);
      const by = formatLongDate(first.at);
      effects.push(
        {
          kind: "audit",
          action: "access.lapsed",
          teamId: team.id,
          actorId: null,
          at: first.at,
          details: {
            userId: member.id,
            userName: member.name,
            recertId: first.recert.id,
            label: first.recert.label,
            dueAt: first.at.toISOString(),
            roles: sortRoles(m.roles),
          },
        },
        {
          kind: "notification",
          notification: "access_lapsed",
          to: { kind: "user", userId: member.id },
          teamId: team.id,
          title: `Your access to ${team.name} lapsed: it wasn't recertified by ${by}.`,
          link: { to: "request-access" },
          at: first.at,
        },
        {
          kind: "notification",
          notification: "access_lapsed",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name}'s access to ${team.name} lapsed: not recertified by ${by}.`,
          link: { to: "settings", teamId: team.id, section: "recertification" },
          at: first.at,
        },
      );
    } else if (first?.kind === "auto_suspend") {
      Object.assign(set, { status: "suspended", statusReason: "inactivity_auto", statusChangedAt: first.at } satisfies MembershipSet);
      effects.push(
        {
          kind: "audit",
          action: "access.suspended",
          teamId: team.id,
          actorId: null,
          at: first.at,
          details: { userId: member.id, userName: member.name, reason: "inactivity_auto", daysInactive: first.daysInactive },
        },
        {
          kind: "notification",
          notification: "access_suspended",
          to: { kind: "user", userId: member.id },
          teamId: team.id,
          title: `Your access to ${team.name} was suspended after ${first.daysInactive} days without a sign-in.`,
          link: { to: "request-access" },
          at: first.at,
        },
        {
          kind: "notification",
          notification: "access_suspended",
          to: { kind: "team_admins", teamId: team.id, exceptUserIds: [member.id] },
          teamId: team.id,
          title: `${member.name}'s access to ${team.name} was suspended after ${first.daysInactive} days without a sign-in.`,
          link: { to: "settings", teamId: team.id, section: "inactivity" },
          at: first.at,
        },
      );
    }

    if (Object.keys(set).length > 0) membershipChanges.push({ kind: "update", membershipId: m.id, set });
  }

  const recertsClosed = due.map((r) => ({ id: r.id, completedAt: r.dueAt }));
  for (const r of due) {
    const members = input.memberships.filter((m) => m.teamId === r.teamId);
    const progress = recertProgress(r, members);
    effects.push({
      kind: "audit",
      action: "recert.closed",
      teamId: r.teamId,
      actorId: null,
      at: r.dueAt,
      details: {
        recertId: r.id,
        label: r.label,
        kept: progress.kept,
        removed: progress.removed,
        lapsed: lapsedByRecert.get(r.id) ?? 0,
      },
    });
  }

  // Time order; inside one instant, the order they were produced in (Array.prototype.sort is stable).
  effects.sort((a, b) => (a.at?.getTime() ?? t) - (b.at?.getTime() ?? t));
  return { membershipChanges, recertsClosed, effects };
}

/** The last Team Admin kept past a boundary: an audit row, and the Platform Admins are told. */
function keptLastAdminEffects(b: Boundary, team: Named, member: Named): AccessEffect[] {
  const details =
    b.kind === "lapse"
      ? { recertId: b.recert.id, label: b.recert.label, dueAt: b.at.toISOString() }
      : { daysInactive: b.daysInactive };
  const title =
    b.kind === "lapse"
      ? `${member.name} wasn't recertified by ${formatLongDate(b.at)}, but as the last Team Admin of ${team.name} their access stays on.`
      : `${member.name} hasn't signed in for ${b.daysInactive} days, but as the last Team Admin of ${team.name} their access stays on.`;
  return [
    {
      kind: "audit",
      action: "access.kept_last_admin",
      teamId: team.id,
      actorId: null,
      at: b.at,
      details: {
        userId: member.id,
        userName: member.name,
        teamName: team.name,
        reason: b.kind === "lapse" ? "recert_unconfirmed" : "inactivity_auto",
        ...details,
      },
    },
    {
      kind: "notification",
      notification: b.kind === "lapse" ? "recert_due" : "inactivity_flagged",
      to: { kind: "platform_admins" },
      teamId: team.id,
      title,
      link: { to: "platform", section: "teams" },
      at: b.at,
    },
  ];
}
