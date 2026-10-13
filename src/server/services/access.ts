// Team access: asking for a role, deciding requests, the members table, recertification and inactivity. The
// deadlines (recertification lapses, the inactivity flag and suspension) are the backend's scheduled jobs; the
// local implementation also runs them before each access command, its own lazy trigger, which no contract case
// relies on.
//
// Every command checks the permission on the team first, with the person it acts on as the subject (nobody
// decides their own request or changes their own access), and answers a request, membership or review that is
// gone with its own code, since a colleague acting first removes it. A team keeps at least one active Team
// Admin: a change that would leave it none is refused `last_admin`, also when another admin's change commits
// between the command's read and its write. A refusal writes nothing.
//
// The commands run behind the seam (local and fake); the reads are typed here and still run in
// src/server/queries/access.ts until they move (plan P4b).

import type { TeamRole } from "@/domain/types";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

export interface AccessService {
  /**
   * Asks for `role` on the team, with a reason; the team's Team Admins are told. One pending request per person
   * and team. Viewer, Author and Approver may be asked for (`REQUESTABLE_ROLES`): a Team Admin is appointed.
   * Refuses, in this order: `auditor_read_only` (an Auditor holds no team role), `generic`, `team_gone`, then
   * the domain's `pick_requestable_role`, `request_reason_missing`, `request_reason_too_long`, `request_pending`,
   * `has_role`.
   */
  requestAccess(
    ctx: RequestContext,
    input: { teamId: string; role: TeamRole; reason: string },
  ): Promise<ActionResult<{ requestId: string }>>;
  /**
   * A Team Admin approves (a membership with the role is created, extended or reinstated) or denies (with a note
   * the requester reads) a pending request; the requester is told. Refuses `request_gone`, `generic` (or
   * `own_request`), `team_gone`, then the domain's `requester_is_auditor` (approving an Auditor's request),
   * `request_decided`, `deny_note_missing`, `decision_note_too_long`; and `request_decided` when another decision
   * commits between the command's read and its write.
   */
  decideRequest(
    ctx: RequestContext,
    input: { requestId: string; decision: "approve" | "deny"; note?: string },
  ): Promise<ActionResult>;
  /**
   * Replaces an active member's roles; they're told. The roles they already have answer `changed: false` and
   * write nothing. Refuses `no_longer_member`, `generic` (or `own_access`), `team_gone`, then the domain's
   * `membership_not_active`, `no_roles`, `last_admin`.
   */
  changeRoles(
    ctx: RequestContext,
    input: { membershipId: string; roles: TeamRole[] },
  ): Promise<ActionResult<Changed>>;
  /** Removes a member: the membership is gone, and they're told. Refuses as `changeRoles` does. */
  removeMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  /** Restores a suspended or lapsed member with their previous roles (`membership_already_active` if active). */
  reinstateMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  /** Suspends a member flagged for inactivity (`not_inactive` for one who signed in within 90 days). */
  suspendInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  /** Keeps a flagged member: their inactivity clock restarts now (`not_inactive` as above). */
  keepInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  /**
   * Keeps or removes one member in an open review; remove ends their access at once, and the last decision
   * closes the review. Refuses `review_gone`, `generic` (or `own_access`), `team_gone`, then the domain's
   * `recert_not_started`, `recert_closed`, `not_in_recert`, `already_recertified`, `no_longer_member`,
   * `last_admin`; and `already_recertified` when another decision on the item commits between the command's
   * read and its write.
   */
  decideRecertItem(
    ctx: RequestContext,
    input: { recertId: string; userId: string; decision: "keep" | "remove" },
  ): Promise<ActionResult>;
  /**
   * Starts a review now, due in 30 days, of the team's members (Team Admins aside); the other Team Admins are
   * told. Refuses `generic`, `team_gone`, then the domain's `recert_open` and `nobody_to_recertify`.
   */
  startRecertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult<{ recertId: string }>>;

  /** The request-access page: the teams the viewer may ask to join, and their own requests. */
  requestAccessData(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the request-access facts">>>;
  members(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the members table's facts">>>;
  requests(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the access requests' facts">>>;
  recertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the recertification's facts">>>;
  inactivity(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<Unsettled<"P4b: the inactivity facts">>>;
  /** The one dismissible sidebar card per space, by team id. */
  sidebarCards(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the sidebar cards' facts">>>;
  /** The card for a viewer with no space yet (their pending request). */
  homeCard(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"P4b: the home card's facts">>>;
}
