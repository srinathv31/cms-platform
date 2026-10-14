// The access, platform and audit contract: what the domain rules in access/, platform-config/ and audit.ts take
// and give. Pure types: the rules' inputs (facts, with Date), the changes and effects they return, the sweep, and
// what the recertification and audit rules compute. The screens' view models built from them are in
// src/server/queries/access-models.ts.
//
//   domain/access/             team access rules: request/decide, members, recertification,
//                              inactivity, and the clock-driven sweep (lapse, flag, auto-suspend)
//   domain/platform-config/    teams, content types, channel rules, approval chains, the business time zone
//   domain/audit.ts            audit sentences, action groups, filters, CSV
//
// `PlatformConfigDomain` and `AuditDomain` near the end state the signatures those two areas export; each area
// checks itself against its interface (platform-config/contract.ts, `auditDomain` in audit.ts).

import type { Refused } from "./refusals";
import type {
  ActionResult,
  ApprovalStage,
  NotificationKind,
  Person,
  VersionStage,
} from "./review-types";
import type { NumberedRound } from "./rounds";
import type {
  ApproverRule,
  Channel,
  MembershipStatus,
  MembershipStatusReason,
  PlatformRole,
  RequiredSection,
  TeamRole,
} from "./types";

export type { ActionResult };

// ── Limits ───────────────────────────────────────────────────────────────────

/** A member with no sign-in for this many days is flagged on the Inactivity page. */
export const INACTIVITY_FLAG_DAYS = 90;
/** ...and suspended automatically at this many days, unless a Team Admin kept them. */
export const INACTIVITY_SUSPEND_DAYS = 120;
/** A new recertification is due this many days after it starts. */
export const RECERT_WINDOW_DAYS = 30;
/** Roles a person may ask for. Team Admins are appointed (Teams page), never requested. */
export const REQUESTABLE_ROLES = [
  "viewer",
  "author",
  "approver",
] as const satisfies readonly TeamRole[];
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];
/** The Access requests section lists the requests decided in this many days, newest first. */
export const DECIDED_REQUESTS_WINDOW_DAYS = 30;
export const ACCESS_REASON_MAX = 500;
export const DECISION_NOTE_MAX = 500;

// ── Domain facts (what the backend reads and hands to the access rules) ──────

export interface Named {
  id: string;
  name: string;
}

/** What `validateChain` (platform-config/approval-chains.ts) needs to know about a person a stage may name. */
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
      membership: {
        userId: string;
        teamId: string;
        roles: TeamRole[];
        addedAt: Date;
        addedBy: string;
      };
    }
  | { kind: "update"; membershipId: string; set: MembershipSet }
  | { kind: "delete"; membershipId: string };

// ── Effects (audit rows and notifications; services/local/access-effects.ts writes them) ─

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
  | "platform.config_changed"; // details.area: "teams" | "content_types" | "channel_rules" | "approval_chains" | "business_zone", and that area's facts

export type PlatformArea =
  | "teams"
  | "content_types"
  | "channel_rules"
  | "approval_chains"
  | "business_zone";

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

/** Every notification kind the bell shows: lifecycle and access. */
export type AnyNotificationKind = NotificationKind | AccessNotificationKind;

/**
 * What each access notification stores (decision 0055): facts, never a sentence or a URL, with names as they
 * were. `describeNotification` (notifications.ts) words them when read, for the person reading: a notification
 * about a member (`userId`) reads "Your access…" to that member and "Devon Lin's access…" to a Team Admin. An
 * instant is ISO; a recertification's quarter label (`Q1 2027`) is worded from its deadline, never stored here.
 */
export interface AccessNotificationFacts {
  /** A request, to the team's Team Admins (the requester's reason is the body). */
  access_requested: { actorName: string; teamName: string; role: TeamRole };
  /**
   * Access given: a request approved (`role`; the admin's note, if any, is the body), or a suspended or lapsed
   * member restored with their roles (no `role`).
   */
  access_granted: { actorName: string; teamName: string; role?: TeamRole };
  /** A request declined, to the requester (the admin's note is the body). */
  access_denied: { actorName: string; teamName: string; role: TeamRole };
  /** A member's roles replaced, to the member: every role after. */
  roles_changed: { actorName: string; teamName: string; roles: TeamRole[] };
  /** A member removed, to the member; `recertDueAt` (the review's deadline) when removed in an access review. */
  access_removed: { actorName: string; teamName: string; recertDueAt?: string };
  /** Unconfirmed at a review's deadline (`dueAt`): to the member, and to the team's Team Admins. */
  access_lapsed: {
    userId: string;
    userName: string;
    teamName: string;
    dueAt: string;
  };
  /**
   * Suspended after `daysInactive` days without a sign-in: by a Team Admin (`actorName`), to the member; or by the
   * sweep (`actorName` null), to the member and the team's Team Admins.
   */
  access_suspended: {
    userId: string;
    userName: string;
    teamName: string;
    daysInactive: number;
    actorName: string | null;
  };
  /**
   * To the team's Team Admins: a member flagged at 90 days, suspended automatically at `suspendsAt`. Or
   * (`keptLastAdmin`) to the Platform Admins: the sweep kept the team's last Team Admin past the automatic
   * suspension, after `daysInactive` days.
   */
  inactivity_flagged:
    | { userId: string; userName: string; teamName: string; suspendsAt: string }
    | {
        userId: string;
        userName: string;
        teamName: string;
        daysInactive: number;
        keptLastAdmin: true;
      };
  /**
   * To the team's Team Admins: a review started, due at `dueAt`, with `members` to confirm. Or (`keptLastAdmin`)
   * to the Platform Admins: the team's last Team Admin, unconfirmed at the deadline, kept their access.
   */
  recert_due:
    | { teamName: string; dueAt: string; members: number }
    | {
        userId: string;
        userName: string;
        teamName: string;
        dueAt: string;
        keptLastAdmin: true;
      };
  /** A new team's first Team Admin, to them. */
  team_admin_appointed: { actorName: string; teamName: string };
}

export type AccessRecipients =
  | { kind: "user"; userId: string }
  /** Every active Team Admin of the team, minus `exceptUserIds`. The actor is never notified. */
  | { kind: "team_admins"; teamId: string; exceptUserIds?: string[] }
  /** Every Platform Admin (additive, R1: the last Team Admin kept past a deadline). */
  | { kind: "platform_admins" };

export type TeamSettingsSection =
  "members" | "access-requests" | "recertification" | "inactivity";
export type PlatformSettingsSection =
  "teams" | "content-types" | "channel-rules" | "approval-chains" | "time-zone";

/**
 * Where an access notification opens. A team's link names the team by id; the BFF builds the href from its slug
 * when it reads the notification (decision 0055).
 */
export type AccessLink =
  | { to: "settings"; teamId: string; section: TeamSettingsSection }
  | { to: "library"; teamId: string }
  | { to: "request-access" }
  /** A Platform settings section, from the "All teams" space (additive, R1). */
  | { to: "platform"; section: PlatformSettingsSection };

/** An access notification to write: its kind, its facts, whom it reaches and where it opens. */
export type AccessNotificationEffect = {
  [K in AccessNotificationKind]: {
    kind: "notification";
    notification: K;
    to: AccessRecipients;
    teamId: string | null;
    facts: AccessNotificationFacts[K];
    /** Only a person's own words: the requester's reason, the admin's note. */
    body?: string;
    link: AccessLink;
    /** Default: the action's `now` (the sweep backdates, like audit). */
    at?: Date;
  };
}[AccessNotificationKind];

export type AccessEffect = AccessAuditEffect | AccessNotificationEffect;

/** When access effects happen and who acted: what both implementations' access effects writers take. */
export interface AccessEffectContext {
  /** The backend's clock, read once by the command. Effects with their own `at` (the sweep) keep it. */
  now: Date;
  /** Who acted. null for the system (the clock-driven sweep). Effects may override with `actorId`. */
  actorId: string | null;
}

/** How many rows of each kind an access effects writer wrote. */
export interface AccessEffectsWritten {
  audit: number;
  notifications: number;
}

export type Ok<T> = { ok: true } & T;
export type { Refused };

// ── The sweep (clock-driven; access/sweep.ts `sweepAccess`) ──────────────────

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

// ── Recertification progress (access/recertification.ts) ─────────────────────

export interface RecertProgress {
  total: number;
  decided: number;
  kept: number;
  removed: number;
  pending: number;
}

export type RecertPhase = "upcoming" | "open" | "closed";

// ── Audit page — /{team}/audit ───────────────────────────────────────────────

export type AuditCategory = "templates" | "access" | "platform";

/**
 * `?team=&person=&action=&template=&from=&to=` — all optional. Each list field holds one value or
 * several joined by commas (the menus are multi-select: `?person=alex,sam`); values within a field
 * are ORed, fields are ANDed. `action` values are categories or (canonical) actions.
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
  /**
   * The version the event is about, "v3 · Round 1" (chrome; the round only for review events,
   * `eventVersionLabel` in activity.ts); null when there is none, or it is the open draft.
   */
  versionLabel: string | null;
  action: string;
  category: AuditCategory;
  /** "Approved", "Access granted" (the action column). */
  actionLabel: string;
  /** One plain sentence (audit.ts `describeAuditEvent`). */
  summary: string;
  /** Whom an access event is about (details.userId); null for template and platform events. */
  subject: Person | null;
  /** The demo-clock time in UTC, "Oct 5, 3:42 PM UTC" (the year only outside the demo clock's; `formatDateTime`). */
  when: string;
  /** Relative to the demo clock's now, "3 days ago". */
  ago: string;
}

// ── platform-config/ signatures (checked in platform-config/contract.ts) ─────

export interface PlatformConfigDomain {
  /** "Coral Offers" → "coral-offers". Refuses empty, taken (case-insensitive) and reserved slugs. */
  createTeam(input: {
    name: string;
    description: string;
    icon: string;
    admin: Named & { platformRole: PlatformRole | null };
    actor: Named;
    now: Date;
    existing: { slug: string; name: string }[];
  }):
    | Ok<{
        team: {
          id: string;
          slug: string;
          name: string;
          description: string;
          icon: string;
          createdAt: Date;
        };
        membership: MembershipChange;
        effects: AccessEffect[];
      }>
    | Refused;

  /**
   * Sections: at least one; titles 1–60 chars, unique; keys snake_case from the title, kept for renamed
   * sections. A message type has none to edit.
   */
  updateRequiredSections(input: {
    contentType: {
      id: string;
      name: string;
      requiredSections: RequiredSection[];
      allowedChannels: readonly Channel[];
    };
    next: RequiredSection[];
    actor: Named;
    now: Date;
  }):
    | Ok<{ requiredSections: RequiredSection[]; effects: AccessEffect[] }>
    | Refused;

  /**
   * At least one channel stays on, and no channel of the other family goes on (`contentTypes` names the
   * content types it goes on instead). Turning one off returns consequence lines naming the Active
   * versions it stops.
   */
  setChannelRule(input: {
    contentType: { id: string; name: string; allowedChannels: Channel[] };
    channel: Channel;
    allowed: boolean;
    activeUsing: number;
    contentTypes: readonly {
      name: string;
      allowedChannels: readonly Channel[];
    }[];
    actor: Named;
    now: Date;
  }):
    | Ok<{
        allowedChannels: Channel[];
        consequences: string[];
        effects: AccessEffect[];
      }>
    | Refused;

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
    inReview: {
      versionId: string;
      stages: VersionStage[] | null;
      currentStage: number;
    }[];
    people: ApproverFacts[];
    actor: Named;
    now: Date;
  }):
    | Ok<{
        /** In order, positions 0..n-1. id null = a new stage (the server assigns the id). */
        stages: (Omit<ApprovalStage, "id"> & { id: string | null })[];
        effects: AccessEffect[];
      }>
    | Refused;

  /** One of `BUSINESS_ZONES`; the same zone again records nothing. Sunsets already set keep their instants. */
  setBusinessZone(input: {
    current: string;
    next: string;
    pendingSunsets: number;
    actor: Named;
    now: Date;
  }): Ok<{ zone: string; effects: AccessEffect[] }> | Refused;
}

// ── audit.ts signatures (checked by `auditDomain` in audit.ts) ───────────────

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
    e: {
      action: string;
      details: Record<string, unknown> | null;
      version: NumberedRound | null;
    },
    actor: Person | null,
  ): string;
  /** The action filter's options, grouped by category, in a stable order. */
  actionOptions(): { value: string; label: string; category: AuditCategory }[];
  /** Reads `?team&person&action&from&to`; drops anything malformed (bad dates, unknown actions). */
  parseAuditFilters(
    params: Record<string, string | string[] | undefined>,
  ): AuditFilters;
  /** RFC 4180 CSV: When (ISO, demo clock), Who, Team, Template, Version, Action, Details. No variable values ever. */
  toCsv(rows: AuditRow[]): string;
}
