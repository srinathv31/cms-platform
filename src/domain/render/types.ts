// The render contract: the channel-neutral RenderDoc, the render route's request and response, and
// the errors it can return. Pure TypeScript, shaped like the future Java API.
//
// The pipeline (src/server/render/render-template.ts):
//   load version → version rules (version-rules.ts) → channel check → validate values (validate.ts)
//   → resolve TipTap JSON into a RenderDoc (resolve.ts) → channel adapter → render_log row
//
// The editor preview, the review screen and the simulator all call the same route, so what an
// approver sees is exactly what a customer gets. render_log NEVER holds variable values.

import type { Channel, Variable, VariableType, VariableValues } from "../types";

// ── RenderDoc: a resolved document, before any channel ───────────────────────

/**
 * Inline text with its marks. Variables are already resolved: a chip becomes a run with the value
 * formatted for its type (`formatValue`), and `variable` holds its key (adapters may use it, e.g. to
 * keep a long value from breaking mid-word). Text never contains "\n"; a hard break is a `break`.
 */
export interface RenderText {
  type: "text";
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  /** Link mark. Only http(s), mailto and tel survive resolution; anything else drops the link, keeps the text. */
  href?: string;
  /** Set when the run is a resolved variable. */
  variable?: string;
}

export interface RenderBreak {
  type: "break";
}

export type RenderInline = RenderText | RenderBreak;

/** Block ids are the document's stable block ids (`attrs.id`); null only for nested blocks without one. */
export type RenderBlock =
  | { type: "paragraph"; id: string | null; content: RenderInline[] }
  | {
      type: "heading";
      id: string | null;
      level: 1 | 2 | 3;
      /** The required section's key (`requiredKey`), e.g. "legal_notices"; null for ordinary headings. */
      section: string | null;
      content: RenderInline[];
    }
  | { type: "list"; id: string | null; ordered: boolean; start: number; items: RenderListItem[] }
  | { type: "table"; id: string | null; rows: RenderTableRow[] }
  | { type: "callout"; id: string | null; content: RenderBlock[] }
  | { type: "rule"; id: string | null };

export interface RenderListItem {
  content: RenderBlock[];
}

export interface RenderTableRow {
  cells: RenderTableCell[];
}

export interface RenderTableCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  content: RenderBlock[];
}

/**
 * What every channel adapter receives. `templateName` is internal metadata (PDF title, HTML <title>);
 * the adapters never print it in the body: the customer-facing title, if any, is in the document.
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
 * | 500    | render_failed         | "The PDF couldn't be rendered. Try again."                                |
 *
 * When values are both missing and invalid, the code is `missing_variables` and the message is the
 * missing sentence followed by the invalid ones. `details` for both value codes is ValueErrorDetails.
 */
export type RenderErrorCode =
  | "bad_request"
  | "consumer_required"
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
}

export interface ValueErrorDetails {
  /** Required keys with no value, in the version's variable order. */
  missing: string[];
  /** Keys whose value doesn't fit the type, in the version's variable order. */
  invalid: InvalidValue[];
}

export interface VersionErrorDetails {
  version: number;
  activeVersion: number | null;
  /** ISO timestamp of the sunset or revoke, when there is one. */
  at?: string;
}

export interface RenderError {
  code: RenderErrorCode;
  message: string;
  details?: ValueErrorDetails | VersionErrorDetails | Record<string, unknown>;
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
