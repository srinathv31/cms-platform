// The access, platform-settings, Audit page, bell and sidebar-card view models: what the read models in this folder
// hand the settings, audit and shell components. They are worded and carry app URLs, so they never cross the
// service interfaces (decision 0072): a read that moves behind the seam answers facts, and its read model builds
// these from them (the settings and audit ones: queries/access.ts, platform.ts and audit.ts). Read models use ISO strings, because they cross into client components. The facts the domain
// rules take are in src/domain/access-types.ts.

import type {
  AccessRequestStatus,
  AnyNotificationKind,
  ApproverFacts,
  AuditCategory,
  AuditFilters,
  AuditRow,
  RecertDecision,
  RecertPhase,
  RecertProgress,
  RequestableRole,
} from "@/domain/access-types";
import type { ActionResult, Person } from "@/domain/review-types";
import type {
  ApproverRule,
  Channel,
  ChannelFamily,
  MembershipStatus,
  MembershipStatusReason,
  PermissionResult,
  RequiredSection,
  TeamRole,
} from "@/domain/types";

// ── Read models: Request access (Morgan) — /request-access ──────────────────

export interface RequestAccessTeam {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  /** Active Team Admins ("its admin" on the card). */
  admins: Person[];
  /** The viewer's active roles here (a member may ask for another role). */
  myRoles: TeamRole[];
}

export interface MyAccessRequest {
  id: string;
  teamId: string;
  teamName: string;
  role: TeamRole;
  reason: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedBy?: Person;
  decidedAt?: string;
  /** The admin's note. Shown on a denial. */
  note?: string | null;
}

export interface RequestAccessData {
  teams: RequestAccessTeam[];
  /** The latest request per team, newest first. A pending one replaces the form for that team. */
  requests: MyAccessRequest[];
  /** Memberships that ended without the person asking: shown above the teams, one line each. */
  ended: {
    teamId: string;
    teamName: string;
    status: "lapsed" | "suspended";
    reason: MembershipStatusReason | null;
    at: string;
  }[];
  roles: readonly RequestableRole[];
}

// ── Read models: Settings, Team group — /{team}/settings/{section} ──────────

export interface MemberRow {
  membershipId: string;
  person: Person;
  title: string;
  email: string;
  roles: TeamRole[];
  status: MembershipStatus;
  statusReason: MembershipStatusReason | null;
  statusChangedAt: string | null;
  lastActiveAt: string | null;
  addedAt: string;
  isYou: boolean;
  can: {
    editRoles: PermissionResult;
    remove: PermissionResult;
    reinstate: PermissionResult;
  };
  /** The strips' lines (`memberConsequences`). */
  consequences: { remove: string; reinstate: string };
}

export interface MembersSection {
  team: { id: string; slug: string; name: string };
  /** Active first, then suspended and lapsed; by name inside each. */
  rows: MemberRow[];
  roles: readonly TeamRole[];
  /** YYYY-MM-DD, demo clock. */
  today: string;
}

export interface AccessRequestRow {
  id: string;
  person: Person;
  title: string;
  role: TeamRole;
  reason: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedBy?: Person;
  decidedAt?: string;
  note?: string | null;
  /** Disabled with "You can't decide your own access request." on your own. */
  can: { decide: PermissionResult };
  /** The Approve and Deny strips' lines (`requestConsequences`). */
  consequences: { approve: string; deny: string };
}

export interface AccessRequestsSection {
  team: { id: string; slug: string; name: string };
  pending: AccessRequestRow[]; // oldest first
  decided: AccessRequestRow[]; // last 30 days, newest first
  /** YYYY-MM-DD: the day the section counts its dates from (the read's `asOf`). */
  today: string;
}

export interface RecertItemRow {
  userId: string;
  person: Person;
  title: string;
  roles: TeamRole[];
  lastActiveAt: string | null;
  decision: RecertDecision | null;
  decidedBy?: Person;
  decidedAt?: string;
  /** The member's status now (a removed member has no membership: "removed"). */
  membership: MembershipStatus | "removed";
  /** How the row reads once nothing is left to decide on it, in place of Keep and Remove (`recertItemOutcome`). */
  outcome: string | null;
  can: { decide: PermissionResult };
  /** The Remove strip's line (`recertRemoveConsequence`). */
  consequences: { remove: string };
}

export interface RecertView {
  id: string;
  label: string;
  startsAt: string;
  dueAt: string;
  completedAt: string | null;
  phase: RecertPhase;
  progress: RecertProgress;
  items: RecertItemRow[];
  /** Closed reviews: the members whose access lapsed at the deadline. */
  lapsed: Person[];
  /** The line under the numbers (`recertFootnote`). */
  footnote: string;
}

export interface RecertificationSection {
  team: { id: string; slug: string; name: string };
  /** The open (or upcoming) review; else the last closed one. Null before the first review. */
  current: RecertView | null;
  /** "Start review": only when nothing is open or upcoming. */
  can: { start: PermissionResult };
  /** The Start review strip's line, with the deadline a review started now gets (`startRecertConsequence`). */
  consequences: { start: string };
  today: string;
}

export interface InactivityRow {
  membershipId: string;
  person: Person;
  title: string;
  roles: TeamRole[];
  lastActiveAt: string | null;
  daysInactive: number;
  /** When automatic suspension happens (or happened). */
  suspendsAt: string;
  status: MembershipStatus;
  statusReason: MembershipStatusReason | null;
  /** Past day 120 and still active: the sweep kept them on as the team's last Team Admin (`heldAsLastAdmin`). */
  heldAsLastAdmin: boolean;
  can: {
    suspend: PermissionResult;
    keep: PermissionResult;
    reinstate: PermissionResult;
  };
  /** The strips' lines (`memberConsequences`). */
  consequences: { suspend: string; keep: string; reinstate: string };
}

export interface InactivitySection {
  team: { id: string; slug: string; name: string };
  /** Active members at or past 90 days, longest inactive first. */
  flagged: InactivityRow[];
  /** Suspended for inactivity (by an admin or automatically), most recent first. */
  suspended: InactivityRow[];
  thresholds: { flagDays: number; suspendDays: number };
  /** YYYY-MM-DD: the day the section counts its dates from (the read's `asOf`). */
  today: string;
}

// ── Read models: Settings, Platform group ────────────────────────────────────

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  admins: Person[];
  members: number; // active
  templates: number;
  createdAt: string;
  /** The app name the team's push notifications show ("Coral"); null when not set. */
  appName: string | null;
  /** The short code the team's SMS come from ("26725"); null when not set. */
  smsSender: string | null;
}

export interface TeamsSection {
  teams: TeamRow[];
  /** Everyone who can be a new team's first Team Admin (every user, by name). */
  people: (Person & { title: string })[];
  /** Lucide keys the icon picker offers. */
  icons: readonly string[];
}

export interface ContentTypeView {
  id: string;
  key: string;
  name: string;
  /** Documents (PDF, Web, Email) or messages (Push, SMS): the family of the channels it allows. */
  family: ChannelFamily;
  requiredSections: RequiredSection[];
  allowedChannels: Channel[];
  /** The SMS footer every SMS of this type ends with; null when none (and on a document type). */
  smsFooter: string | null;
  /** The parts an SMS may take with the long sample values before submit refuses it. */
  smsMaxParts: number;
  templates: number;
  /** Whether "Edit sections" may open (`sectionsRefusal`): a message type has no sections. */
  can: { editSections: PermissionResult };
}

export interface ContentTypesSection {
  types: ContentTypeView[];
}

export interface ChannelRuleRow {
  contentTypeId: string;
  name: string;
  allowed: Record<Channel, boolean>;
  /** Active versions per channel: the consequence line when turning one off. */
  activeUsing: Record<Channel, number>;
  /** Per channel, whether its switch may flip (`channelRuleRefusal`): the last channel on can't go off. */
  can: { toggle: Record<Channel, PermissionResult> };
}

export interface ChannelRulesSection {
  channels: readonly Channel[];
  rows: ChannelRuleRow[];
}

export interface ChainStageView {
  id: string;
  position: number;
  name: string;
  rule: ApproverRule;
  /** "Approver role" or the named person's name. */
  ruleLabel: string;
  /**
   * Versions in review that still need this stage: the one they wait on, or one ahead of it in the
   * stages they recorded at submit (`versionsNeeding`). Removing it is refused while > 0.
   */
  waiting: number;
}

export interface ApprovalChainView {
  contentTypeId: string;
  name: string;
  stages: ChainStageView[];
}

export interface ApprovalChainsSection {
  chains: ApprovalChainView[];
  /** People a stage may name, with the teams whose templates they can see (shown beside the name). */
  people: (Person & { title: string; teams: string[] })[];
  /**
   * The facts `validateChain` checks, for everyone in `people` and everyone a stage names now (who may
   * have lost access since), so the chain editor validates as the admin edits.
   */
  approvers: ApproverFacts[];
  /** The Platform Admin editing: nobody names themselves. */
  viewerId: string;
}

/** Settings > Platform > Time zone: the business time zone sunset dates are read in (decision 0017). */
export interface BusinessZoneSection {
  /** The IANA id in force (`DEFAULT_BUSINESS_ZONE` until someone changes it). */
  zone: string;
  /** The zones on offer (`BUSINESS_ZONES`), each with its label: "Eastern (America/New_York)". */
  zones: { id: string; label: string }[];
  can: { change: PermissionResult };
  /**
   * What any change of zone leaves in place, worded by the domain from the sunsets still to come
   * (`zoneChangeConsequences`): "2 sunsets already set don't move: …". The line for the zone picked comes
   * from `describeZoneChange`, which the screen calls as the admin picks.
   */
  consequences: string[];
}

/** A filter option with how many events it would match given every OTHER filter (S3 addition). */
export interface AuditOption {
  value: string;
  label: string;
  count: number;
}

export interface AuditPageData {
  space: { slug: string; isAll: boolean; name: string };
  rows: AuditRow[];
  /** Matching rows before the page limit (rows holds at most `AUDIT_PAGE_LIMIT`, src/domain/audit.ts). */
  total: number;
  applied: AuditFilters;
  /**
   * The five menus. Every option lists what the space holds (selected values always included),
   * with counts under the other filters (S3 addition: counts, categories, templates, datePresets).
   */
  options: {
    teams: { slug: string; name: string; count: number }[]; // empty in a team space
    /** By name; the system ("UCOMP", id "system") last. */
    people: (Person & { count: number })[];
    /** The Action menu's group headings; selecting one filters the whole category. */
    categories: (AuditOption & { value: AuditCategory })[];
    /** In `actionOptions()` order (grouped by category). */
    actions: {
      value: string;
      label: string;
      category: AuditCategory;
      count: number;
    }[];
    /** By name. */
    templates: { id: string; name: string; teamSlug: string; count: number }[];
    /** Last 7 / 30 / 90 days on the demo clock, inclusive of today. */
    datePresets: { days: number; label: string; from: string; to: string }[];
  };
  /** Same filters, as a CSV download href. */
  csvHref: string;
  today: string;
}

// ── Notifications (the bell) ─────────────────────────────────────────────────

/** The bell's row: a stored notification worded and linked for the viewer (server/queries/notifications.ts). */
export interface NotificationView {
  id: string;
  /** null: a kind this app doesn't know yet (the backend added it first), worded generically. */
  kind: AnyNotificationKind | null;
  title: string;
  /** A person's own words, or the second line the facts word ("Next: Legal."); null for neither. */
  body: string | null;
  href: string | null;
  createdAt: string;
  ago: string;
  unread: boolean;
}

export interface NotificationsData {
  items: NotificationView[]; // newest first, at most 30
  unreadCount: number;
}

// ── Sidebar card (the one dismissible slot above Settings and Help) ──────────

/**
 * One card per space, by priority: access requests waiting (Team Admin) → recertification due
 * (Team Admin) → my request pending (a person with no team yet, on /request-access).
 * `id` is the dismissal key: it changes when the content changes (a new request re-shows the card).
 */
export type SidebarCardModel =
  | {
      kind: "access_requests";
      id: string;
      teamSlug: string;
      count: number;
      firstName: string;
      role: TeamRole;
    }
  | {
      kind: "recert_due";
      id: string;
      teamSlug: string;
      label: string;
      dueAt: string;
      progressLabel: string;
    }
  | {
      kind: "my_request";
      id: string;
      teamName: string;
      role: TeamRole;
      createdAt: string;
      /** Who decides it: the team's Team Admin ("waiting on Alex Kim"); the first by name if several (additive, R1). */
      adminName?: string;
    };

// ── Server actions (all return ActionResult; every one checks permissions first) ─

export interface PlatformActions {
  // src/server/actions/platform.ts
  createTeam(input: {
    name: string;
    description: string;
    icon: string;
    adminUserId: string;
  }): Promise<ActionResult<{ slug: string }>>;
  updateContentType(input: {
    contentTypeId: string;
    requiredSections: RequiredSection[];
  }): Promise<ActionResult>;
  setChannelRule(input: {
    contentTypeId: string;
    channel: Channel;
    allowed: boolean;
  }): Promise<ActionResult>;
  /** The whole chain, in order. Existing stages keep their id; new ones have none. */
  saveApprovalChain(input: {
    contentTypeId: string;
    stages: { id?: string; name: string; rule: ApproverRule }[];
  }): Promise<ActionResult>;
  /** One of `BUSINESS_ZONES`. Sunsets already set keep their instants. */
  setBusinessZone(input: { zone: string }): Promise<ActionResult>;
}
