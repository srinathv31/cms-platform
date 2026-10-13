// Requesting and deciding access. Anyone may ask for Viewer, Author or Approver on a team, with a reason.
// One pending request per team. A Team Admin of that team approves or denies (a denial needs a note),
// never their own.

import { REASONS } from "../permissions";
import { refuse, type Refusal } from "../refusals";
import {
  ACCESS_REASON_MAX,
  DECISION_NOTE_MAX,
  type AccessEffect,
  type AccessRequestFacts,
  type MembershipChange,
  type MembershipFacts,
  type Named,
  type Ok,
  type Refused,
} from "../access-types";
import type { TeamRole } from "../types";
import { reinstatedSet } from "./members";
import { ACCESS_REFUSALS } from "./refusals";
import { sortRoles, isRequestableRole } from "./roles";

export interface NewAccessRequest {
  userId: string;
  teamId: string;
  role: TeamRole;
  reason: string;
  createdAt: Date;
}

/**
 * The first reason a request's reason can't be sent, or null: empty once trimmed (`giveReason`), then
 * longer than ACCESS_REASON_MAX (`reasonTooLong`). The request form runs it as the person types;
 * `requestAccess` refuses with its problem.
 */
export function validateAccessReason(reason: string): Refusal | null {
  const trimmed = reason.trim();
  if (!trimmed) return ACCESS_REFUSALS.giveReason;
  if (trimmed.length > ACCESS_REASON_MAX) return ACCESS_REFUSALS.reasonTooLong;
  return null;
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
  const problem = validateAccessReason(input.reason);
  if (problem) return refuse(problem);
  const reason = input.reason.trim();
  if (
    input.requests.some(
      (r) =>
        r.teamId === team.id &&
        r.userId === requester.id &&
        r.status === "pending",
    )
  ) {
    return refuse(ACCESS_REFUSALS.pending(team.name));
  }
  const current = input.memberships.find(
    (m) => m.teamId === team.id && m.userId === requester.id,
  );
  if (current?.status === "active" && current.roles.includes(role))
    return refuse(ACCESS_REFUSALS.hasRole(role, team.name));

  return {
    ok: true,
    request: {
      userId: requester.id,
      teamId: team.id,
      role,
      reason,
      createdAt: now,
    },
    effects: [
      {
        kind: "audit",
        action: "access.requested",
        teamId: team.id,
        details: {
          userId: requester.id,
          userName: requester.name,
          role,
          reason,
        },
      },
      {
        kind: "notification",
        notification: "access_requested",
        to: {
          kind: "team_admins",
          teamId: team.id,
          exceptUserIds: [requester.id],
        },
        teamId: team.id,
        facts: { actorName: requester.name, teamName: team.name, role },
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
export function requestDecisionRefusal(
  request: Pick<AccessRequestFacts, "userId" | "status">,
  actor: Named,
): Refusal | null {
  if (actor.id === request.userId) return REASONS.ownRequest;
  if (request.status !== "pending") return ACCESS_REFUSALS.decided;
  return null;
}

/**
 * The first reason a decision's note can't be sent, or null: a denial needs one (the requester reads
 * it), and a note stays under DECISION_NOTE_MAX. The Deny strip runs it as the admin types.
 */
export function validateDecisionNote(
  decision: "approve" | "deny",
  note: string | null | undefined,
): Refusal | null {
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
}):
  | Ok<{
      request: RequestDecisionFields;
      membership: MembershipChange | null;
      effects: AccessEffect[];
    }>
  | Refused {
  const { request, requester, team, actor, decision, now, membership } = input;
  const refusal =
    requestDecisionRefusal(request, actor) ??
    validateDecisionNote(decision, input.note);
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
          details: {
            requestId: request.id,
            userId: requester.id,
            userName: requester.name,
            role,
            note,
          },
        },
        {
          kind: "notification",
          notification: "access_denied",
          to: { kind: "user", userId: requester.id },
          teamId: team.id,
          facts: { actorName: actor.name, teamName: team.name, role },
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
    change = {
      kind: "insert",
      membership: {
        userId: requester.id,
        teamId: team.id,
        roles,
        addedAt: now,
        addedBy: actor.id,
      },
    };
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
        details: {
          requestId: request.id,
          userId: requester.id,
          userName: requester.name,
          role,
          roles,
          note: note || null,
        },
      },
      {
        kind: "notification",
        notification: "access_granted",
        to: { kind: "user", userId: requester.id },
        teamId: team.id,
        facts: { actorName: actor.name, teamName: team.name, role },
        body: note || undefined,
        link: { to: "library", teamId: team.id },
      },
    ],
  };
}
