// What the review rules take and return: lifecycle effects, the approval chain, the redline, consequences,
// and the result a server action answers with. Pure types and one constant. A screen's own read models
// (`ReviewScreenData`, `VersionsData`, `ThreadView`, …) are not here: each sits beside the query in
// src/server/queries/ that builds it.

import type { ApproverRule, ContractChange, JSONContent, TeamRole } from "./types";
import type { ChannelField } from "./channel-fields";
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

/**
 * Where a notification links to. The server turns it into an href with the team slug. A review link
 * names its round exactly when the round's label shows it (`reviewLink` in rounds.ts): without one, the
 * review screen is the number's head, or for a stage reviewer outside the team who can't open the head
 * (the next round waits on another stage), the newest round of the number they decided.
 */
export type NotificationLink =
  | { to: "review"; templateId: string; versionNumber: number; round?: number }
  | {
      to: "template";
      templateId: string;
      /**
       * A released or decided version the notification is about. A recipient outside the template's
       * team (a stage-named reviewer) can't open the workspace, so they get this version's review
       * screen in their own space instead. `round` as on a review link.
       */
      reviewVersion?: { number: number; round?: number };
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
  /** One plain sentence: "Maya Chen submitted Spring Travel Rewards — Terms v1, round 2 for review." */
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

/**
 * The SMS's locked footer in a redline (`diffChannelFields`): the one each version prints (its own, frozen at
 * submit; a draft's is the content type's), shown under the SMS's message. `from` is null with no base, or
 * when the base had no footer. A changed footer counts as one change, unless the SMS itself was turned on or
 * off (its message counts then, and the footer comes or goes with it).
 */
export interface FooterRedline {
  from: string | null;
  to: string | null;
  status: Exclude<RedlineStatus, "moved">;
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
      /** The Active version this one replaces: it becomes Superseded. Null when nothing is Active. */
      previousNumber: number | null;
      /** YYYY-MM-DD: the sunset date chosen for `previousNumber`, or null. */
      sunsetAt: string | null;
      /**
       * With nothing Active (after a revoke), the newest version that still renders (`contractBaseline`):
       * its consumers move from it to the new one, and `breakingKeys` are the new version's changes against it.
       * Nothing becomes Superseded. `sunsetAt` is its own sunset day (YYYY-MM-DD), or null. Read only
       * when `previousNumber` is null; null or absent for a first version.
       */
      stillRenders?: { number: number; sunsetAt: string | null } | null;
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

// ── Server action results ────────────────────────────────────────────────────

/**
 * What a server action or an on-demand read answers: done, with what it carries, or refused with a
 * stable `code` to branch on and the sentence to show (domain/refusals.ts).
 */
export type ActionResult<T = Record<never, never>> = ({ ok: true } & T) | Refused;
