// Refusals: why something can't be done, as a stable machine `code` and the sentence people read.
//
// The code is the contract. Code that has to tell one refusal from another (the review screen hiding
// the decision buttons, Confirm revoke staying visible to the approver who started the revoke, the
// submit dialog offering Refresh summary) compares codes, never sentences, and a Spring Boot backend
// returns the same codes. The sentence is UI copy: reword it freely.
//
// Each area keeps its own table next to its rules (`REASONS` in permissions.ts, `REFUSALS` in
// lifecycle/refusals.ts, `COMMENT_REFUSALS`, `ACCESS_REFUSALS`, `PLATFORM_REFUSALS`, `STAGE_REFUSALS`,
// `OUTPUT_REFUSALS` in review-outputs.ts, `IMPORT_REFUSALS` in import-types.ts, `DEMO_REFUSALS` in demo.ts), and
// `REQUEST_REFUSALS` below holds what the server refuses before any rule runs. Every entry is built with
// `refusal(code, sentence)`; `RefusalCode` is the union of every table's codes, and refusals.test.ts
// checks that no two entries share one. Server actions, the on-demand reads and Stencil's own route
// handlers (autosave, import, the audit export) all answer a refusal as `{ ok: false, code, reason }`
// (decision 0041); only `/api/v1` has a shape of its own.

import type { ACCESS_REFUSALS } from "./access/refusals";
import { formatCount } from "./numbers";
import type { STAGE_REFUSALS } from "./approval-chain";
import type { COMMENT_REFUSALS } from "./comments";
import type { DEMO_REFUSALS } from "./demo";
import type { IMPORT_REFUSALS } from "./import-types";
import type { REFUSALS } from "./lifecycle/refusals";
import type { REASONS } from "./permissions";
import type { PLATFORM_REFUSALS } from "./platform-config/refusals";
import type { OUTPUT_REFUSALS } from "./review-outputs";

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
export type WordedRefusal<C extends string, A extends unknown[]> = ((
  ...args: A
) => FixedRefusal<C>) & { readonly code: C };

/**
 * A table entry: `refusal("own_revoke", "You started this revoke. …")`, or, when the sentence names
 * something, `refusal("last_admin", (team: string) => \`${team} needs at least one Team Admin.\`)`, whose
 * `code` is readable without calling it.
 */
export function refusal<C extends string>(
  code: C,
  reason: string,
): FixedRefusal<C>;
export function refusal<C extends string, A extends unknown[]>(
  code: C,
  reason: (...args: A) => string,
): WordedRefusal<C, A>;
export function refusal<C extends string, A extends unknown[]>(
  code: C,
  reason: string | ((...args: A) => string),
): FixedRefusal<C> | WordedRefusal<C, A> {
  if (typeof reason === "string") return { code, reason };
  return Object.assign(
    (...args: A): FixedRefusal<C> => ({ code, reason: reason(...args) }),
    { code },
  );
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
  /**
   * Nobody is signed in: the request context found no viewer (src/server/context/request.ts). An action
   * answers it; a read route answers it with 401.
   */
  signedOut: refusal("signed_out", "Sign in to continue."),
  /** The input doesn't parse. The sentence is the first problem the parser found, when it has one. */
  invalidInput: refusal(
    "invalid_input",
    (message?: string) => message ?? "Check the form and try again.",
  ),
  invalidDate: refusal("invalid_date", "Pick a valid date."),
  noteTooLong: refusal(
    "note_too_long",
    (max: number) => `Keep the note under ${formatCount(max)} characters.`,
  ),
  reasonTooLong: refusal(
    "reason_too_long",
    (max: number) => `Keep the reason under ${formatCount(max)} characters.`,
  ),
  templateGone: refusal("template_gone", "This template no longer exists."),
  /** A read's template: not found, or not one the viewer may see (the two read the same). */
  templateUnavailable: refusal(
    "template_unavailable",
    "This template isn't available.",
  ),
  versionGone: refusal("version_gone", "This version no longer exists."),
  versionUnavailable: refusal(
    "version_unavailable",
    "This version isn't available.",
  ),
  threadGone: refusal("thread_gone", "This comment thread no longer exists."),
  notificationGone: refusal(
    "notification_gone",
    "This notification no longer exists.",
  ),
  contentTypeGone: refusal(
    "content_type_gone",
    "This content type no longer exists.",
  ),
  teamGone: refusal("team_gone", "This team no longer exists."),
  requestGone: refusal("request_gone", "This request no longer exists."),
  /** A recertification review. */
  reviewGone: refusal("review_gone", "This review no longer exists."),
  noDraftToSubmit: refusal(
    "no_draft_to_submit",
    "There is no draft to submit.",
  ),
  noDraftToRevert: refusal(
    "no_draft_to_revert",
    "There is no draft to revert.",
  ),
  noDraftToWrite: refusal("no_draft_to_write", "There is no draft to write."),
  /** The Copilot prompt asks for a document's body: an alert has none (decision 0034). */
  copilotDocumentsOnly: refusal(
    "copilot_documents_only",
    "Copilot drafts documents only.",
  ),
  noBaseVersion: refusal(
    "no_base_version",
    "This draft wasn't started from an earlier version.",
  ),
  noActiveVersion: refusal(
    "no_active_version",
    "This template has no Active version yet.",
  ),
  /** An autosave to a version that has left the draft state (submitted, or reverted) since the page loaded. */
  versionNotDraft: refusal(
    "version_not_draft",
    "This version is no longer a draft.",
  ),
  /** An autosave whose body is over the cap (HTTP 413). */
  draftTooLarge: refusal("draft_too_large", "The draft is too large to save."),
  /** An import's original that is gone, or belongs to a template in a space the viewer can't see. */
  uploadUnavailable: refusal(
    "upload_unavailable",
    "This file isn't available.",
  ),
  /** The ⌘K palette's search: input that doesn't parse, or a space the viewer can't see. */
  invalidSearch: refusal("invalid_search", "This search can't be run."),
  spaceUnavailable: refusal(
    "space_unavailable",
    "This team isn't available to you.",
  ),
  /** The compare-and-set missed: someone changed the row between the read and the write. */
  draftChanged: refusal("draft_changed", "This draft changed. Try again."),
  /**
   * A command's compare-and-set on a version missed: someone else changed it between the command's read and its
   * write (on a database that doesn't serialize writes, two people acting at once). Nothing was written.
   */
  versionChanged: refusal(
    "version_changed",
    "This version changed. Reload and try again.",
  ),
  /** Edit: the version the new draft was to copy changed state before it was read. */
  latestChanged: refusal(
    "latest_changed",
    "The latest version changed. Try again.",
  ),
} as const;

/**
 * The one code a refusal made in the browser carries: the request didn't complete (the server couldn't
 * be reached or threw, or the autosave it waited on failed). It has no sentence of its own; the screen
 * words it ("Couldn't submit. Try again.").
 */
export type ClientRefusalCode = "failed";

type CodesOf<T extends Record<string, { readonly code: string }>> =
  T[keyof T]["code"];

/** Every refusal code. A table missing here fails to type-check wherever its refusals are returned. */
export type RefusalCode =
  | CodesOf<typeof REASONS>
  | CodesOf<typeof REFUSALS>
  | CodesOf<typeof STAGE_REFUSALS>
  | CodesOf<typeof COMMENT_REFUSALS>
  | CodesOf<typeof ACCESS_REFUSALS>
  | CodesOf<typeof PLATFORM_REFUSALS>
  | CodesOf<typeof OUTPUT_REFUSALS>
  | CodesOf<typeof IMPORT_REFUSALS>
  | CodesOf<typeof DEMO_REFUSALS>
  | CodesOf<typeof REQUEST_REFUSALS>
  | ClientRefusalCode;
