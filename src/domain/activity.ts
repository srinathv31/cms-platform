// The Activity tab's sentences: one plain sentence per audit event, naming who, which version, and
// the reason or note when there is one. Pure TypeScript.
//
//   "Jordan Ellis started revoking v1: Wrong APR in legal notices."
//
// It reads every AuditAction the lifecycle and the sunset sweep write, plus the older spellings the seed
// uses (version.approved, version.revoke_confirmed, comment.resolved). A null actor is the system.
//
// A review event names the round as the review history does (rounds.ts, `history`): "Maya Chen submitted
// v3, round 1 for review.", "Jordan Ellis approved v2 on round 3, making it Active." Every other event is
// about the released version consumers know, "v2".

import { recordedSunsetDay } from "./business-zone";
import { formatLongDate, formatRecordedDate } from "./dates";
import type { AuditAction, Person } from "./review-types";
import { versionLabel, type LabelStyle, type NumberedRound } from "./rounds";

/** Who a null actor is: the platform itself (the seed's activations, the sunset sweep). */
export const SYSTEM_ACTOR = "Stencil";
export const SYSTEM_INITIALS = "S";

export interface ActivityEvent {
  action: AuditAction | string;
  details: Record<string, unknown> | null;
  /**
   * The version row the event is about, as it is now; null when it is the open draft or there is none.
   * Without one, the event's details name it (`number`, `round`).
   */
  version: NumberedRound | null;
}

/** The events of a version's review: their sentences and labels name the round, as the review history does. */
export const REVIEW_EVENT_ACTIONS: ReadonlySet<string> = new Set([
  "version.submitted",
  "version.changes_requested",
  "version.stage_approved",
  "version.approved",
  "version.activated",
  "comment.added",
  "thread.resolved",
  "comment.resolved",
  "thread.reopened",
]);

/**
 * The version an event is about, as its row or sentence names it: the round for a review event (with
 * history), the plain "vN" for the rest (sunsets and revokes are about the released version). Null for none.
 */
export function eventVersionLabel(action: string, v: NumberedRound | null, style: LabelStyle = "chrome"): string | null {
  return v === null ? null : versionLabel(v, { style, history: REVIEW_EVENT_ACTIONS.has(action) });
}

export function describeActivity(e: ActivityEvent, actor: Person | null): string {
  const d = e.details ?? {};
  const who = actor?.name ?? SYSTEM_ACTOR;
  const version = e.version ?? fromDetails(d);
  const v = eventVersionLabel(e.action, version, "sentence") ?? "the draft";

  switch (e.action) {
    case "template.created": {
      // Phase 7a: an import names the file it came from ("Maya Chen imported Spring offer.docx.").
      const file = text(d.filename);
      return typeof d.source === "string" && d.source.startsWith("import:") && file
        ? `${who} imported ${file}${/[.!?]$/.test(file) ? "" : "."}`
        : `${who} created the template.`;
    }
    case "draft.started": {
      const from = numberOr(d.basedOn);
      return from === null ? `${who} started a draft.` : `${who} started a draft from v${from}.`;
    }
    case "draft.edited":
      return `${who} edited the draft.`;
    case "version.submitted":
      return withText(`${who} submitted ${v} for review`, d.note);
    case "version.changes_requested":
      return withText(`${who} requested changes on ${v}`, d.reason);
    case "version.stage_approved":
    case "version.approved": {
      const stage = text(d.stage);
      return stage ? `${who} approved ${v} (${stage}).` : `${who} approved ${v}.`;
    }
    case "version.activated": {
      // The released number, and the round it was approved on when that wasn't the first.
      const live = version === null ? v : `v${version.number}`;
      if (actor) {
        return version !== null && version.round > 1
          ? `${who} approved ${live} on round ${version.round}, making it Active.`
          : `${who} approved ${live}, making it Active.`;
      }
      const replaced = numberOr(d.supersedes);
      return replaced === null ? `${live} became Active.` : `${live} became Active, replacing v${replaced}.`;
    }
    case "version.superseded": {
      const by = numberOr(d.supersededBy);
      return by === null ? `${v} was superseded.` : `${v} was superseded by v${by}.`;
    }
    case "version.sunset_set": {
      // The day as picked, read in the business time zone it was set in.
      const day = recordedSunsetDay(d);
      const at = day ? formatLongDate(day) : "";
      if (!at) return `${who} set a sunset date for ${v}.`;
      return formatRecordedDate(d.previousSunsetAt)
        ? `${who} moved the sunset of ${v} to ${at}.`
        : `${who} set ${v} to sunset on ${at}.`;
    }
    case "version.sunset_passed": {
      // Written by the sweep (SunsetPassedDetails): the day is the sunset's, in the business time zone.
      const day = recordedSunsetDay(d);
      return day ? `${v} stopped rendering: its sunset passed on ${formatLongDate(day)}.` : `${v} stopped rendering: its sunset passed.`;
    }
    case "version.revoke_started":
      return withText(`${who} started revoking ${v}`, d.reason);
    case "version.revoke_cancelled":
      return `${who} canceled the revoke of ${v}.`;
    case "version.revoked":
    case "version.revoke_confirmed":
      return withText(`${who} confirmed the revoke of ${v}`, d.reason);
    case "comment.added":
      return `${who} commented on ${v}.`;
    case "thread.resolved":
    case "comment.resolved": {
      // Submitting the next round resolves the change request that sent this one back. A row from before
      // rounds names the next version instead.
      const answeredBy = numberOr(d.resolvedWith);
      if (d.auto === true && answeredBy !== null) {
        const round = numberOr(d.resolvedWithRound);
        const next = round !== null && answeredBy === version?.number ? `round ${round}` : `v${answeredBy}`;
        return `${who} answered the change request on ${v} with ${next}.`;
      }
      return `${who} resolved a comment on ${v}.`;
    }
    case "thread.reopened":
      return `${who} reopened a comment on ${v}.`;
    default: {
      const summary = text(d.summary);
      if (summary) return withText(who, summary);
      const what = e.action.replace(/[._]+/g, " ");
      return version === null ? `${who}: ${what}.` : `${who}: ${what} (${v}).`;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "Stem: the text." with one closing period; just "Stem." when there's no text. Whitespace collapses. */
function withText(stem: string, value: unknown): string {
  const t = text(value);
  if (!t) return `${stem}.`;
  return `${stem}: ${t}${/[.!?]$/.test(t) ? "" : "."}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function numberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The version an event's details name, when its row doesn't: `number`, and `round` (1 when a row from
 * before rounds has none). The state isn't recorded, so its round shows past the first.
 */
function fromDetails(d: Record<string, unknown>): NumberedRound | null {
  const number = numberOr(d.number);
  if (number === null) return null;
  return { number, round: numberOr(d.round) ?? 1, state: "in_review" };
}
