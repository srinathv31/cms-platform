// Refusals: why something can't be done, as a stable machine `code` and the sentence people read.
//
// The code is the contract. Code that has to tell one refusal from another (the review screen hiding
// the decision buttons, Confirm revoke staying visible to the approver who started the revoke, the
// submit dialog offering Refresh summary) compares codes, never sentences, and a Spring Boot backend
// returns the same codes. The sentence is UI copy: reword it freely.
//
// Each area keeps its own table next to its rules (`REASONS` in permissions.ts, `REFUSALS` in
// lifecycle.ts, `COMMENT_REFUSALS`, `ACCESS_REFUSALS`, `PLATFORM_REFUSALS`, `STAGE_REFUSALS`), and
// `REQUEST_REFUSALS` below holds what the server refuses before any rule runs. Every entry is built with
// `refusal(code, sentence)`; `RefusalCode` is the union of every table's codes, and refusals.test.ts
// checks that no two entries share one. Import refusals keep their own codes (`IMPORT_REFUSALS`).

import type { ACCESS_REFUSALS } from "./access";
import type { STAGE_REFUSALS } from "./approval-chain";
import type { COMMENT_REFUSALS } from "./comments";
import type { REFUSALS } from "./lifecycle";
import type { REASONS } from "./permissions";
import type { PLATFORM_REFUSALS } from "./platform-config";

/** One refusal: its code, and the sentence shown where the person tried. */
export interface Refusal {
  readonly code: RefusalCode;
  readonly reason: string;
}

/** A refused result, as rules, read models (`PermissionResult`) and actions (`ActionResult`) return it. */
export type Refused = { ok: false; code: RefusalCode; reason: string };

/** A table entry with a fixed sentence. */
export interface FixedRefusal<C extends string> {
  readonly code: C;
  readonly reason: string;
}

/** A table entry whose sentence names something (a team, a stage, a count): call it for the refusal. */
export type WordedRefusal<C extends string, A extends unknown[]> = ((...args: A) => FixedRefusal<C>) & { readonly code: C };

/**
 * A table entry: `refusal("own_revoke", "You started this revoke. …")`, or, when the sentence names
 * something, `refusal("last_admin", (team: string) => \`${team} needs at least one Team Admin.\`)`, whose
 * `code` is readable without calling it.
 */
export function refusal<C extends string>(code: C, reason: string): FixedRefusal<C>;
export function refusal<C extends string, A extends unknown[]>(code: C, reason: (...args: A) => string): WordedRefusal<C, A>;
export function refusal<C extends string, A extends unknown[]>(
  code: C,
  reason: string | ((...args: A) => string),
): FixedRefusal<C> | WordedRefusal<C, A> {
  if (typeof reason === "string") return { code, reason };
  return Object.assign((...args: A): FixedRefusal<C> => ({ code, reason: reason(...args) }), { code });
}

/** The result a rule returns when it refuses. */
export function refuse({ code, reason }: Refusal): Refused {
  return { ok: false, code, reason };
}

/**
 * What the server refuses before any rule runs: input that doesn't parse or is too long, a record the
 * request names that is gone or out of the viewer's reach, a read with nothing to read, or a change
 * someone else made first. Server actions and the on-demand reads (`src/server/api/reads.ts`) return them.
 */
export const REQUEST_REFUSALS = {
  /** The input doesn't parse. The sentence is the first problem the parser found, when it has one. */
  invalidInput: refusal("invalid_input", (message?: string) => message ?? "Check the form and try again."),
  invalidDate: refusal("invalid_date", "Pick a valid date."),
  noteTooLong: refusal("note_too_long", (max: number) => `Keep the note under ${max.toLocaleString("en-US")} characters.`),
  reasonTooLong: refusal("reason_too_long", (max: number) => `Keep the reason under ${max.toLocaleString("en-US")} characters.`),
  templateGone: refusal("template_gone", "This template no longer exists."),
  /** A read's template: not found, or not one the viewer may see (the two read the same). */
  templateUnavailable: refusal("template_unavailable", "This template isn't available."),
  versionGone: refusal("version_gone", "This version no longer exists."),
  versionUnavailable: refusal("version_unavailable", "This version isn't available."),
  threadGone: refusal("thread_gone", "This comment thread no longer exists."),
  notificationGone: refusal("notification_gone", "This notification no longer exists."),
  contentTypeGone: refusal("content_type_gone", "This content type no longer exists."),
  teamGone: refusal("team_gone", "This team no longer exists."),
  requestGone: refusal("request_gone", "This request no longer exists."),
  /** A recertification review. */
  reviewGone: refusal("review_gone", "This review no longer exists."),
  noDraftToSubmit: refusal("no_draft_to_submit", "There is no draft to submit."),
  noDraftToRevert: refusal("no_draft_to_revert", "There is no draft to revert."),
  noDraftToWrite: refusal("no_draft_to_write", "There is no draft to write."),
  noBaseVersion: refusal("no_base_version", "This draft wasn't started from an earlier version."),
  noActiveVersion: refusal("no_active_version", "This template has no Active version yet."),
  /** The ⌘K palette's search: input that doesn't parse, or a space the viewer can't see. */
  invalidSearch: refusal("invalid_search", "This search can't be run."),
  spaceUnavailable: refusal("space_unavailable", "This team isn't available to you."),
  /** The compare-and-set missed: someone changed the row between the read and the write. */
  draftChanged: refusal("draft_changed", "This draft changed. Try again."),
  activeChanged: refusal("active_changed", "The Active version changed. Try again."),
} as const;

/**
 * The one code a refusal made in the browser carries: the request didn't complete (the server couldn't
 * be reached or threw, or the autosave it waited on failed). It has no sentence of its own; the screen
 * words it ("Couldn't submit. Try again.").
 */
export type ClientRefusalCode = "failed";

type CodesOf<T extends Record<string, { readonly code: string }>> = T[keyof T]["code"];

/** Every refusal code. A table missing here fails to type-check wherever its refusals are returned. */
export type RefusalCode =
  | CodesOf<typeof REASONS>
  | CodesOf<typeof REFUSALS>
  | CodesOf<typeof STAGE_REFUSALS>
  | CodesOf<typeof COMMENT_REFUSALS>
  | CodesOf<typeof ACCESS_REFUSALS>
  | CodesOf<typeof PLATFORM_REFUSALS>
  | CodesOf<typeof REQUEST_REFUSALS>
  | ClientRefusalCode;
