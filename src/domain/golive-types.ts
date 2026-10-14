// The going-live contract, Stencil's side: the consumer API's server shapes, the Usage read models and the
// integration panel's data. Pure types (plus a few small consts). Dates in read models are ISO strings (they cross
// into client components).
//
// The wire shapes themselves are src/contracts/api-v1.ts, shared with the simulator, which may not import
// @/domain; this file re-exports them and checks the domain's render types against them (_DriftChecks). The
// simulator's own read models are src/simulator/types.ts. The functions over these shapes are in domain/golive/,
// the consumer API's queries in src/server/services/local/consumer-api.ts, and the Usage queries in
// src/server/services/local/usage.ts.

import type {
  ApiBase64Response,
  ApiChannel,
  ApiContractChange,
  ApiEmailResponse,
  ApiErrorBody,
  ApiErrorCode,
  ApiJsonSchema,
  ApiNotice,
  ApiPushPlatform,
  ApiPushResponse,
  ApiPushTooLargeDetails,
  ApiSmsEncoding,
  ApiSmsResponse,
  ApiSmsTooLongDetails,
  ApiVariableType,
} from "@/contracts/api-v1";
import type { SmsEncoding } from "./messages/gsm7";
import type { PushPlatform } from "./messages/push";
import type {
  Base64ResponseBody,
  EmailResponseBody,
  PushResponseBody,
  PushTooLargeDetails,
  RenderErrorBody,
  RenderErrorCode,
  SmsResponseBody,
  SmsTooLongDetails,
} from "./render/types";
import type { ConsumerNoticeKind } from "./review-types";
import type {
  Channel,
  ContractChange,
  Variable,
  VariableType,
  VersionState,
} from "./types";

export type * from "@/contracts/api-v1";

// ── Drift checks: the domain's render types must still fit the published wire shapes ──────────

type Assert<T extends true> = T;
type Fits<A, B> = [A] extends [B] ? true : false;
export type _DriftChecks = [
  // A channel the domain renders is one the API names, and the other way round.
  Assert<Fits<Channel, ApiChannel>>,
  Assert<Fits<ApiChannel, Channel>>,
  Assert<Fits<RenderErrorCode, ApiErrorCode>>,
  Assert<Fits<RenderErrorBody, ApiErrorBody>>,
  Assert<Fits<EmailResponseBody, ApiEmailResponse>>,
  Assert<Fits<Base64ResponseBody, ApiBase64Response>>,
  // The push platforms and SMS encodings are the same on both sides, and so are the message bodies.
  Assert<Fits<PushPlatform, ApiPushPlatform>>,
  Assert<Fits<ApiPushPlatform, PushPlatform>>,
  Assert<Fits<SmsEncoding, ApiSmsEncoding>>,
  Assert<Fits<ApiSmsEncoding, SmsEncoding>>,
  Assert<Fits<PushResponseBody, ApiPushResponse>>,
  Assert<Fits<SmsResponseBody, ApiSmsResponse>>,
  Assert<Fits<PushTooLargeDetails, ApiPushTooLargeDetails>>,
  Assert<Fits<SmsTooLongDetails, ApiSmsTooLongDetails>>,
  Assert<Fits<VariableType, ApiVariableType>>,
  Assert<Fits<ApiVariableType, VariableType>>,
  Assert<Fits<ConsumerNoticeKind, ApiNotice["kind"]>>,
  Assert<Fits<ContractChange["kind"], ApiContractChange["kind"]>>,
  Assert<Fits<ApiContractChange["kind"], ContractChange["kind"]>>,
];

/** Status per error code, for every /api/v1 route. The render codes keep RENDER_ERROR_STATUS's. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  consumer_required: 400,
  body_too_large: 413,
  unknown_consumer: 403,
  preview_forbidden: 403,
  signed_out: 401,
  template_not_found: 404,
  version_not_found: 404,
  version_not_released: 409,
  version_sunset: 410,
  version_revoked: 410,
  channel_not_allowed: 422,
  channel_not_enabled: 422,
  missing_variables: 422,
  invalid_values: 422,
  push_payload_too_large: 422,
  sms_too_long: 422,
  render_failed: 500,
  consumer_mismatch: 403,
};

/** Windows the Usage numbers use. Previews (is_preview, or no consumer) NEVER count anywhere. */
export const USAGE_WINDOW_DAYS = 30;
export const NEARING_SUNSET_DAYS = 30;
/** Heatmap columns (weeks, Sunday-first), ending with the demo clock's current week. */
export const HEATMAP_WEEKS = 18;
/** "Renders over time" / "Renders by version" columns (Sunday-first weeks, ending this week). */
export const TREND_WEEKS = 13;
/** The daily series (failure-rate line, the template's `daily`) cover this many UTC days, today last. */
export const HISTORY_DAYS = 90;

// ── Notices ────────────────────────────────────────────────────────────────

/**
 * A consumer_notices row as stored. The rows services/local/effects.ts writes and the seed's carry the same
 * payloads, one shape per kind (decision 0064):
 *   new_version       { templateName, versionNumber, activeVersion, contractChanges, contractLines }
 *   sunset_scheduled  { templateName, versionNumber, activeVersion, sunsetAt, sunsetDay, zone, contractChanges?, contractLines? }
 *   sunset_passed     { templateName, versionNumber, activeVersion, sunsetAt, sunsetDay, zone } (the sunset sweep)
 *   revoked           { templateName, versionNumber, activeVersion, reason }
 * (`contractLines` is written by the transitions, not the seed, and read by nothing.)
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

// ── Usage read models (src/server/services/local/usage.ts counts them; domain/golive/usage.ts lays them out) ──

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
  /** the in-range day with the most renders ("Busiest day | 1,234"); null when there were none. */
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
  /** The version's sunset day (YYYY-MM-DD, business time zone) for `<StatusBadge sunsetDay>`; null when none is set. */
  sunsetDay: string | null;
  /** The sunset has passed (`sunsetPassed`), for `<StatusBadge sunsetPassed>`. False when none is set. */
  sunsetPassed: boolean;
  /** successful renders per UTC day for the sparkline, USAGE_WINDOW_DAYS values, oldest first, today last. */
  spark: number[];
}

/** /[team]/usage. Team space = that team's templates; "all" = every team the viewer can see. */
export interface UsageDashboard {
  space: { slug: string; name: string; isAll: boolean };
  /** ISO: the backend's instant the counts were made at; a row's "last render" counts from it. */
  asOf: string;
  today: string; // YYYY-MM-DD, UTC day of `asOf`
  stats: {
    /** Renders (succeeded + failed) in the last 30 days vs the 30 before. Label: "Renders · 30 days". */
    renders: UsageStatCard & { previous: number; trendPct: number | null };
    activeTemplates: UsageStatCard;
    /** Distinct consumers with a render in the last 30 days. */
    consumers: UsageStatCard;
    /** Superseded versions whose sunset is within NEARING_SUNSET_DAYS (not passed). */
    nearingSunset: UsageStatCard & {
      /** `daysAway`: whole days from today to the sunset's day, in the business time zone (1 = tomorrow). */
      soonest: {
        templateName: string;
        versionNumber: number;
        daysAway: number;
      } | null;
    };
  };
  /** ok / (ok + error), last 30 days; for a gauge if the composition has one. */
  success: { ok: number; errors: number; pct: number | null };
  heatmap: UsageHeatmap;
  /** Horizontal bars, last 30 days, most first. `share` is 0–1 of the space's renders. */
  byConsumer: {
    consumer: { id: string; name: string };
    renders: number;
    share: number;
  }[];
  /** Consumer × template × version with any non-preview render in the last 30 days. Sorted: tagged
   * rows first (danger, warning), then renders desc. */
  rows: UsageRow[];

  // The first stat card and the channel mix:
  /** Successful renders by channel, last 30 days (the first stat card's channel mix). */
  byChannel: Record<Channel, number>;
  /** The gauge: of the last 30 days' successful renders, how many were on a version that is Active now. */
  onActive: {
    active: number;
    /** Renders on versions that are no longer Active (superseded, mostly). */
    other: number;
    pct: number | null; // 0–100, 1 decimal; null with no renders
    /** Which versions `other` is made of, most first: "On v1" when there is one. */
    otherVersions: {
      template: { id: string; name: string };
      versionNumber: number;
      renders: number;
    }[];
  };
  /** "Top templates": successful renders per template, last 30 days, most first (templates with none left out). */
  byTemplate: {
    template: { id: string; name: string; teamSlug: string };
    renders: number;
    share: number;
  }[];
  /** "Renders over time": TREND_WEEKS Sunday-first weeks, oldest first, the last one is this (partial) week. */
  weekly: {
    weekStart: string;
    count: number;
    errors: number;
    channels: Record<Channel, number>;
  }[];
  /** The failure-rate line: HISTORY_DAYS UTC days, oldest first, today last (zeros included). */
  daily: { date: string; count: number; errors: number }[];
}

/** The per-template Usage tab (…/templates/[templateId]/usage). Same sources, one template. */
export interface TemplateUsageData {
  template: { id: string; name: string; teamSlug: string };
  /** ISO: the backend's instant the counts were made at; a row's "last render" counts from it. */
  asOf: string;
  today: string;
  stats: {
    renders: UsageStatCard & { previous: number; trendPct: number | null };
    consumers: UsageStatCard;
    errors: UsageStatCard;
  };
  /** Successful renders per UTC day, last 90 days, oldest first (zeros included). */
  daily: { date: string; count: number; errors: number }[];
  /** Released versions, newest first, each with who renders it. The same data feeds the consequence text. */
  versions: TemplateUsageVersion[];
  /** The last 10 failed non-preview renders. `platform` is the phone of a failed push (null for every other channel, and for a push logged before it was kept). */
  recentErrors: {
    at: string;
    consumer: { id: string; name: string };
    versionNumber: number | null;
    channel: Channel;
    platform: PushPlatform | null;
    code: RenderErrorCode;
    text: string;
  }[];

  // Success and version spread:
  /** ok / (ok + error), last 30 days ("Succeeded"). */
  success: { ok: number; errors: number; pct: number | null };
  /** "N% still on vX": last 30 days' successful renders on each version that is no longer Active, most first. pct 0–100 (whole). */
  stillOn: {
    versionNumber: number;
    state: VersionState;
    renders: number;
    pct: number;
  }[];
  /** The channels the template's content type allows, in `CHANNELS` order: the ones "Renders by channel" lists. */
  channels: Channel[];
  /** Renders (succeeded or failed) by channel, last 30 days: the dashboard's `byChannel` for this template. 0 for a channel it doesn't render to. */
  byChannel: Record<Channel, number>;
  /** The pushes among `byChannel.push`, by the phone they were for. `unrecorded` is a push logged before the platform was kept; the three add up to `byChannel.push`. */
  pushByPlatform: Record<PushPlatform | "unrecorded", number>;
  /** "Renders by version": the series, ascending (every version with a successful render in the TREND_WEEKS window). */
  weeklyVersions: number[];
  /** TREND_WEEKS Sunday-first weeks, oldest first; `byVersion[n]` = successful renders on vn that week (0 when none). */
  weekly: {
    weekStart: string;
    count: number;
    byVersion: Record<number, number>;
  }[];
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
  consumers: {
    id: string;
    name: string;
    renders30d: number;
    errors30d: number;
    lastRenderAt: string;
  }[];
  tags: UsageTag[];
}

// The backend aggregates in SQL (services/local/usage.ts): group by day/consumer/version with `is_preview = 0 AND
// consumer_id IS NOT NULL`. Days are UTC days of the backend's clock (`asOf`); `usageDashboard` and `templateUsage`
// (domain/golive/usage.ts) lay the counts out.

// ── Integration panel ────────────────────────────────────────────────────────

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
  /**
   * The errors a consumer should handle, for a short table: 410 sunset/revoked, 422 values, 404, and the
   * message limits. `channel`: an error only that channel returns (shown when the version has it).
   */
  errors: {
    status: number;
    code: ApiErrorCode;
    when: string;
    channel?: Channel;
  }[];
  /**
   * "What changed since vN": one entry per OLDER released version (Superseded or Revoked), newest
   * first; the picker defaults to the first. Empty for a v1.
   */
  since: {
    number: number;
    state: VersionState;
    /** YYYY-MM-DD in the business time zone; null when no sunset is set. */
    sunsetDay: string | null;
    /** The sunset has passed (`sunsetPassed`). False when none is set. */
    sunsetPassed: boolean;
    diff: { breaking: boolean; items: ApiContractChange[] };
  }[];
}

// Signatures:
//   integrationPanel(facts: IntegrationFacts, origin: string): IntegrationPanelData   // src/server/queries/integration.ts
//   loadIntegrationPanel(ctx, { templateId }): Promise<ReadResult<{ panel: IntegrationPanelData }>>   // src/server/queries/integration.ts
//     can("integration.view") on the template's team; origin from headers() (x-forwarded-proto + host).
//     Served by GET /api/templates/[templateId]/integration. WorkspaceShare keeps its props (templateId,
//     templateName, activeVersion) and fetches it on open (and on ring hover/focus as a prefetch), so
//     workspace-header.tsx and review-header.tsx don't change.

// Re-exports the slices use, so they import one module (the Api* types come through `export type *` above).
export type { Channel, ContractChange, Variable };
