// The Activity tab's sentences: one plain sentence per audit event, naming who, which version, and
// the reason or note when there is one. Pure TypeScript.
//
//   "Jordan Ellis started revoking v1: Wrong APR in legal notices."
//
// It reads every AuditAction the lifecycle writes, plus the older spellings the seed uses
// (version.approved, version.revoke_confirmed, comment.resolved). A null actor is the system.

import { formatLongDate } from "./render/errors";
import type { AuditAction, Person } from "./review-types";

/** Who a null actor is: the platform itself (the seed's activations, future scheduled jobs). */
export const SYSTEM_ACTOR = "UCOMP";

export interface ActivityEvent {
  action: AuditAction | string;
  details: Record<string, unknown> | null;
  versionNumber: number | null;
}

export function describeActivity(e: ActivityEvent, actor: Person | null): string {
  const d = e.details ?? {};
  const who = actor?.name ?? SYSTEM_ACTOR;
  const n = e.versionNumber ?? numberOr(d.number);
  const v = n === null ? "the draft" : `v${n}`;

  switch (e.action) {
    case "template.created":
      return `${who} created the template.`;
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
      if (actor) return `${who} approved ${v}, making it Active.`;
      const replaced = numberOr(d.supersedes);
      return replaced === null ? `${v} became Active.` : `${v} became Active, replacing v${replaced}.`;
    }
    case "version.superseded": {
      const by = numberOr(d.supersededBy);
      return by === null ? `${v} was superseded.` : `${v} was superseded by v${by}.`;
    }
    case "version.sunset_set": {
      const at = date(d.sunsetAt);
      if (!at) return `${who} set a sunset date for ${v}.`;
      return date(d.previousSunsetAt)
        ? `${who} moved the sunset of ${v} to ${at}.`
        : `${who} set ${v} to sunset on ${at}.`;
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
      // Submitting the next version resolves the change request that sent this one back.
      const answeredBy = typeof d.resolvedWith === "number" ? d.resolvedWith : null;
      if (d.auto === true && answeredBy !== null) {
        return `${who} answered the change request on ${v} with v${answeredBy}.`;
      }
      return `${who} resolved a comment on ${v}.`;
    }
    case "thread.reopened":
      return `${who} reopened a comment on ${v}.`;
    default: {
      const summary = text(d.summary);
      if (summary) return withText(who, summary);
      const what = e.action.replace(/[._]+/g, " ");
      return n === null ? `${who}: ${what}.` : `${who}: ${what} (v${n}).`;
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

/** An ISO date in the long form ("March 1, 2027"), or "" when it isn't one. */
function date(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : formatLongDate(at);
}
