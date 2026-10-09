// Phase 6 contract: access and admin. Pure types, written by the lead; every Phase 6 agent codes
// against this file. Domain inputs use Date; read models (server/queries → UI) use ISO strings,
// because they cross into client components. Who implements what is in docs/archive/phase-6-brief.md.
//
//   domain/access.ts           team access rules: request/decide, members, recertification,
//                              inactivity, and the clock-driven sweep (lapse, flag, auto-suspend)
//   domain/platform-config.ts  teams, content types, channel rules, approval chains
//   domain/audit.ts            audit sentences, action groups, filters, CSV

import type { ActionResult, ApprovalStage, NotificationKind, Person, VersionStage } from "./review-types";
import type {
  ApproverRule,
  Channel,
  MembershipStatus,
  MembershipStatusReason,
  PermissionResult,
  PlatformRole,
  RequiredSection,
  TeamRole,
} from "./types";

export type { ActionResult };

// ── Rules (Q5 in the plan's §12 is final) ────────────────────────────────────

/** A member with no sign-in for this many days is flagged on the Inactivity page. */
export const INACTIVITY_FLAG_DAYS = 90;
/** ...and suspended automatically at this many days, unless a Team Admin kept them. */
export const INACTIVITY_SUSPEND_DAYS = 120;
/** A new recertification is due this many days after it starts. */
export const RECERT_WINDOW_DAYS = 30;
/** Roles a person may ask for. Team Admins are appointed (Teams page), never requested. */
export const REQUESTABLE_ROLES = ["viewer", "author", "approver"] as const satisfies readonly TeamRole[];
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];
export const ACCESS_REASON_MAX = 500;
export const DECISION_NOTE_MAX = 500;

// ── Domain facts (what the server reads and hands to domain/access.ts) ──────

export interface Named {
  id: string;
  name: string;
}

/** What `validateChain` (platform-config.ts) needs to know about a person a stage may name. */
export interface ApproverFacts extends Named {
  platformRole: PlatformRole | null;
  /** Holds a role through an active membership on some team (`hasActiveTeamAccess` in permissions.ts). */
  activeTeamRole: boolean;
}

export interface MembershipFacts {
  id: string;
  userId: string;
  teamId: string;
  status: MembershipStatus;
  statusReason: MembershipStatusReason | null;
  statusChangedAt: Date | null;
  roles: TeamRole[];
  addedAt: Date;
  /** users.last_active_at: set when the person signs in (the persona switch). */
  lastActiveAt: Date | null;
  inactivityFlaggedAt: Date | null;
  inactivityKeptAt: Date | null;
}

export type AccessRequestStatus = "pending" | "approved" | "denied";

export interface AccessRequestFacts {
  id: string;
  userId: string;
  teamId: string;
  role: TeamRole;
  reason: string;
  status: AccessRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export type RecertDecision = "keep" | "remove";

export interface RecertItemFacts {
  userId: string;
  decision: RecertDecision | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export interface RecertFacts {
  id: string;
  teamId: string;
  label: string; // "Q4 2026"
  startsAt: Date;
  dueAt: Date;
  completedAt: Date | null;
  items: RecertItemFacts[];
}

// ── Changes (what a transition asks the server to write, in ONE transaction) ─

/** Fields a membership update may set. `roles` replaces the membership_roles rows. */
export interface MembershipSet {
  status?: MembershipStatus;
  statusReason?: MembershipStatusReason | null;
  statusChangedAt?: Date | null;
  roles?: TeamRole[];
  inactivityFlaggedAt?: Date | null;
  inactivityKeptAt?: Date | null;
}

export type MembershipChange =
  | {
      kind: "insert";
      membership: { userId: string; teamId: string; roles: TeamRole[]; addedAt: Date; addedBy: string };
    }
  | { kind: "update"; membershipId: string; set: MembershipSet }
  | { kind: "delete"; membershipId: string };

// ── Effects (audit rows and notifications; server/access-effects.ts writes them) ─

export type AccessAuditAction =
  | "access.requested"
  | "access.granted" // a request approved, or a team's first Team Admin appointed
  | "access.denied"
  | "access.role_changed"
  | "access.removed"
  | "access.flagged_inactive" // system: 90 days without a sign-in
  | "access.kept" // a Team Admin kept a flagged member
  | "access.suspended" // details.reason: "inactivity" (by a Team Admin) | "inactivity_auto" (system, 120 days)
  | "access.lapsed" // system: unconfirmed at a recertification deadline
  | "access.reinstated"
  /**
   * system: a deadline would have ended the team's last active Team Admin (day 120, or a review's
   * deadline); their access stays on and Platform Admins are told. details.reason: "inactivity_auto"
   * | "recert_unconfirmed" (additive, R1).
   */
  | "access.kept_last_admin"
  | "recert.started"
  | "recert.kept" // one member confirmed
  | "recert.removed" // one member removed during the review (their access ends at once)
  | "recert.closed" // the deadline passed, or every member was decided
  | "platform.config_changed"; // details.area: "teams" | "content_types" | "channel_rules" | "approval_chains"; details.summary

export type PlatformArea = "teams" | "content_types" | "channel_rules" | "approval_chains";

export interface AccessAuditEffect {
  kind: "audit";
  action: AccessAuditAction;
  /** null for platform-wide events (content types, channel rules, approval chains). */
  teamId: string | null;
  /** Default: the acting user. null: the system (the clock-driven sweep). */
  actorId?: string | null;
  /** Default: the action's `now`. The sweep backdates to the boundary it crossed (the deadline, day 120). */
  at?: Date;
  details: Record<string, unknown>;
}

export type AccessNotificationKind =
  | "access_requested" // to the team's Team Admins
  | "access_granted" // to the requester
  | "access_denied" // to the requester, with the admin's note as body
  | "roles_changed"
  | "access_removed"
  | "access_lapsed" // to the member, and to the team's Team Admins
  | "access_suspended" // to the member, and (automatic) to the team's Team Admins
  | "inactivity_flagged" // to the team's Team Admins
  | "recert_due" // to the team's Team Admins when a review starts
  | "team_admin_appointed"; // to a new team's first Team Admin

/** Every notification kind the bell shows: lifecycle (Phase 4) and access (Phase 6). */
export type AnyNotificationKind = NotificationKind | AccessNotificationKind;

export type AccessRecipients =
  | { kind: "user"; userId: string }
  /** Every active Team Admin of the team, minus `exceptUserIds`. The actor is never notified. */
  | { kind: "team_admins"; teamId: string; exceptUserIds?: string[] }
  /** Every Platform Admin (additive, R1: the last Team Admin kept past a deadline). */
  | { kind: "platform_admins" };

/** Team ids are their slugs (seed contract), so links build from the id. */
export type TeamSettingsSection = "members" | "access-requests" | "recertification" | "inactivity";
export type PlatformSettingsSection = "teams" | "content-types" | "channel-rules" | "approval-chains";

export type AccessLink =
  | { to: "settings"; teamId: string; section: TeamSettingsSection }
  | { to: "library"; teamId: string }
  | { to: "request-access" }
  /** A Platform settings section, from the "All teams" space (additive, R1). */
  | { to: "platform"; section: PlatformSettingsSection };

export interface AccessNotificationEffect {
  kind: "notification";
  notification: AccessNotificationKind;
  to: AccessRecipients;
  teamId: string | null;
  /** One plain sentence: "Morgan Lee asked for Author access to Coral Offers." */
  title: string;
  body?: string;
  link: AccessLink;
  /** Default: the action's `now` (the sweep backdates, like audit). */
  at?: Date;
}

export type AccessEffect = AccessAuditEffect | AccessNotificationEffect;

export type Ok<T> = { ok: true } & T;
export type Refused = { ok: false; reason: string };

// ── The sweep (clock-driven; domain/access.ts `sweepAccess`) ─────────────────

export interface SweepInput {
  now: Date;
  /** Every membership (any status); only active ones change. */
  memberships: MembershipFacts[];
  /** Open recertifications (completedAt null). */
  recerts: RecertFacts[];
  teams: Named[];
  people: Named[];
}

export interface SweepResult {
  membershipChanges: MembershipChange[];
  /** Recertifications the deadline closed: completedAt = dueAt. */
  recertsClosed: { id: string; completedAt: Date }[];
  effects: AccessEffect[];
}

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
  ended: { teamId: string; teamName: string; status: "lapsed" | "suspended"; reason: MembershipStatusReason | null; at: string }[];
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
  can: { editRoles: PermissionResult; remove: PermissionResult; reinstate: PermissionResult };
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

export interface RecertProgress {
  total: number;
  decided: number;
  kept: number;
  removed: number;
  pending: number;
  /** "4 of 6 confirmed" */
  label: string;
}

export type RecertPhase = "upcoming" | "open" | "closed";

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
  can: { suspend: PermissionResult; keep: PermissionResult; reinstate: PermissionResult };
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
  requiredSections: RequiredSection[];
  allowedChannels: Channel[];
  templates: number;
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

// ── Audit page — /{team}/audit ───────────────────────────────────────────────

export type AuditCategory = "templates" | "access" | "platform";

/**
 * `?team=&person=&action=&template=&from=&to=` — all optional. Each list field holds one value or
 * several joined by commas (the menus are multi-select: `?person=alex,sam`); values within a field
 * are ORed, fields are ANDed. `action` values are categories or (canonical) actions.
 * S3 additions: `template`, and the comma lists.
 */
export interface AuditFilters {
  /** Team slugs. Only meaningful in the All teams space; a team space is pinned to itself. */
  team?: string;
  /** User ids, or "system" for the clock-driven events. Matches who acted OR whom the event is about. */
  person?: string;
  action?: AuditCategory | string;
  /** Template ids (UC-XXXXXX). */
  template?: string;
  /** YYYY-MM-DD, demo-clock days, inclusive. */
  from?: string;
  to?: string;
}

export interface AuditRow {
  id: string;
  /** ISO of the demo-clock instant the event happened. */
  at: string;
  actor: Person | null; // null = the system (UCOMP)
  team: { slug: string; name: string } | null;
  template: { id: string; name: string } | null;
  versionNumber: number | null;
  action: string;
  category: AuditCategory;
  /** "Approved", "Access granted" (the action column). */
  actionLabel: string;
  /** One plain sentence (domain/audit.ts `describeAuditEvent`). */
  summary: string;
  /** S3 addition: whom an access event is about (details.userId); null for template and platform events. */
  subject: Person | null;
  /** S3 addition: the demo-clock time in UTC, "Oct 5, 3:42 PM UTC" (the year only outside the demo clock's; `formatDateTime`). */
  when: string;
  /** S3 addition: relative to the demo clock's now, "3 days ago". */
  ago: string;
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
  /** Matching rows before the page limit (rows holds at most AUDIT_PAGE_LIMIT). */
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
    actions: { value: string; label: string; category: AuditCategory; count: number }[];
    /** By name. */
    templates: { id: string; name: string; teamSlug: string; count: number }[];
    /** Last 7 / 30 / 90 days on the demo clock, inclusive of today. */
    datePresets: { days: number; label: string; from: string; to: string }[];
  };
  /** Same filters, as a CSV download href. */
  csvHref: string;
  today: string;
}

export const AUDIT_PAGE_LIMIT = 500;

// ── Notifications (the bell) ─────────────────────────────────────────────────

/** The bell's row. Supersedes server/queries/notifications.ts's NotificationItem (additive fields). */
export interface NotificationView {
  id: string;
  kind: AnyNotificationKind | string; // older seeded spellings stay readable
  title: string;
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
  | { kind: "access_requests"; id: string; teamSlug: string; count: number; firstName: string; role: TeamRole }
  | { kind: "recert_due"; id: string; teamSlug: string; label: string; dueAt: string; progressLabel: string }
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

export interface AccessActions {
  // src/server/actions/access.ts
  requestAccess(input: { teamId: string; role: RequestableRole; reason: string }): Promise<ActionResult<{ requestId: string }>>;
  decideAccessRequest(input: { requestId: string; decision: "approve" | "deny"; note?: string }): Promise<ActionResult>;
  changeMemberRoles(input: { membershipId: string; roles: TeamRole[] }): Promise<ActionResult>;
  removeMember(input: { membershipId: string }): Promise<ActionResult>;
  reinstateMember(input: { membershipId: string }): Promise<ActionResult>;
  suspendInactive(input: { membershipId: string }): Promise<ActionResult>;
  keepInactive(input: { membershipId: string }): Promise<ActionResult>;
  decideRecertItem(input: { recertId: string; userId: string; decision: RecertDecision }): Promise<ActionResult>;
  startRecertification(input: { teamId: string }): Promise<ActionResult<{ recertId: string }>>;
}

export interface PlatformActions {
  // src/server/actions/platform.ts
  createTeam(input: { name: string; description: string; icon: string; adminUserId: string }): Promise<ActionResult<{ slug: string }>>;
  updateContentType(input: { contentTypeId: string; requiredSections: RequiredSection[] }): Promise<ActionResult>;
  setChannelRule(input: { contentTypeId: string; channel: Channel; allowed: boolean }): Promise<ActionResult>;
  /** The whole chain, in order. Existing stages keep their id; new ones have none. */
  saveApprovalChain(input: {
    contentTypeId: string;
    stages: { id?: string; name: string; rule: ApproverRule }[];
  }): Promise<ActionResult>;
}

export interface NotificationActions {
  // src/server/actions/notifications.ts
  markNotificationRead(input: { id: string }): Promise<ActionResult>;
  markAllNotificationsRead(): Promise<ActionResult<{ count: number }>>;
}

// ── domain/platform-config.ts signatures (implemented by slice P1) ──────────

export interface PlatformConfigDomain {
  /** "Coral Offers" → "coral-offers". Refuses empty, taken (case-insensitive) and reserved slugs. */
  createTeam(input: {
    name: string;
    description: string;
    icon: string;
    admin: Named;
    actor: Named;
    now: Date;
    existing: { slug: string; name: string }[];
  }): Ok<{ team: { id: string; slug: string; name: string; description: string; icon: string; createdAt: Date }; membership: MembershipChange; effects: AccessEffect[] }> | Refused;

  /** Sections: at least one; titles 1–60 chars, unique; keys snake_case from the title, kept for renamed sections. */
  updateRequiredSections(input: {
    contentType: { id: string; name: string; requiredSections: RequiredSection[] };
    next: RequiredSection[];
    actor: Named;
    now: Date;
  }): Ok<{ requiredSections: RequiredSection[]; effects: AccessEffect[] }> | Refused;

  /** At least one channel stays on. Turning one off returns consequence lines naming the Active versions it stops. */
  setChannelRule(input: {
    contentType: { id: string; name: string; allowedChannels: Channel[] };
    channel: Channel;
    allowed: boolean;
    activeUsing: number;
    actor: Named;
    now: Date;
  }): Ok<{ allowedChannels: Channel[]; consequences: string[]; effects: AccessEffect[] }> | Refused;

  /**
   * At least one stage, and every stage passes `validateChain`: names 1–40 chars, unique; the Approver
   * role or a person who can approve, never on two stages, and never the actor naming themselves (a
   * stage that already named them stays theirs). A stage some in-review version still needs, the one
   * it waits on or one ahead of it in its own stages, can't be removed ("2 versions in review still
   * need Legal reviewer."). In-review versions go through the stages they recorded at submit, so an
   * edit never moves them.
   */
  saveApprovalChain(input: {
    contentType: { id: string; name: string };
    current: ApprovalStage[];
    next: { id?: string; name: string; rule: ApproverRule }[];
    inReview: { versionId: string; stages: VersionStage[] | null; currentStage: number }[];
    people: ApproverFacts[];
    actor: Named;
    now: Date;
  }): Ok<{
    /** In order, positions 0..n-1. id null = a new stage (the server assigns the id). */
    stages: (Omit<ApprovalStage, "id"> & { id: string | null })[];
    effects: AccessEffect[];
  }> | Refused;
}

// ── domain/audit.ts signatures (implemented by slice S3) ────────────────────

export interface AuditDomain {
  categoryOf(action: string): AuditCategory;
  /** The Action column: "Submitted", "Access granted", "Configuration changed". */
  actionLabel(action: string): string;
  /**
   * One sentence. Lifecycle actions delegate to domain/activity.ts `describeActivity`; access and
   * platform actions read details (userId/userName, roles, from/to, reason, note, area, summary).
   * "Alex Kim approved Morgan Lee's request for Author access." / "Sam Ortiz's access lapsed: not recertified by March 3, 2027."
   */
  describeAuditEvent(
    e: { action: string; details: Record<string, unknown> | null; versionNumber: number | null },
    actor: Person | null,
  ): string;
  /** The action filter's options, grouped by category, in a stable order. */
  actionOptions(): { value: string; label: string; category: AuditCategory }[];
  /** Reads `?team&person&action&from&to`; drops anything malformed (bad dates, unknown actions). */
  parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters;
  /** RFC 4180 CSV: When (ISO, demo clock), Who, Team, Template, Version, Action, Details. No variable values ever. */
  toCsv(rows: AuditRow[]): string;
}

// ── Queries (server/queries/*; all `cache()`d, all inside <Stream>) ─────────

export interface AccessQueries {
  // src/server/queries/access.ts (slice S1)
  getRequestAccessData(): Promise<RequestAccessData>;
  getMembersSection(teamSlug: string): Promise<MembersSection>;
  getAccessRequestsSection(teamSlug: string): Promise<AccessRequestsSection>;
  getRecertificationSection(teamSlug: string): Promise<RecertificationSection>;
  getInactivitySection(teamSlug: string): Promise<InactivitySection>;
  /** By space slug, for the sidebar (folded into getShell's SpaceNav as `card`). */
  getSidebarCards(): Promise<Record<string, SidebarCardModel | null>>;
  // src/server/queries/platform.ts (slice P1)
  getTeamsSection(): Promise<TeamsSection>;
  getContentTypesSection(): Promise<ContentTypesSection>;
  getChannelRulesSection(): Promise<ChannelRulesSection>;
  getApprovalChainsSection(): Promise<ApprovalChainsSection>;
  // src/server/queries/audit.ts (slice S3)
  getAuditPage(spaceSlug: string, filters: AuditFilters): Promise<AuditPageData>;
  // src/server/queries/notifications.ts (slice S3; replaces getNotifications' shape additively)
  getNotificationsData(): Promise<NotificationsData>;
}
