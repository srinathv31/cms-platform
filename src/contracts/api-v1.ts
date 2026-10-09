// The published consumer API, /api/v1: the wire shapes a consumer (Coral) compiles against.
//
// This file stands in for the OpenAPI document a real consumer would generate a client from. It is
// self-contained on purpose (no imports): UCOMP's route handlers and the consumer simulator both use it,
// and the simulator may not import @/domain or @/server (the ESLint boundary). UCOMP-side code keeps
// its richer types in src/domain; `src/domain/golive-types.ts` checks at compile time that the domain's
// render types still fit the shapes declared here, so the two can't drift.
//
// Phase 5 (going live). Endpoints:
//   GET  /api/v1/templates                          search, Active templates only     → ApiTemplateSearch (paged)
//   GET  /api/v1/templates/{id}                     metadata + contract (+ changes)    → ApiTemplateDetail
//   GET  /api/v1/consumers/{consumerId}/notices     UCOMP's outbox for one consumer    → ApiNoticeList (paged)
//   POST /api/v1/templates/{id}/render              (Phase 3; contract in src/domain/render/types.ts)
//
// Every request carries `X-Consumer-Id` (a registered consumer: "coral", "deposits-online"); the render
// route alone waives it for the CMS's own previews. `X-Correlation-Id` is optional and echoed back.
// Every response is `Cache-Control: no-store`. Errors are always `ApiErrorBody` with the status in
// API_ERROR_STATUS (src/domain/golive-types.ts). Dates are ISO 8601 strings on the demo clock.

// ── Shared vocabulary (mirrors src/domain/types.ts; checked there) ──────────────

export type ApiChannel = "pdf" | "web" | "email";
export type ApiVariableType = "text" | "currency" | "percent" | "date" | "number" | "us_state";
/** The states a consumer can see. Drafts and versions in review never leave UCOMP. */
export type ApiVersionState = "active" | "superseded" | "revoked";

export type ApiErrorCode =
  // the render route's codes (src/domain/render/types.ts RenderErrorCode)
  | "bad_request"
  | "consumer_required"
  | "body_too_large" // 413: the body is over 1,000,000 bytes
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
  | "render_failed"
  // Phase 5: the notices endpoint
  | "consumer_not_found" // 404: the path names a consumer that isn't registered
  | "consumer_mismatch"; // 403: X-Consumer-Id isn't the consumer in the path

export interface ApiError {
  code: ApiErrorCode;
  /** One exact, plain sentence. Shown to people as is (the simulator prints it in the results grid). */
  message: string;
  details?: ApiValueErrorDetails | ApiVersionErrorDetails | Record<string, unknown>;
}

/** missing_variables / invalid_values: keys only, never values. */
export interface ApiValueErrorDetails {
  missing: string[];
  /** `maxLength` is set when the value was longer than that many characters (1000), whatever its type. */
  invalid: { key: string; expected: ApiVariableType; maxLength?: number }[];
}

/** version_sunset / version_revoked / version_not_released. */
export interface ApiVersionErrorDetails {
  version: number;
  activeVersion: number | null;
  at?: string;
}

export interface ApiErrorBody {
  error: ApiError;
}

// ── Paging (search and notices) ─────────────────────────────────────────────────

/**
 * A list that pages. Ask for the next page by passing `nextCursor` back as `after`; read on until
 * `hasMore` is false.
 * - `nextCursor` is always present. On the last page (even an empty one) it marks the end of the list,
 *   so a later call with it returns only what came after: for notices, exactly the ones written since.
 * - `hasMore`: true when more items follow this page right now.
 * A cursor is opaque: keep it as is, don't build or edit one. It belongs to the list it came from (the
 * same consumer and `templateId`, or the same `q`); any other `after` is 400 bad_request
 * ("after must be the nextCursor of an earlier page of this list."). A notices cursor from before the
 * demo was reset is 400 bad_request too ("after is from before the notices were reset. Start again
 * without after."): the notices were renumbered, so read them again from the start.
 */
export interface ApiPage {
  /** Pass as `after` to continue where this page ended. */
  nextCursor: string;
  hasMore: boolean;
}

// ── GET /api/v1/templates?q=&limit=&after= ──────────────────────────────────────

/**
 * Search. ONLY templates with an Active version are returned (a consumer can't link anything else).
 * - `q` (optional, trimmed): a template id, case-insensitive, with or without "UC-" ("uc-4f7k2q",
 *   "4F7K2Q"); or words matched case-insensitively against the Active version's name (every word must appear).
 *   Empty `q` lists every Active template.
 * - `limit` (optional): results per page, 1–50, default 20.
 * - `after` (optional): the `nextCursor` of an earlier page for the same `q` (ApiPage).
 * Order: an exact id match first, then names that start with the query, then the rest; ties by name,
 * then id, both compared by Unicode code point (capitals before lower case; not a locale's collation).
 * Pages follow that order and never overlap.
 * Errors: 400 consumer_required, 403 unknown_consumer, 400 bad_request ("limit must be a number from 1 to 50.",
 * or ApiPage's sentence for a bad `after`).
 */
export interface ApiTemplateSearch extends ApiPage {
  query: string;
  /** Demo-clock time the answer was computed at. */
  asOf: string;
  results: ApiTemplateSummary[];
}

export interface ApiTemplateSummary {
  id: string; // "UC-4F7K2Q"
  /** The Active version's name. Each version keeps the name it was approved with; a rename arrives with a new version. */
  name: string;
  team: { id: string; name: string };
  contentType: { key: string; name: string }; // { key: "disclosure", name: "Disclosure" }
  activeVersion: number;
  activatedAt: string;
  /** The Active version's channels. */
  channels: ApiChannel[];
  variableCount: number;
  requiredCount: number;
}

// ── GET /api/v1/templates/{id}?version=&since= ──────────────────────────────────

/**
 * One template: its released versions and one version's contract.
 * - `version` (optional): the version whose contract to return. Default: the Active version. A
 *   Superseded or Revoked version is allowed (a consumer pinned to it can still read its contract).
 * - `since` (optional): a lower released version number. Adds `changes`: what changed in the contract
 *   from `since` to `version` (or to Active). This is how a consumer pinned on v2 sees what moving to
 *   v3 asks of it.
 * Errors:
 *   404 template_not_found  the id doesn't exist, OR the template has no released version yet
 *                           (unreleased templates are invisible to consumers)
 *   404 version_not_found   no version with that number
 *   409 version_not_released the number exists but is in review / changes requested
 *   400 bad_request         "version must be a version number." / "since must be lower than version."
 *   400 consumer_required, 403 unknown_consumer
 * A template with released versions but none Active (all revoked) answers 200 with
 * `activeVersion: null` and `contract: null` unless `version` names one.
 */
export interface ApiTemplateDetail {
  id: string;
  /**
   * The Active version's name. With none Active (it was revoked), the name of the newest version that
   * still renders; with nothing rendering, the newest released version's. `contract.jsonSchema.title`
   * names the contract's own version.
   */
  name: string;
  team: { id: string; name: string };
  contentType: { key: string; name: string };
  asOf: string;
  activeVersion: number | null;
  /** Released versions only, newest first. */
  versions: ApiVersionSummary[];
  contract: ApiContract | null;
  changes?: ApiContractDiff;
}

export interface ApiVersionSummary {
  number: number;
  state: ApiVersionState;
  activatedAt: string;
  supersededAt: string | null;
  /**
   * The instant a Superseded version stops rendering: 00:00 on its sunset date in Stencil's business time
   * zone (America/New_York unless an admin changed it), so "March 1" is 2027-03-01T05:00:00.000Z. Null when
   * none is set.
   */
  sunsetAt: string | null;
  /** True once `sunsetAt` has passed on the demo clock: renders now fail with version_sunset. */
  sunsetPassed: boolean;
  revokedAt: string | null;
  /** True when a render of this version would succeed right now (Active, or Superseded before its sunset). */
  renders: boolean;
  channels: ApiChannel[];
}

/** A version's variable contract. Keys are snake_case; values go in the render body's `values`. */
export interface ApiContract {
  version: number;
  state: ApiVersionState;
  channels: ApiChannel[];
  variables: ApiVariable[];
  /** JSON Schema (draft 2020-12) for the render body's `values` object. */
  jsonSchema: ApiJsonSchema;
}

export interface ApiVariable {
  key: string;
  label: string;
  type: ApiVariableType;
  required: boolean;
  /** A valid canonical value: "Maya", "1000", "21.99", "2027-03-04", "20000", "NJ". */
  example: string;
}

/**
 * One change from a version's variable contract to a later one's. `key` is the variable's key in the later
 * version (in the earlier one for `removed`). A renamed key is one `key_renamed` change, `from` the key sent
 * before and `to` the key to send now: map the value across rather than drop one variable and add another.
 * `text` is one plain sentence: "v3 adds required `annual_fee` (Currency)."
 */
export type ApiContractChange =
  | { kind: "added" | "removed" | "made_required" | "made_optional"; key: string; breaking: boolean; text: string }
  | { kind: "key_renamed"; key: string; breaking: true; from: string; to: string; text: string }
  | { kind: "type_changed"; key: string; breaking: true; from: ApiVariableType; to: ApiVariableType; text: string }
  | { kind: "label_changed"; key: string; breaking: false; from: string; to: string; text: string };

export interface ApiContractDiff {
  since: number;
  to: number;
  breaking: boolean;
  items: ApiContractChange[];
  /** Required keys a consumer moving from `since` must newly supply (added required, renamed, made required, retyped). */
  newRequired: string[];
}

/** The subset of JSON Schema the contract uses. */
export interface ApiJsonSchema {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  $id: string; // "https://stencil.example/schemas/UC-4F7K2Q/v2/values.json"
  title: string; // "Spring Travel Rewards — Terms v2: values"
  type: "object";
  properties: Record<string, ApiJsonSchemaProperty>;
  required: string[];
  additionalProperties: true; // unknown keys are ignored by the render route
}

export interface ApiJsonSchemaProperty {
  title: string; // the variable's label
  description: string; // "Currency, canonical form like 1000 or 1000.50. Renders as $1,000.50, digits exactly as sent."
  type: "string"; // the canonical forms are strings (the route also takes JSON numbers, read from their source text; not advertised)
  minLength?: number; // a required text: 1, with pattern "\\S" (blank counts as missing)
  maxLength: number; // every value: 1000 characters (Unicode code points); a longer one is 422 invalid_values
  pattern?: string;
  format?: "date";
  enum?: string[]; // us_state: the two-letter codes
  examples: string[];
}

// ── GET /api/v1/consumers/{consumerId}/notices?after=&templateId=&limit= ────────

/**
 * UCOMP's outbox for one consumer: new versions, sunsets scheduled, revokes. Oldest first, in the order
 * UCOMP wrote them, paged with a cursor (ApiPage).
 * Notices go to every consumer that rendered the template (not as a preview) in the 90 days before the
 * event. Read state is the consumer's business (the simulator keeps it in sim_notice_reads).
 * - `X-Consumer-Id` must equal `{consumerId}` → else 403 consumer_mismatch
 *   ("X-Consumer-Id doesn't match consumer coral."). An unregistered `{consumerId}` → 404 consumer_not_found.
 * - `after` (optional): the `nextCursor` of an earlier page. Without it the list starts at the
 *   consumer's oldest notice.
 * - `templateId` (optional): one template's notices. A cursor keeps to the filter it was made with.
 * - `limit` (optional): notices per page, 1–200, default 50.
 * To poll, keep the last `nextCursor` and call with it: every notice arrives once and in order, however
 * many were written in between. To start without the history, page to the end once and keep that
 * `nextCursor`.
 */
export interface ApiNoticeList extends ApiPage {
  consumerId: string;
  asOf: string;
  notices: ApiNotice[];
}

export type ApiNoticeKind = "new_version" | "sunset_scheduled" | "revoked";

export interface ApiNotice {
  id: string;
  kind: ApiNoticeKind;
  createdAt: string;
  /** `name` is the name of the version the notice is about, as it was when the notice was written. */
  template: { id: string; name: string };
  /** The version the notice is about: the new one (new_version), the one being sunset, the revoked one. */
  versionNumber: number;
  /** The Active version when the notice was written (null when nothing is Active). */
  activeVersion: number | null;
  /** sunset_scheduled only: the instant renders stop, 00:00 on the sunset date in the business time zone. */
  sunsetAt: string | null;
  /** revoked only. */
  reason: string | null;
  /** new_version: the contract changes from the previous Active version. sunset_scheduled: what moving to the Active one asks. */
  changes: ApiContractChange[];
  /**
   * One plain sentence, e.g.
   *   new_version       "Spring Travel Rewards — Terms v3 is available. It adds the required variable annual_fee."
   *                     "Rate Change Notice v2 is available. No contract changes."
   *   sunset_scheduled  "Spring Travel Rewards — Terms v2 stops rendering on March 1, 2027. Move to v3."
   *   revoked           "Balance Transfer Intro — Terms v1 was revoked: Wrong intro APR in the legal notices."
   */
  message: string;
}

// ── POST /api/v1/templates/{id}/render (Phase 3; restated for consumers) ────────

/**
 * The body a consumer sends. `"draft"` and `preview` are CMS-only and not part of the consumer API.
 * At most 1,000,000 bytes (else 413 body_too_large); each value at most 1000 characters, counted in
 * Unicode code points (else 422 invalid_values, "first_name must be at most 1,000 characters."). A value
 * is never cut: it prints exactly as sent, or is refused.
 */
export interface ApiRenderRequest {
  version: number;
  channel: ApiChannel;
  values: Record<string, string | number>;
  encoding?: "base64";
}

/** 200, channel email (and any channel with encoding base64 for email). */
export interface ApiEmailResponse {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** The Active version when the rendered one is Superseded; else null. */
  newerVersion: number | null;
  encoding?: "base64";
}

/** 200, pdf or web with encoding base64. */
export interface ApiBase64Response {
  channel: "pdf" | "web";
  contentType: "application/pdf" | "text/html; charset=utf-8";
  encoding: "base64";
  data: string;
  newerVersion: number | null;
}

/** Response headers a consumer reads on a 200. */
export const API_HEADERS = {
  consumer: "X-Consumer-Id",
  correlation: "X-Correlation-Id",
  templateId: "X-Stencil-Template-Id",
  version: "X-Stencil-Version",
  newerVersion: "X-Stencil-Newer-Version",
} as const;
