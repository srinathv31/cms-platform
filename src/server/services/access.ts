// Team access: asking for a role, deciding requests, the members table, recertification and inactivity. The
// deadlines (recertification lapses, the inactivity flag and suspension) are the backend's scheduled jobs; the
// local implementation also runs them before each access command, its own lazy trigger.
//
// The reads answer facts: the rows as stored (ISO instants, ids, names as they were), what the viewer may do on
// each, decided (`can`), what time decides at the instant they say (`asOf`: a review's phase, who is flagged,
// the window of decided requests), and `Person` lists for the ids they name. The BFF words everything else: the
// strips' `consequences`, a settled row's outcome, a review's footnote, "4 of 6 confirmed", and the sidebar
// cards' text (src/server/queries/access.ts, decision 0018 amended).
//
// The commands are typed for step 2b: they still run in src/server/actions/access.ts.

import type {
  AccessRequestStatus,
  RecertDecision,
  RecertPhase,
  RecertProgress,
} from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import type {
  MembershipStatus,
  MembershipStatusReason,
  PermissionResult,
  TeamRole,
} from "@/domain/types";
import type { ActionResult, ReadResult, RequestContext } from "./types";

/** A role a person may ask for: Team Admins are appointed, never requested. */
export type RequestableRole = "viewer" | "author" | "approver";

export interface AccessService {
  requestAccess(
    ctx: RequestContext,
    input: { teamId: string; role: RequestableRole; reason: string },
  ): Promise<ActionResult<{ requestId: string }>>;
  decideRequest(
    ctx: RequestContext,
    input: { requestId: string; decision: "approve" | "deny"; note?: string },
  ): Promise<ActionResult>;
  changeRoles(
    ctx: RequestContext,
    input: { membershipId: string; roles: TeamRole[] },
  ): Promise<ActionResult>;
  removeMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  reinstateMember(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  suspendInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  keepInactive(
    ctx: RequestContext,
    input: { membershipId: string },
  ): Promise<ActionResult>;
  decideRecertItem(
    ctx: RequestContext,
    input: { recertId: string; userId: string; decision: "keep" | "remove" },
  ): Promise<ActionResult>;
  startRecertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult<{ recertId: string }>>;

  /**
   * The request-access page: every team (with its Team Admins and the viewer's roles there), the viewer's latest
   * request to each, and the teams that ended their access. Open to anyone signed in.
   */
  requestAccessData(
    ctx: RequestContext,
  ): Promise<ReadResult<RequestAccessFacts>>;
  /**
   * The Members section of a team: every membership, any status. Refuses 403 `generic` unless the viewer manages
   * the team's members (`team.manageMembers`: its Team Admin), and 404 `space_unavailable` for a team that
   * doesn't exist.
   */
  members(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<MembersFacts>>;
  /** The Access requests section. Refuses as `members` does, for `team.decideAccessRequest`. */
  requests(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<RequestsFacts>>;
  /** The Recertification section. Refuses as `members` does. */
  recertification(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<RecertificationFacts>>;
  /** The Inactivity section. Refuses as `members` does. */
  inactivity(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ReadResult<InactivityFacts>>;
  /**
   * The one dismissible sidebar card per team space the viewer can switch to, by priority: access requests
   * waiting (for a Team Admin), then a review open with members left to confirm. A team with nothing to say has
   * no card.
   */
  sidebarCards(ctx: RequestContext): Promise<ReadResult<SidebarCardsFacts>>;
  /** The card for a viewer with no space yet: their newest pending request. */
  homeCard(ctx: RequestContext): Promise<ReadResult<HomeCardFacts>>;
}

// ── The reads' facts ─────────────────────────────────────────────────────────

/** A team by the names a screen needs: its id, its URL name and its name. */
export interface TeamFacts {
  id: string;
  slug: string;
  name: string;
}

/** A team on the Request access page. */
export interface RequestableTeamFacts extends TeamFacts {
  description: string;
  icon: string;
  /** Its active Team Admins, by name (user ids). */
  adminIds: string[];
  /** The viewer's active roles there. */
  myRoles: TeamRole[];
}

/** One of the viewer's access requests. */
export interface MyRequestFacts {
  id: string;
  teamId: string;
  role: TeamRole;
  reason: string;
  status: AccessRequestStatus;
  /** ISO. */
  createdAt: string;
  /** User id. */
  decidedBy: string | null;
  decidedAt: string | null;
  /** The admin's note. */
  note: string | null;
}

/** A membership that ended without the person asking. */
export interface EndedAccessFacts {
  teamId: string;
  status: "lapsed" | "suspended";
  reason: MembershipStatusReason | null;
  /** ISO: when it ended. */
  at: string;
}

export interface RequestAccessFacts {
  /** Every team, by name. */
  teams: RequestableTeamFacts[];
  /** The latest request per team, newest first. */
  requests: MyRequestFacts[];
  /** Newest first. */
  ended: EndedAccessFacts[];
  people: Person[];
}

/** One membership of the team, with what the viewer may do on it. */
export interface MemberFacts {
  membershipId: string;
  /** User id. */
  userId: string;
  title: string;
  email: string;
  roles: TeamRole[];
  status: MembershipStatus;
  statusReason: MembershipStatusReason | null;
  /** ISO. */
  statusChangedAt: string | null;
  /** ISO: the member's last sign-in. */
  lastActiveAt: string | null;
  addedAt: string;
  can: {
    /** Whether the roles can change at all (which roles is the editor's choice). */
    editRoles: PermissionResult;
    remove: PermissionResult;
    reinstate: PermissionResult;
  };
}

export interface MembersFacts {
  /** ISO: the instant the facts were decided at. */
  asOf: string;
  team: TeamFacts;
  /** Active first, then suspended, then lapsed; by name within each. */
  rows: MemberFacts[];
  people: Person[];
}

/** One access request to the team. */
export interface RequestFacts {
  id: string;
  userId: string;
  /** The requester's title. */
  title: string;
  role: TeamRole;
  reason: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  can: {
    /** Never your own; once. */
    decide: PermissionResult;
  };
}

export interface RequestsFacts {
  asOf: string;
  team: TeamFacts;
  /** Oldest first. */
  pending: RequestFacts[];
  /** Decided in the 30 days before `asOf`, newest first. */
  decided: RequestFacts[];
  people: Person[];
}

/** One member's line in a review. */
export interface RecertMemberFacts {
  userId: string;
  title: string;
  /** Their roles on the team now; none once they have no membership. */
  roles: TeamRole[];
  /** ISO: their last sign-in. */
  lastActiveAt: string | null;
  decision: RecertDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The member's status now; a removed member has no membership. */
  membership: MembershipStatus | "removed";
  can: {
    /** Keep and Remove. */
    decide: PermissionResult;
  };
}

export interface RecertReviewFacts {
  id: string;
  /** The quarter it is named for ("Q4 2026"). */
  label: string;
  startsAt: string;
  dueAt: string;
  completedAt: string | null;
  /** At `asOf`. */
  phase: RecertPhase;
  progress: RecertProgress;
  /** By name. */
  items: RecertMemberFacts[];
  /** A closed review: the members whose access lapsed at the deadline, by name (user ids). */
  lapsedIds: string[];
}

export interface RecertificationFacts {
  asOf: string;
  team: TeamFacts;
  /** The open (or upcoming) review; else the most recent. null before the first. */
  current: RecertReviewFacts | null;
  can: {
    /** Only when nothing is open or upcoming and somebody is left to review. */
    start: PermissionResult;
  };
  people: Person[];
}

/** A member in the Inactivity section. */
export interface InactiveMemberFacts {
  membershipId: string;
  userId: string;
  title: string;
  roles: TeamRole[];
  status: MembershipStatus;
  statusReason: MembershipStatusReason | null;
  lastActiveAt: string | null;
  addedAt: string;
  /** Whole days since the inactivity clock started (the latest of last sign-in, added, last Keep), at `asOf`. */
  daysInactive: number;
  /** ISO: when the automatic suspension happens, or, for a suspended member, when they were suspended. */
  suspendsAt: string;
  /** Past day 120 and still active: the sweep kept them on as their team's last Team Admin. */
  heldAsLastAdmin: boolean;
  can: {
    suspend: PermissionResult;
    keep: PermissionResult;
    reinstate: PermissionResult;
  };
}

export interface InactivityFacts {
  asOf: string;
  team: TeamFacts;
  /** Active members at or past the flag day, longest inactive first, then by name. */
  flagged: InactiveMemberFacts[];
  /** Suspended for inactivity (by an admin or automatically), most recent first. */
  suspended: InactiveMemberFacts[];
  people: Person[];
}

/** One team's sidebar card. */
export type SidebarCardFacts =
  | {
      kind: "access_requests";
      teamId: string;
      /** Its URL name, for the card's link; compare teams by `teamId`. */
      teamSlug: string;
      /** The newest request the viewer may decide. */
      newestRequestId: string;
      /** How many pending requests the viewer may decide there (never their own). */
      count: number;
      /** User id. */
      requesterId: string;
      role: TeamRole;
    }
  | {
      kind: "recert_due";
      teamId: string;
      teamSlug: string;
      recertId: string;
      label: string;
      dueAt: string;
      progress: RecertProgress;
    };

export interface SidebarCardsFacts {
  asOf: string;
  /** At most one per team, the viewer's team spaces only. */
  cards: SidebarCardFacts[];
  people: Person[];
}

export interface HomeCardFacts {
  /** The viewer's newest pending request; null when they have none. */
  request: {
    id: string;
    teamName: string;
    role: TeamRole;
    createdAt: string;
    /** The team's first active Team Admin by name, other than the viewer; null when none. */
    adminId: string | null;
  } | null;
  people: Person[];
}
