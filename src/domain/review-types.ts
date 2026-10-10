// Phase 4 contract: lifecycle effects, the approval chain, comments, the redline, consequences, and
// the read models the review UI consumes. Pure types, written by the lead; every Phase 4 agent codes
// against this file. Dates in read models are ISO strings (they cross into client components).
//
// Who implements what is in docs/archive/phase-4-brief.md.

import type {
  ApproverRule,
  Channel,
  ChannelFamily,
  ContractChange,
  JSONContent,
  PermissionResult,
  SampleSet,
  TeamRole,
  Variable,
  VersionState,
} from "./types";
import type { ChannelField, ChannelFields } from "./channel-fields";
import type { MessageTypeRules, TeamSenders } from "./platform-config";
import type { Refused } from "./refusals";

// ── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  initials: string;
  /** Avatar hue (users.avatar_hue). */
  hue: number;
}

// ── Effects: what a transition asks server/effects.ts to write, in the same transaction ──────

export type AuditAction =
  | "template.created"
  | "draft.started"
  | "draft.edited"
  | "version.submitted"
  | "version.changes_requested"
  | "version.stage_approved" // one stage of a multi-stage chain
  | "version.activated" // the last stage approved: the version is Active
  | "version.superseded"
  | "version.sunset_set"
  | "version.sunset_passed" // the clock-driven sweep: the sunset came and renders stopped
  | "version.revoke_started"
  | "version.revoke_cancelled"
  | "version.revoked"
  | "comment.added"
  | "thread.resolved"
  | "thread.reopened";

/**
 * A `version.sunset_passed` row's details (`sweepSunsets` in lifecycle.ts): the version, the instant its
 * renders stopped, and that instant's day in the business time zone, with the zone it was read in.
 */
export type SunsetPassedDetails = {
  number: number;
  /** ISO: the instant renders stopped (`versions.sunset_at`). The row is dated then too. */
  sunsetAt: string;
  /** YYYY-MM-DD: the day the sunset fell on in `zone`, the day people read. */
  sunsetDay: string;
  zone: string;
};

/**
 * The audit actions whose details have a declared shape. Every other action's details are still an open
 * record (handoff review D10); a new action gets its shape here.
 */
export interface AuditDetailsByAction {
  "version.sunset_passed": SunsetPassedDetails;
}

export type AuditEffect = {
  [A in AuditAction]: {
    kind: "audit";
    action: A;
    /** The version the event is about; defaults to the transition's version. */
    versionId?: string;
    details: A extends keyof AuditDetailsByAction ? AuditDetailsByAction[A] : Record<string, unknown>;
  };
}[AuditAction];

/** Where a notification links to. The server turns it into an href with the team slug. */
export type NotificationLink =
  | { to: "review"; templateId: string; versionNumber: number }
  | {
      to: "template";
      templateId: string;
      /**
       * A released or decided version the notification is about. A recipient outside the template's
       * team (a stage-named reviewer) can't open the workspace, so they get this version's review
       * screen in their own space instead.
       */
      reviewVersion?: number;
    }
  | { to: "versions"; templateId: string };

export type NotificationKind =
  | "review_requested"
  | "changes_requested"
  | "version_live"
  | "stage_approved"
  | "comment_added"
  | "revoke_started"
  | "version_revoked"
  | "sunset_scheduled";

/** Recipients are resolved by the server: a user, or every active member with a role on the template's team. */
export type Recipients =
  | { kind: "user"; userId: string }
  | { kind: "team_role"; role: TeamRole; exceptUserIds?: string[] };

export interface NotificationEffect {
  kind: "notification";
  notification: NotificationKind;
  to: Recipients;
  /** One plain sentence: "Maya Chen submitted Spring Travel Rewards — Terms v1 for review." */
  title: string;
  body?: string;
  link: NotificationLink;
}

export type ConsumerNoticeKind = "new_version" | "sunset_scheduled" | "sunset_passed" | "revoked";

/**
 * Sent to every consumer that rendered the template (not as a preview) in the 90 days before the event,
 * resolved by the server from render_log. The payload never holds variable values.
 */
export interface ConsumerNoticeEffect {
  kind: "consumer_notice";
  notice: ConsumerNoticeKind;
  versionId: string;
  payload: {
    versionNumber: number;
    activeVersion?: number | null;
    sunsetAt?: string; // ISO: the instant renders stop (sunset_scheduled) or stopped (sunset_passed)
    /** YYYY-MM-DD: the sunset day, read in the business time zone (`sunsetAt` is 00:00 on it there). */
    sunsetDay?: string;
    /** The business time zone `sunsetDay` was read in. */
    zone?: string;
    reason?: string; // revoke
    contractChanges?: ContractChange[];
    contractLines?: string[];
  };
}

export type LifecycleEffect = AuditEffect | NotificationEffect | ConsumerNoticeEffect;

// ── Approval chain (configuration, not code) ─────────────────────────────────

export interface ApprovalStage {
  /** The `approval_stages` row's id: it stays the same when the stage is renamed, moved, or given a new rule. */
  id: string;
  position: number; // 0-based: in the chain, or in a version's own stages
  name: string;
  rule: ApproverRule;
}

/**
 * One stage of the sequence a version goes through, recorded on it at submit (`versions.stages`): the
 * chain stage's id and its name then. Editing the chain never changes a recorded sequence; the stage's
 * rule is read from the chain by id when the version reaches it.
 */
export interface VersionStage {
  id: string;
  name: string;
}

export type StepStatus = "done" | "current" | "waiting" | "returned";

export interface StepView {
  position: number;
  name: string;
  status: StepStatus;
  decidedBy?: Person;
  decidedAt?: string;
}

// ── Comments ─────────────────────────────────────────────────────────────────

/** blockId of a thread about the whole version (a change request's reason). Shown above the first block. */
export const DOCUMENT_THREAD = "doc";

export interface CommentView {
  id: string;
  author: Person;
  body: string;
  kind: "comment" | "change_request";
  createdAt: string;
}

/**
 * A review thread. Threads belong to the template and anchor to a stable block id, so a draft made
 * from a version (same block ids) carries them into the editor margin automatically.
 */
export interface ThreadView {
  // The editor's ThreadAnchor fields (structurally compatible; domain/ can't import editor components' types).
  id: string;
  blockId: string;
  quote: string | null;
  status: "open" | "resolved";
  originVersionNumber: number | null;
  comments: CommentView[];
  resolvedBy?: Person;
  resolvedAt?: string;
  /** The block isn't in the version being shown (deleted since). Listed after the anchored ones. */
  orphaned: boolean;
}

// ── Redline (domain/redline.ts) ─────────────────────────────────────────────

export type RedlineStatus = "unchanged" | "added" | "removed" | "changed" | "moved";

/** The mark the redline puts on inline content inside a "changed" block. */
export interface RedlineMark {
  type: "redline";
  attrs: { op: "insert" | "delete" };
}

/**
 * One top-level block of the diff, in reading order (removed blocks sit where they used to be).
 * - unchanged / moved / added: `node` is the block as it is now.
 * - removed: `node` is the block as it was.
 * - changed: `node` is the block as it is now, with deleted inline content put back in place. Text
 *   and variable nodes carry a RedlineMark (`insert` or `delete`) in their `marks`. Nested blocks
 *   (list items, table cells, callout paragraphs) are diffed the same way where they line up. Where
 *   they don't, the whole nested block is marked (every inline node inside gets the mark).
 * Variable nodes stay variable nodes (render them as chips, labels from the variable list).
 */
export interface RedlineBlock {
  id: string;
  status: RedlineStatus;
  node: JSONContent;
  /** For "moved": the block's index in the base document. */
  movedFrom?: number;
}

export interface RedlineDoc {
  blocks: RedlineBlock[];
  counts: { added: number; removed: number; changed: number; moved: number };
}

/**
 * One channel field in a redline (`diffChannelFields`): the field, how it changed as a whole, and its
 * text diffed as a document's blocks are (`doc`, normally one paragraph). A field is one block, so it is
 * never "moved". Counted once in the screen's change count, by `status`.
 */
export interface FieldRedline {
  field: ChannelField;
  status: Exclude<RedlineStatus, "moved">;
  doc: RedlineDoc;
}

// ── Consequences (domain/consequences.ts) ─────────────────────────────────────

/** Render-log aggregate per consumer and version (non-preview renders only). */
export interface ConsumerUsage {
  consumerId: string;
  consumerName: string;
  versionNumber: number;
  lastRenderAt: string; // ISO
  renders30d: number;
}

export type ConsequenceAction =
  | {
      kind: "approve";
      newNumber: number;
      previousNumber: number | null;
      sunsetAt: string | null;
      /**
       * The keys a consumer has to map before it can move to the new version (its breaking contract
       * changes: a required variable added, a key renamed, a type changed, an optional one made required).
       * Each consumer that renders the previous version gets a line for them.
       */
      breakingKeys?: string[];
    }
  | { kind: "sunset"; number: number; sunsetAt: string; activeNumber: number | null }
  | {
      kind: "revoke";
      number: number;
      activeNumber: number | null;
      /** The revoke is only being requested (another approver still has to confirm): its effects are future. */
      pending?: boolean;
    };

// ── Read models (server/queries → UI) ────────────────────────────────────────

/** The sunset picker's calendar: the business time zone and today's date in it (decision 0017). */
export interface SunsetCalendar {
  /** IANA id, "America/New_York". The picker names it: "Ends at 00:00 Eastern (America/New_York)". */
  zone: string;
  /** YYYY-MM-DD: today in `zone` on the demo clock. The earliest sunset date is the day after. */
  today: string;
}

export interface ReviewQueueRow {
  templateId: string;
  /** The row's version's name: what was submitted for review. */
  templateName: string;
  teamSlug: string;
  teamName: string;
  versionId: string;
  versionNumber: number;
  state: VersionState;
  author: Person;
  submittedAt: string;
  stage: { position: number; name: string; count: number };
  breaking: boolean;
  /** Recently decided only. */
  decision?: { kind: "approved" | "changes_requested"; by: Person; at: string };
}

export interface ReviewQueue {
  waiting: ReviewQueueRow[]; // the viewer can act on the current stage, and didn't submit it
  submitted: ReviewQueueRow[]; // submitted by the viewer, still in review
  decided: ReviewQueueRow[]; // decided in the last 30 days, on teams the viewer can see
}

export interface ReviewScreenData {
  /** `family`: its content type's (`contentTypeFamily`), never read from a version's channels. */
  template: { id: string; teamId: string; teamSlug: string; teamName: string; family: ChannelFamily };
  version: {
    id: string;
    number: number;
    state: VersionState;
    /** The template's name as this version has it: the header's title, and what goes live. */
    name: string;
    body: JSONContent;
    variables: Variable[];
    channels: Channel[];
    sampleSets: SampleSet[];
    /** Each channel's own fields (channel-fields.ts). */
    channelFields: ChannelFields;
    submittedBy: Person;
    submittedAt: string;
    submitNote: string | null;
    /** YYYY-MM-DD in the business time zone: the day a Superseded version stops rendering (the header's badge shows it). */
    sunsetDay?: string | null;
    contractChanges: ContractChange[];
    /** Plain-English lines from domain/contract.ts: "v2 adds required `annual_fee` (Currency)." */
    contractLines: string[];
  };
  /**
   * What the redline, its "vs vN" label and the change count compare with (`reviewBaseline`): the Active
   * version; with none Active (after a revoke), the released version the draft was based on, then the
   * newest version that still renders. Null for a first version, or when that would be this version.
   * `state` is for the label ("vs v3 (revoked)"). The contract changes come from submit (`contractBaseline`).
   * Its channels and channel fields are what the fields' redline compares with (`diffChannelFields`).
   */
  baseline: {
    id: string;
    number: number;
    state: VersionState;
    body: JSONContent;
    variables: Variable[];
    channels: Channel[];
    channelFields: ChannelFields;
  } | null;
  /**
   * The Active version this one would replace, for the Approve dialog's consequences and its sunset
   * offer. Null when nothing is Active, or this is the Active version. Not `baseline`: after a revoke the
   * redline compares with the revoked version, which approving replaces nothing of.
   */
  previousNumber: number | null;
  /**
   * The name customers get today, which the rail shows a rename against: the Active version's or, with
   * none Active, the newest version that still renders (`contractBaseline`). Null when nothing else
   * renders, or that is this version.
   */
  liveName: string | null;
  steps: StepView[];
  threads: ThreadView[];
  can: { approve: PermissionResult; requestChanges: PermissionResult; comment: PermissionResult };
  /** For the approve dialog: computes consequences client-side as the sunset date changes. */
  consumerUsage: ConsumerUsage[];
  /** YYYY-MM-DD, demo clock (UTC): the sample sets' "today". */
  today: string;
  /** The approve dialog's sunset picker. */
  sunsetCalendar: SunsetCalendar;
  /** The content type's SMS footer and part budget: what the phone preview renders a message version with. */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
}

export interface VersionTimelineItem {
  id: string;
  number: number | null; // null for the open draft
  state: VersionState;
  createdAt: string;
  author: Person;
  submittedAt?: string;
  submitNote?: string | null;
  activatedAt?: string;
  supersededAt?: string;
  /** YYYY-MM-DD: the sunset's day in the business time zone (it stops renders at 00:00 then). */
  sunsetDay?: string;
  sunsetPassed: boolean;
  revoke?: {
    reason: string;
    startedBy: Person;
    startedAt: string;
    confirmedBy?: Person;
    confirmedAt?: string;
  };
  contractLines: string[];
  /** The same lines, one per change, each flagged breaking or not (`contractLines` stays for compatibility). */
  contractItems: { text: string; breaking: boolean }[];
  decisions: { kind: "approved" | "changes_requested"; stageName: string; by: Person; at: string; reason?: string }[];
  /** Non-preview renders. */
  lastRenderAt: string | null;
  renders30d: number;
  /** What the viewer may do on this version right now (the reason is shown when blocked). */
  can: { setSunset: PermissionResult; startRevoke: PermissionResult; confirmRevoke: PermissionResult; cancelRevoke: PermissionResult };
}

export interface VersionsData {
  template: { id: string; name: string; teamSlug: string };
  items: VersionTimelineItem[]; // newest first; the open draft first when there is one
  consumerUsage: ConsumerUsage[];
  /** The sunset dialog's picker. */
  sunsetCalendar: SunsetCalendar;
}

export interface ActivityItem {
  id: string;
  at: string;
  actor: Person | null; // null = system
  action: AuditAction | string;
  versionNumber: number | null;
  /** One plain sentence from domain/activity.ts: "Jordan Ellis started revoking v1: Wrong APR in legal notices." */
  summary: string;
}

// ── Server action results ────────────────────────────────────────────────────

/**
 * What a server action or an on-demand read answers: done, with what it carries, or refused with a
 * stable `code` to branch on and the sentence to show (domain/refusals.ts).
 */
export type ActionResult<T = Record<never, never>> = ({ ok: true } & T) | Refused;
