// Usage: the pure half of the Usage dashboard and the per-template Usage tab. The server query
// (src/server/queries/usage.ts) aggregates render_log in SQL with the windows defined here and hands
// the grouped counts to these functions. Everything is relative to `now` (the demo clock), in UTC days.
//
// What counts: a render is usage when it is NOT a preview and has a consumer (`countsAsUsage`).
// "Renders" are attempts, succeeded or failed (one denominator: succeeded = renders - failed); the failed
// ones are counted apart as errors.

import { daysUntilSunset } from "../business-zone";
import { DAY_MS, addDays, dayStartMs, utcDay } from "../dates";
import { sunsetPassed } from "../lifecycle";
import { plural } from "../plural";
import type { RenderErrorCode } from "../render/types";
import type { VersionState } from "../types";
import {
  HEATMAP_WEEKS,
  HISTORY_DAYS,
  NEARING_SUNSET_DAYS,
  TREND_WEEKS,
  USAGE_WINDOW_DAYS,
  type HeatCell,
  type UsageHeatmap,
  type UsageRow,
  type UsageTag,
  type UsageTone,
} from "../golive-types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// ── Weeks (UTC days, YYYY-MM-DD; the day arithmetic is ../dates.ts) ──────────

/** The Sunday that starts the day's week. */
export function weekStartOf(day: string): string {
  return addDays(day, -new Date(dayStartMs(day)).getUTCDay());
}

/** Every day from `from` to `to`, both included. */
export function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = dayStartMs(from), end = dayStartMs(to); ms <= end; ms += DAY_MS) days.push(utcDay(ms));
  return days;
}

// ── Windows ──────────────────────────────────────────────────────────────────

export interface UsageWindows {
  /** The demo clock, ms. Nothing after it counts (a render can't be in the future). */
  until: number;
  /** Start of the rolling 30 days, ms (included): the current window is [since, until]. */
  since: number;
  /** Start of the 30 days before, ms (included): the previous window is [previousSince, since). */
  previousSince: number;
  today: string;
  /** First day of the sparklines (USAGE_WINDOW_DAYS days, today last). */
  sparkFrom: string;
  /** First day of the daily series (HISTORY_DAYS days, today last). */
  historyFrom: string;
  /** First Sunday of the TREND_WEEKS weekly columns. */
  trendFrom: string;
  /** First Sunday of the HEATMAP_WEEKS heatmap columns. */
  heatFrom: string;
  /** The earliest of the day-based ranges, as ms: the lower bound for the per-day queries. */
  seriesFromMs: number;
}

export function usageWindows(now: Date): UsageWindows {
  const until = now.getTime();
  const today = utcDay(now);
  const thisWeek = weekStartOf(today);
  const sparkFrom = addDays(today, -(USAGE_WINDOW_DAYS - 1));
  const historyFrom = addDays(today, -(HISTORY_DAYS - 1));
  const trendFrom = addDays(thisWeek, -7 * (TREND_WEEKS - 1));
  const heatFrom = addDays(thisWeek, -7 * (HEATMAP_WEEKS - 1));
  return {
    until,
    since: until - USAGE_WINDOW_DAYS * DAY_MS,
    previousSince: until - 2 * USAGE_WINDOW_DAYS * DAY_MS,
    today,
    sparkFrom,
    historyFrom,
    trendFrom,
    heatFrom,
    seriesFromMs: Math.min(...[sparkFrom, historyFrom, trendFrom, heatFrom].map(dayStartMs)),
  };
}

/** Is this render_log row usage at all? Previews and consumer-less rows never count. */
export function countsAsUsage(row: { isPreview: boolean; consumerId: string | null }): boolean {
  return !row.isPreview && row.consumerId !== null;
}

/** Which rolling window an instant falls in. */
export function windowOf(at: Date | number, w: UsageWindows): "current" | "previous" | null {
  const ms = typeof at === "number" ? at : at.getTime();
  if (ms > w.until) return null;
  if (ms >= w.since) return "current";
  if (ms >= w.previousSince) return "previous";
  return null;
}

// ── Names ────────────────────────────────────────────────────────────────────

/** A consumer that has since left the registry still shows as a name: "acme" → "Acme", "deposits-online" → "Deposits Online". */
export function consumerLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/** Change in percent, rounded to 1 decimal; null when there is nothing to compare with. */
export function trendPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** part / whole as a percentage rounded to `decimals`; null when whole is 0. */
export function percent(part: number, whole: number, decimals = 1): number | null {
  if (whole === 0) return null;
  const f = 10 ** decimals;
  return Math.round((part / whole) * 100 * f) / f;
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

/**
 * `weeks` Sunday-first columns ending with `today`'s week. Level 0 = no renders; 1–4 by quartiles
 * (nearest rank) of the non-zero days in range. Days after today are out of range (count 0).
 */
export function heatmap(counts: ReadonlyMap<string, number>, today: string, weeks: number = HEATMAP_WEEKS): UsageHeatmap {
  const start = addDays(weekStartOf(today), -7 * (weeks - 1));
  const todayMs = dayStartMs(today);

  const columns: { date: string; count: number; inRange: boolean }[][] = [];
  const nonZero: number[] = [];
  let total = 0;
  let busiest: { date: string; count: number } | null = null;
  for (let w = 0; w < weeks; w++) {
    const column: { date: string; count: number; inRange: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const inRange = dayStartMs(date) <= todayMs;
      const count = inRange ? Math.max(0, counts.get(date) ?? 0) : 0;
      if (count > 0) nonZero.push(count);
      total += count;
      if (count > 0 && (!busiest || count > busiest.count)) busiest = { date, count };
      column.push({ date, count, inRange });
    }
    columns.push(column);
  }

  nonZero.sort((a, b) => a - b);
  const rank = (p: number) => nonZero[Math.max(0, Math.ceil(p * nonZero.length) - 1)] ?? 0;
  const thresholds: [number, number, number, number] = [rank(0.25), rank(0.5), rank(0.75), rank(1)];
  const level = (count: number): HeatCell["level"] => {
    if (count <= 0) return 0;
    if (count <= thresholds[0]) return 1;
    if (count <= thresholds[1]) return 2;
    if (count <= thresholds[2]) return 3;
    return 4;
  };

  const months: { label: string; week: number }[] = [];
  columns.forEach((column, week) => {
    const sunday = new Date(dayStartMs(column[0]!.date));
    if (sunday.getUTCDate() <= 7) months.push({ label: MONTHS[sunday.getUTCMonth()]!, week });
  });

  return {
    weeks: columns.map((column) => column.map((cell) => ({ ...cell, level: level(cell.count) }))),
    months,
    thresholds,
    total,
    busiest,
  };
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export interface UsageTagInput {
  versionNumber: number;
  state: VersionState;
  sunsetAt: Date | null;
  revokedAt: Date | null;
  errors30d: number;
}

/**
 * The notes on a consumer's row. The Version badge already says "Superseded" or "Revoked" (and the sunset
 * date), so a note adds only the extra fact, in a few words:
 *   superseded, sunset ahead  "sunset in 6 days"       warning within NEARING_SUNSET_DAYS, else neutral
 *                             ("sunset tomorrow", "sunset today")
 *   superseded, sunset passed "renders fail"            danger
 *   revoked                   "renders fail"            danger
 *   superseded, no sunset     none
 * then "3 failed renders" (danger) when errors30d > 0 and the version still renders (a failing
 * lifecycle note already says so). Active rows get no lifecycle note. The days to a sunset are counted
 * in the business time zone (`zone`), where its day is ("sunset tomorrow": renders stop at midnight).
 */
export function usageTags(row: UsageTagInput, now: Date, zone: string): UsageTag[] {
  const tags: UsageTag[] = [];
  let failing = false;

  if (row.state === "revoked") {
    tags.push({ tone: "danger", text: "renders fail" });
    failing = true;
  } else if (row.state === "superseded" && row.sunsetAt) {
    if (sunsetPassed(row, now)) {
      tags.push({ tone: "danger", text: "renders fail" });
      failing = true;
    } else {
      const days = daysUntilSunset(row.sunsetAt, now, zone);
      const when = days <= 0 ? "sunset today" : days === 1 ? "sunset tomorrow" : `sunset in ${days} days`;
      tags.push({ tone: days <= NEARING_SUNSET_DAYS ? "warning" : "neutral", text: when });
    }
  }

  if (row.errors30d > 0 && !failing) {
    tags.push({ tone: "danger", text: plural(row.errors30d, "failed render") });
  }
  return tags;
}

const TONE_RANK: Record<UsageTone, number> = { danger: 0, warning: 1, neutral: 2, positive: 3 };

function tagRank(tags: readonly UsageTag[]): number {
  return tags.length === 0 ? 4 : Math.min(...tags.map((t) => TONE_RANK[t.tone]));
}

/** The consumers table's order: danger rows, then warning, then other tags, then the rest; renders desc within. */
export function compareUsageRows(a: UsageRow, b: UsageRow): number {
  return (
    tagRank(a.tags) - tagRank(b.tags) ||
    b.renders30d - a.renders30d ||
    b.errors30d - a.errors30d ||
    a.consumer.name.localeCompare(b.consumer.name) ||
    a.template.name.localeCompare(b.template.name) ||
    b.versionNumber - a.versionNumber
  );
}

// ── Error codes ──────────────────────────────────────────────────────────────

const ERROR_TEXT: Record<RenderErrorCode, string> = {
  bad_request: "The request wasn't valid.",
  consumer_required: "No consumer ID was sent.",
  body_too_large: "The request body was too large.",
  unknown_consumer: "The consumer isn't registered.",
  preview_forbidden: "Previews can't be requested by consumers.",
  template_not_found: "The template wasn't found.",
  version_not_found: "The version wasn't found.",
  version_not_released: "The version isn't released yet.",
  version_sunset: "The version was sunset.",
  version_revoked: "The version was revoked.",
  channel_not_allowed: "The channel isn't allowed for this content type.",
  channel_not_enabled: "The channel isn't enabled on this version.",
  missing_variables: "Missing required variables.",
  invalid_values: "A value had the wrong format.",
  push_payload_too_large: "The push was over 4,096 bytes.",
  sms_too_long: "The SMS was over 10 parts.",
  render_failed: "The render itself failed.",
};

/** render_log keeps the code only; this is how a failure reads in the Usage UI. */
export function errorText(code: RenderErrorCode): string {
  return ERROR_TEXT[code] ?? "The render failed.";
}
