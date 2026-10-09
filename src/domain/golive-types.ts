// Phase 5 contract (going live), UCOMP side: the consumer API's server shapes, the Usage read models,
// the integration panel, and the signatures every slice codes against. Pure types (plus two small
// consts), written by the lead. Dates in read models are ISO strings (they cross into client components).
//
// Three files make up the Phase 5 contract, because the simulator may not import @/domain:
//   src/contracts/api-v1.ts   the /api/v1 wire shapes (both sides)          ← the consumer API
//   src/domain/golive-types.ts this file: UCOMP's read models and signatures
//   src/simulator/types.ts    the simulator's own read models and actions   ← Coral's side
// Who implements what is in docs/archive/phase-5-brief.md.

import type {
  ApiBase64Response,
  ApiContractChange,
  ApiEmailResponse,
  ApiErrorBody,
  ApiErrorCode,
  ApiJsonSchema,
  ApiNotice,
  ApiVariableType,
} from "@/contracts/api-v1";
import type { Base64ResponseBody, EmailResponseBody, RenderErrorBody, RenderErrorCode } from "./render/types";
import type { ConsumerNoticeKind } from "./review-types";
import type { Channel, ContractChange, Variable, VariableType, VersionState } from "./types";

export type * from "@/contracts/api-v1";

// ── Drift checks: the domain's render types must still fit the published wire shapes ──────────

type Assert<T extends true> = T;
type Fits<A, B> = [A] extends [B] ? true : false;
export type _DriftChecks = [
  Assert<Fits<RenderErrorCode, ApiErrorCode>>,
  Assert<Fits<RenderErrorBody, ApiErrorBody>>,
  Assert<Fits<EmailResponseBody, ApiEmailResponse>>,
  Assert<Fits<Base64ResponseBody, ApiBase64Response>>,
  Assert<Fits<VariableType, ApiVariableType>>,
  Assert<Fits<ApiVariableType, VariableType>>,
  Assert<Fits<ConsumerNoticeKind, ApiNotice["kind"]>>,
];

/** Status per error code, for every /api/v1 route. The render codes keep RENDER_ERROR_STATUS's. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
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
  consumer_not_found: 404,
  consumer_mismatch: 403,
};

/** Windows the Usage numbers use. Previews (is_preview, or no consumer) NEVER count anywhere. */
export const USAGE_WINDOW_DAYS = 30;
export const NEARING_SUNSET_DAYS = 30;
/** Heatmap columns (weeks, Sunday-first), ending with the demo clock's current week. */
export const HEATMAP_WEEKS = 18;
/** Added by S2: "Renders over time" / "Renders by version" columns (Sunday-first weeks, ending this week). */
export const TREND_WEEKS = 13;
/** Added by S2: the daily series (failure-rate line, the template's `daily`) cover this many UTC days, today last. */
export const HISTORY_DAYS = 90;

// ── Pure domain functions (slice D1, src/domain/golive/*.ts, each with a test) ───────────────────
//
// json-schema.ts
//   contractJsonSchema(input: { templateId: string; templateName: string; versionNumber: number;
//                               variables: readonly Variable[] }): ApiJsonSchema
//     Patterns must accept exactly the canonical forms validate.ts accepts (test: every seeded sample
//     validates against its schema; JUNK values don't). us_state → enum of the editor's US_STATES codes.
//   apiVariables(variables: readonly Variable[]): ApiVariable[]           // example = variable.sample
// contract-diff.ts
//   apiChanges(changes: readonly ContractChange[], versionNumber: number): ApiContractChange[]   // text via describeChange
//   contractDiff(from: { number: number; variables: readonly Variable[] },
//                to: { number: number; variables: readonly Variable[] }): ApiContractDiff         // via diffVariables
// notices.ts
//   noticeView(row: NoticeRow): ApiNotice        // normalizes BOTH payload shapes (see NoticeRow) and writes `message`
// samples.ts
//   integrationSamples(input: { origin: string; templateId: string; versionNumber: number; channel: Channel;
//                               variables: readonly Variable[]; consumerId: string }): { curl: string; fetch: string }
//     Values = each variable's sample. curl uses --data-raw with pretty JSON and `--output` for pdf.
//   RESPONSE_FORMATS: readonly ResponseFormat[]  // per channel + base64; copy lives here, not in the UI
// usage.ts
//   trendPct(current: number, previous: number): number | null          // null when previous is 0; rounded to 1 decimal
//   heatmap(counts: ReadonlyMap<string /*YYYY-MM-DD*/, number>, today: string, weeks?: number): UsageHeatmap
//     Levels: 0 = no renders (taupe); 1–4 by quartiles of the non-zero days in range.
//   usageTags(row: { versionNumber: number; state: VersionState; sunsetAt: Date | null; revokedAt: Date | null;
//                    errors30d: number }, now: Date): UsageTag[]
//     "On superseded v1 · sunset in 6 days" (warning) · "… sunset tomorrow" / "… sunset today" ·
//     "On superseded v1" (neutral, no sunset set) · "v1 sunset Mar 1 · renders fail" (danger, passed) ·
//     "v1 revoked · renders fail" (danger) · "3 failed renders" (danger, errors30d > 0). Active rows get none.
//   errorText(code: RenderErrorCode): string    // render_log keeps codes only: "Missing required variables." etc.

/**
 * A consumer_notices row as stored. Seeded rows and runtime rows (server/effects.ts) carry slightly
 * different payloads; `noticeView` reads either:
 *   new_version       seed { templateName, versionNumber, previousVersionNumber, contractChanges }
 *                     live { templateName, versionNumber, activeVersion, contractChanges, contractLines }
 *   sunset_scheduled  seed { templateName, versionNumber, sunsetAt, replacedByVersionNumber, contractChanges }
 *                     live { templateName, versionNumber, activeVersion, sunsetAt, contractChanges?, contractLines? }
 *   revoked           both { templateName, versionNumber, reason, activeVersion? }
 */
export interface NoticeRow {
  id: string;
  consumerId: string;
  templateId: string;
  versionId: string;
  kind: ConsumerNoticeKind;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ResponseFormat {
  channel: Channel | "base64";
  contentType: string; // "application/pdf"
  /** One plain sentence: "The PDF file itself." / "JSON with subject, preheader, html and text." */
  body: string;
  /** A short example (JSON for email and base64; null for binary/html). */
  example: string | null;
}

// ── Consumer API queries (slice S1, src/server/queries/consumer-api.ts; no viewer, consumer-scoped) ──
//
//   requireConsumer(header: string | null): Promise<{ ok: true; consumer: { id: string; name: string } } | { ok: false; error: ApiError }>
//   searchActiveTemplates(q: string, limit: number, after: SearchKey | null): Promise<SearchPage>
//   getTemplateDetail(templateId: string, opts: { version?: number; since?: number }, now: Date):
//     Promise<{ ok: true; detail: ApiTemplateDetail } | { ok: false; error: ApiError }>
//   listNotices(consumerId: string, opts: { after?: number; templateId?: string; limit: number }): Promise<NoticePage>
//     Both lists page with the opaque cursors in golive/cursor.ts (ApiPage in the contract).
//
// Routes (slice S1), GET handlers. Read `request.headers` FIRST (it makes the handler dynamic under
// Cache Components; a DB read before it would try to prerender). Same header helpers as the render route
// (correlation id, no-store, nosniff) — move them to src/server/api/http.ts and import from both.
//   src/app/api/v1/templates/route.ts
//   src/app/api/v1/templates/[templateId]/route.ts
//   src/app/api/v1/consumers/[consumerId]/notices/route.ts

// ── Usage read models (slice S2, src/server/queries/usage.ts) ──────────────────────────────────

export type UsageTone = "neutral" | "warning" | "danger" | "positive";

export interface UsageTag {
  tone: UsageTone;
  text: string;
}

export interface HeatCell {
  date: string; // YYYY-MM-DD (UTC day, demo clock)
  count: number; // non-preview renders that day (succeeded + failed)
  level: 0 | 1 | 2 | 3 | 4;
  /** False for days after today in the current week (draw nothing there). */
  inRange: boolean;
}

export interface UsageHeatmap {
  /** Columns of 7 cells (Sunday → Saturday), oldest week first. */
  weeks: HeatCell[][];
  /** A label above the first week that starts in each month: { label: "Feb", week: 3 }. */
  months: { label: string; week: number }[];
  /** Upper bound per level (level 1 ≤ thresholds[0] …), for the legend's tooltips. */
  thresholds: [number, number, number, number];
  total: number;
  /** Added by S2: the in-range day with the most renders ("Busiest day | 1,234"); null when there were none. */
  busiest: { date: string; count: number } | null;
}

export interface UsageStatCard {
  value: number;
  /** "27.4k", "12", "1". */
  display: string;
}

/** One consumer on one template version (the consumers table; the per-template tab). */
export interface UsageRow {
  consumer: { id: string; name: string };
  template: { id: string; name: string; teamSlug: string };
  versionNumber: number;
  versionState: VersionState;
  renders30d: number; // every attempt (succeeded + failed); errors30d is the failed subset
  errors30d: number;
  lastRenderAt: string; // any outcome
  tags: UsageTag[];
  /** Added by S2: the version's sunset (ISO) for `<StatusBadge sunsetAt>`; null when none is set. */
  sunsetAt: string | null;
  /** Added by S2: successful renders per UTC day for the sparkline, USAGE_WINDOW_DAYS values, oldest first, today last. */
  spark: number[];
}

/** /[team]/usage. Team space = that team's templates; "all" = every team the viewer can see. */
export interface UsageDashboard {
  space: { slug: string; name: string; isAll: boolean };
  today: string; // YYYY-MM-DD, demo clock
  stats: {
    /** Renders (succeeded + failed) in the last 30 days vs the 30 before. Label: "Renders · 30 days". */
    renders: UsageStatCard & { previous: number; trendPct: number | null };
    activeTemplates: UsageStatCard;
    /** Distinct consumers with a render in the last 30 days. */
    consumers: UsageStatCard;
    /** Superseded versions whose sunset is within NEARING_SUNSET_DAYS (not passed). */
    nearingSunset: UsageStatCard & { soonest: { templateName: string; versionNumber: number; sunsetAt: string } | null };
  };
  /** ok / (ok + error), last 30 days; for a gauge if the composition has one. */
  success: { ok: number; errors: number; pct: number | null };
  heatmap: UsageHeatmap;
  /** Horizontal bars, last 30 days, most first. `share` is 0–1 of the space's renders. */
  byConsumer: { consumer: { id: string; name: string }; renders: number; share: number }[];
  /** Consumer × template × version with any non-preview render in the last 30 days. Sorted: tagged
   * rows first (danger, warning), then renders desc. */
  rows: UsageRow[];

  // Added by S2 for the picked composition (variant A):
  /** Successful renders by channel, last 30 days (the first stat card's channel mix). */
  byChannel: Record<Channel, number>;
  /** The gauge: of the last 30 days' successful renders, how many were on a version that is Active now. */
  onActive: {
    active: number;
    /** Renders on versions that are no longer Active (superseded, mostly). */
    other: number;
    pct: number | null; // 0–100, 1 decimal; null with no renders
    /** Which versions `other` is made of, most first: "On v1" when there is one. */
    otherVersions: { template: { id: string; name: string }; versionNumber: number; renders: number }[];
  };
  /** "Top templates": successful renders per template, last 30 days, most first (templates with none left out). */
  byTemplate: { template: { id: string; name: string; teamSlug: string }; renders: number; share: number }[];
  /** "Renders over time": TREND_WEEKS Sunday-first weeks, oldest first, the last one is this (partial) week. */
  weekly: { weekStart: string; count: number; errors: number; channels: Record<Channel, number> }[];
  /** The failure-rate line: HISTORY_DAYS UTC days, oldest first, today last (zeros included). */
  daily: { date: string; count: number; errors: number }[];
}

/** The per-template Usage tab (…/templates/[templateId]/usage). Same sources, one template. */
export interface TemplateUsageData {
  template: { id: string; name: string; teamSlug: string };
  today: string;
  stats: {
    renders: UsageStatCard & { previous: number; trendPct: number | null };
    consumers: UsageStatCard;
    errors: UsageStatCard;
  };
  /** Successful renders per UTC day, last 90 days, oldest first (zeros included). `errors` added by S2. */
  daily: { date: string; count: number; errors: number }[];
  /** Released versions, newest first, each with who renders it. The same data feeds the consequence text. */
  versions: TemplateUsageVersion[];
  /** The last 10 failed non-preview renders. */
  recentErrors: { at: string; consumer: { id: string; name: string }; versionNumber: number | null; channel: Channel; code: RenderErrorCode; text: string }[];

  // Added by S2 for the picked composition:
  /** ok / (ok + error), last 30 days ("Succeeded"). */
  success: { ok: number; errors: number; pct: number | null };
  /** "N% still on vX": last 30 days' successful renders on each version that is no longer Active, most first. pct 0–100 (whole). */
  stillOn: { versionNumber: number; state: VersionState; renders: number; pct: number }[];
  /** "Renders by version": the series, ascending (every version with a successful render in the TREND_WEEKS window). */
  weeklyVersions: number[];
  /** TREND_WEEKS Sunday-first weeks, oldest first; `byVersion[n]` = successful renders on vn that week (0 when none). */
  weekly: { weekStart: string; count: number; byVersion: Record<number, number> }[];
  /** "Who renders it": the dashboard's consumer rows for this template (same shape, same sort). */
  rows: UsageRow[];
}

export interface TemplateUsageVersion {
  number: number;
  state: VersionState;
  activatedAt: string | null;
  sunsetAt: string | null;
  sunsetPassed: boolean;
  revokedAt: string | null;
  consumers: { id: string; name: string; renders30d: number; errors30d: number; lastRenderAt: string }[];
  tags: UsageTag[];
}

// Signatures (slice S2):
//   getUsageDashboard(spaceSlug: string): Promise<UsageDashboard>                       // cache(); viewer-scoped (template.view)
//   getTemplateUsage(spaceSlug: string, templateId: string): Promise<TemplateUsageData> // requireTemplate()
// Aggregate in SQL (render_log is ~27k rows): group by day/consumer/version with `is_preview = 0 AND
// consumer_id IS NOT NULL`. Days are UTC days of the demo clock (`now()` from server/clock).

// ── Integration panel (slice S1 query + U3 UI) ────────────────────────────────────────────────

export interface ContractRow {
  key: string;
  label: string;
  type: VariableType;
  typeLabel: string; // "Currency" (domain/contract.ts typeLabel)
  required: boolean;
  example: string;
}

export interface IntegrationPanelData {
  template: { id: string; name: string; teamSlug: string; teamName: string };
  active: { number: number; activatedAt: string; channels: Channel[] };
  contract: ContractRow[];
  jsonSchema: ApiJsonSchema;
  /** `JSON.stringify(jsonSchema, null, 2)`: what the copy button copies. */
  jsonSchemaText: string;
  endpoint: { method: "POST"; path: string; url: string }; // url = origin + path
  /** One per enabled channel, PDF first when enabled. Values = each variable's sample. */
  samples: { channel: Channel; curl: string; fetch: string }[];
  responses: ResponseFormat[];
  /** The errors a consumer should handle, for a short table: 410 sunset/revoked, 422 values, 404. */
  errors: { status: number; code: ApiErrorCode; when: string }[];
  /**
   * "What changed since vN": one entry per OLDER released version (Superseded or Revoked), newest
   * first; the picker defaults to the first. Empty for a v1.
   */
  since: { number: number; state: VersionState; sunsetAt: string | null; diff: { breaking: boolean; items: ApiContractChange[] } }[];
}

// Signatures:
//   getIntegrationPanel(templateId: string, origin: string): Promise<IntegrationPanelData | null>  // src/server/queries/integration.ts (S1)
//   loadIntegrationPanel(viewer, { templateId }): Promise<ReadResult<{ panel: IntegrationPanelData }>>   // src/server/queries/integration.ts
//     can("integration.view") on the template's team; origin from headers() (x-forwarded-proto + host).
//     Served by GET /api/templates/[templateId]/integration. WorkspaceShare keeps its props (templateId,
//     templateName, activeVersion) and fetches it on open (and on ring hover/focus as a prefetch), so
//     workspace-header.tsx and review-header.tsx don't change.

// Re-exports the slices use, so they import one module (the Api* types come through `export type *` above).
export type { Channel, ContractChange, Variable };
