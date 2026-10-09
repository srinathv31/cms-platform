// The render contract: the channel-neutral RenderDoc, the render route's request and response, and
// the errors it can return. Pure TypeScript, shaped like the future Java API. docs/render-spec.md is
// the specification a second engine is built from; this file is its TypeScript form.
//
// The pipeline (src/server/render/render-template.ts, with the engine in src/server/render/engine.ts):
//   load version → version rules (version-rules.ts) → channel check → validate values (validate.ts)
//   → check the document (schema-check.ts) → resolve TipTap JSON into a RenderDoc (resolve.ts)
//   → channel adapter → render_log row
//
// The editor preview, the review screen and the simulator all call the same route, so what an
// approver sees is exactly what a customer gets. render_log NEVER holds variable values.

import type { BulletStyle, MarkerDelimiter, MarkerFormat } from "@/editor/model/list-markers";
import type { Channel, Variable, VariableType, VariableValues } from "../types";

export type { BulletStyle, MarkerDelimiter, MarkerFormat };

// ── RenderDoc: a resolved document, before any channel ───────────────────────
//
// Everything a channel prints is decided here, once: which blocks exist (removals are done), every
// list marker's text, every value's display text, every link's normalized href. Adapters only
// choose how it looks; they never drop, add, reorder, renumber or rewrite content. The invariants
// below hold for every RenderDoc the resolver produces (docs/render-spec.md, "The RenderDoc").

/**
 * A run of text with its marks. Variables are already resolved: a chip becomes a run holding the
 * value's display text (`formatValue`), and `variable` holds its key (adapters may use it, e.g. to
 * keep a short value from wrapping). Invariants:
 *   - `text` is never empty and is NFC-normalized;
 *   - it never contains a line break (U+000A, U+000D, U+2028, U+2029: those become `break`s), a tab
 *     (a tab becomes one space), other C0/C1 controls, or the zero-width characters U+200B–U+200D,
 *     U+2060, U+FEFF (those render as nothing);
 *   - spaces are exactly as typed: leading, trailing and repeated U+0020 and U+00A0 are content;
 *   - adjacent runs with identical marks are merged, except that a variable's run never merges.
 */
export interface RenderText {
  type: "text";
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  /** Link target, already normalized (`normalizeLink` in @/editor/model/links). A link that fails the check is dropped and its text kept. */
  href?: string;
  /** Set when the run is a resolved variable: the variable's key. */
  variable?: string;
}

/** A hard line break. Paragraph and heading content never ends with one (they are stripped). */
export interface RenderBreak {
  type: "break";
}

export type RenderInline = RenderText | RenderBreak;

/**
 * A paragraph. Its lines are its content split at breaks. A paragraph whose content is empty, or
 * only spaces and breaks, is a blank line the author typed: every channel shows it as blank
 * line(s) of the paragraph's height. (Paragraphs made only of optional variables without a value
 * are removed by the resolver and never appear here.)
 */
export interface RenderParagraph {
  type: "paragraph";
  id: string | null;
  content: RenderInline[];
}

/** A heading. Empty or blank headings render as a blank line in the heading's style. */
export interface RenderHeading {
  type: "heading";
  id: string | null;
  level: 1 | 2 | 3;
  /** The required section's key (`requiredKey`), e.g. "legal_notices"; null for ordinary headings. */
  section: string | null;
  content: RenderInline[];
}

/**
 * A bulleted list. `bullet` is resolved from the list's bullet depth (bulletList ancestors only):
 * disc, circle, square, repeating. Every item's `marker` is the style's glyph (• ◦ ▪).
 */
export interface RenderBulletList {
  type: "list";
  id: string | null;
  ordered: false;
  bullet: BulletStyle;
  /** At least one item. */
  items: RenderListItem[];
}

/**
 * A numbered list, with its style resolved: the author's `markerFormat` / `markerDelimiter`, or the
 * default for its ordered depth (orderedList ancestors only): decimal → lower-alpha → lower-roman,
 * repeating, with "period". Item i (from 0) is number `start + i` and its `marker` is
 * `formatMarker(start + i, format, delimiter)`. Items removed by the resolver are already gone, so
 * the numbers run on without a gap.
 */
export interface RenderOrderedList {
  type: "list";
  id: string | null;
  ordered: true;
  /** The first item's number, 0–9999, exactly as stored (absent in the JSON means 1). */
  start: number;
  format: MarkerFormat;
  delimiter: MarkerDelimiter;
  /** At least one item. */
  items: RenderListItem[];
}

export type RenderList = RenderBulletList | RenderOrderedList;

/**
 * A list item. `marker` is the exact text every channel prints before the item's first line:
 * "•", "◦", "▪", "1.", "iv.", "(b)", "12)". No surrounding spaces; each channel sets its own gap.
 * `content` has at least one block.
 */
export interface RenderListItem {
  marker: string;
  content: RenderBlock[];
}

/**
 * A table: a rectangular grid of `columns` columns (1–12). Every row, counting the cells that
 * rowspans from rows above carry into it, covers exactly `columns` columns.
 */
export interface RenderTable {
  type: "table";
  id: string | null;
  columns: number;
  /** At least one row. */
  rows: RenderTableRow[];
}

export interface RenderTableRow {
  /** The cells that start in this row, left to right. */
  cells: RenderTableCell[];
}

/** What a table cell may hold: paragraphs and lists (whose items may hold any block). */
export type RenderCellBlock = RenderParagraph | RenderList;

/**
 * A cell. `content` may be empty: a cell is never removed, so a cell whose only paragraph was
 * removed stays, empty.
 */
export interface RenderTableCell {
  header: boolean;
  /** 1 or more; never runs past the table's last column. */
  colspan: number;
  /** 1 or more; never runs past the table's last row. */
  rowspan: number;
  content: RenderCellBlock[];
}

/** A callout: at least one paragraph. A callout whose paragraphs were all removed is removed. */
export interface RenderCallout {
  type: "callout";
  id: string | null;
  content: RenderParagraph[];
}

export interface RenderRule {
  type: "rule";
  id: string | null;
}

/** Block ids are the document's stable block ids (`attrs.id`); null only for nested blocks without one. */
export type RenderBlock = RenderParagraph | RenderHeading | RenderList | RenderTable | RenderCallout | RenderRule;

/**
 * What every channel adapter receives. `templateName` is the rendered version's name, used only as
 * metadata (PDF title, HTML <title>). A browser tab and a PDF viewer show it, so it comes from the
 * version being rendered and changes only with an approved version. The adapters never print it in
 * the body: the title a customer reads on the page, if any, is in the document.
 * The top-level `blocks` never end with an empty paragraph (the editor's trailing line is dropped).
 */
export interface RenderDoc {
  templateId: string;
  templateName: string;
  /** null when rendering an unsubmitted draft (preview only). */
  versionNumber: number | null;
  blocks: RenderBlock[];
}

/** The email channel's resolved one-line fields, next to the RenderDoc. */
export interface EmailFields {
  subject: string;
  preheader: string;
}

/** What the email adapter returns. */
export interface EmailRender {
  subject: string;
  preheader: string;
  /** A complete HTML email document (inline styles, table layout, preheader as hidden text). */
  html: string;
  /** The plain-text alternative. */
  text: string;
}

// ── Values ───────────────────────────────────────────────────────────────────

/**
 * Values after validation: key → canonical string (see `Variable.sample`), only for variables in the
 * version's list that have a value. Optional variables without a value are absent and render empty.
 */
export type CanonicalValues = Readonly<Record<string, string>>;

export interface ResolveContext {
  variables: readonly Variable[];
  values: CanonicalValues;
}

// ── The route: POST /api/v1/templates/{templateId}/render ────────────────────

/**
 * Request body.
 *
 * Headers:
 *   X-Consumer-Id     required unless `preview` (a registered consumer id: "coral", "deposits-online")
 *   X-Correlation-Id  optional; generated when absent; echoed on every response and in render_log
 *
 * A consumer pins a version number. `"draft"` (the open draft) is allowed only with `preview`.
 * `preview` is the CMS's own preview: the persona cookie must be able to view the template, any
 * version state renders (version rules are skipped), and the render_log row is tagged as a preview
 * with no consumer, so it never counts toward usage.
 *
 * The body is at most MAX_BODY_BYTES, and each value at most MAX_VALUE_LENGTH characters.
 */
export interface RenderRequestBody {
  version: number | "draft";
  channel: Channel;
  /** key → value, canonical ("21.99", "2027-03-04", "NJ") or friendly ("21.99%", "3/4/2027", "New Jersey"). Unknown keys are ignored. */
  values: VariableValues;
  /** Opt-in for consumers that can't take binary: the body comes back as JSON with base64 content. */
  encoding?: "base64";
  preview?: boolean;
}

/**
 * The largest body the route reads, in bytes. A larger one is 413 body_too_large, whether its
 * Content-Length says so or the count passes it while the body is read (a chunked body has no length).
 */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * The most characters one value may have, as sent, counted in Unicode code points (what JSON Schema's
 * `maxLength` counts; Java: `codePointCount`). A longer value is invalid_values, never cut: values
 * print exactly as sent. A variable holds a name, an amount, a sentence or an address, not a document
 * (docs/decisions/0011-cap-each-render-value.md).
 */
export const MAX_VALUE_LENGTH = 1_000;

/**
 * Success. Every 200 carries these headers:
 *   X-Correlation-Id       the request's, or the generated one
 *   X-Stencil-Template-Id    "UC-4F7K2Q"
 *   X-Stencil-Version        "2", or "draft"
 *   X-Stencil-Newer-Version  "3", only when the rendered version is Superseded (still renders until its sunset)
 *   X-Stencil-Preview        "true", only on previews
 *
 * Bodies:
 *   pdf    application/pdf (bytes); Content-Disposition: inline; filename="UC-4F7K2Q-v2.pdf" ("…-draft.pdf")
 *   web    text/html; charset=utf-8 (a complete, responsive HTML document)
 *   email  application/json: EmailResponseBody
 *   any channel with encoding "base64": application/json: Base64ResponseBody (pdf, web) or
 *          EmailResponseBody with `encoding: "base64"` and base64 `html` and `text` (email)
 */
export interface EmailResponseBody extends EmailRender {
  /** The Active version's number when the rendered version is Superseded; otherwise null. */
  newerVersion: number | null;
  encoding?: "base64";
}

export interface Base64ResponseBody {
  channel: "pdf" | "web";
  contentType: "application/pdf" | "text/html; charset=utf-8";
  encoding: "base64";
  data: string;
  newerVersion: number | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Every error is JSON `{ error: { code, message, details? } }` with the status below. Messages are
 * exact, plain sentences for the people integrating (and the simulator shows them as is). They never
 * echo a submitted value.
 *
 * | status | code                  | message (examples)                                                       |
 * | 400    | bad_request           | "The body must be JSON with version, channel and values."                 |
 * |        |                       | "channel must be one of pdf, web, email."  "version must be a version number." |
 * | 400    | consumer_required     | "X-Consumer-Id is required."                                              |
 * | 413    | body_too_large        | "The body must be at most 1,000,000 bytes."                              |
 * | 403    | unknown_consumer      | "Consumer \"acme\" isn't registered."                                     |
 * | 403    | preview_forbidden     | "You can't preview this template."                                        |
 * | 404    | template_not_found    | "Template UC-4F7K2Q doesn't exist."                                       |
 * | 404    | version_not_found     | "Template UC-4F7K2Q has no version 7." / "Template UC-4F7K2Q has no open draft." |
 * | 409    | version_not_released  | "Version 3 is in review. Version 2 is active." / "… No version is active yet." |
 * | 410    | version_sunset        | "Version 1 was sunset on March 1, 2027. Version 2 is active."             |
 * | 410    | version_revoked       | "Version 1 was revoked on March 1, 2027. Version 2 is active."            |
 * | 422    | channel_not_allowed   | "Disclosures don't render to sms." (the content type doesn't allow it)    |
 * | 422    | channel_not_enabled   | "Version 2 doesn't render to Email. Its channels are PDF and Web."        |
 * | 422    | missing_variables     | "Missing required variables: first_name, purchase_apr."                   |
 * | 422    | invalid_values        | "purchase_apr must be a percentage, like 21.99."                          |
 * |        |                       | "first_name must be at most 1,000 characters." (longer than MAX_VALUE_LENGTH) |
 * | 500    | render_failed         | "The PDF couldn't be rendered. Try again."                                |
 * |        |                       | "The PDF couldn't be rendered. Tables can have at most 12 columns." (document check) |
 * |        |                       | "The PDF couldn't be rendered. Its font can't show these characters: U+1EA1 (ạ)." |
 *
 * When values are both missing and invalid, the code is `missing_variables` and the message is the
 * missing sentence followed by the invalid ones. `details` for both value codes is ValueErrorDetails.
 */
export type RenderErrorCode =
  | "bad_request"
  | "consumer_required"
  | "body_too_large"
  | "unknown_consumer"
  | "preview_forbidden"
  | "template_not_found"
  | "version_not_found"
  | "version_not_released"
  | "version_sunset"
  | "version_revoked"
  | "channel_not_allowed"
  | "channel_not_enabled"
  | "missing_variables"
  | "invalid_values"
  | "render_failed";

export const RENDER_ERROR_STATUS: Readonly<Record<RenderErrorCode, number>> = {
  bad_request: 400,
  consumer_required: 400,
  body_too_large: 413,
  unknown_consumer: 403,
  preview_forbidden: 403,
  template_not_found: 404,
  version_not_found: 404,
  version_not_released: 409,
  version_sunset: 410,
  version_revoked: 410,
  channel_not_allowed: 422,
  channel_not_enabled: 422,
  missing_variables: 422,
  invalid_values: 422,
  render_failed: 500,
};

export interface InvalidValue {
  key: string;
  expected: VariableType;
  /** Set when the value is longer than this many characters (MAX_VALUE_LENGTH), whatever its type. */
  maxLength?: number;
}

export interface ValueErrorDetails {
  /** Required keys with no value, in the version's variable order. */
  missing: string[];
  /** Keys whose value doesn't fit the type, in the version's variable order. */
  invalid: InvalidValue[];
}

/**
 * `details` of a render_failed the caller can act on (docs/render-spec.md, "Errors"): the stored
 * document failed the document check, or the PDF font can't draw some characters ("U+1EA1", in the
 * order they first appear). An unexpected failure has no details.
 */
export type RenderFailedDetails = { reason: "document" } | { reason: "glyphs"; characters: string[] };

export interface VersionErrorDetails {
  version: number;
  activeVersion: number | null;
  /** ISO timestamp of the sunset or revoke, when there is one. */
  at?: string;
}

export interface RenderError {
  code: RenderErrorCode;
  message: string;
  details?: ValueErrorDetails | VersionErrorDetails | RenderFailedDetails | Record<string, unknown>;
}

export interface RenderErrorBody {
  error: RenderError;
}

// ── render_log ───────────────────────────────────────────────────────────────

/**
 * One row per render that reached a known template and version (requests rejected before that are
 * not logged). The ONLY fields written; there is deliberately no place for values, the request body,
 * or rendered output.
 */
export interface RenderLogEntry {
  templateId: string;
  versionId: string;
  versionNumber: number | null;
  consumerId: string | null; // null on previews
  channel: Channel;
  isPreview: boolean;
  correlationId: string;
  outcome: "ok" | "error";
  errorCode: RenderErrorCode | null;
  durationMs: number;
}
