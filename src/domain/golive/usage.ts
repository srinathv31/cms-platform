// Usage: the pure half of the Usage dashboard and the per-template Usage tab.
//
// The backend (the usage service, src/server/services/usage.ts) counts the render log with the windows
// defined here and answers the counts as facts (`DashboardUsageFacts`, `TemplateUsageFacts`): per template,
// consumer, version and channel, per day, and each version's sunset decided in the business time zone. The
// BFF turns the facts into the screens' read models with `usageDashboard` and `templateUsage`, which only add
// up, order, lay out and word: nothing here reads a clock or a database, so they are tested on facts built by
// hand. Everything is relative to `asOf` (the backend's instant), in UTC days (decision 0028).
//
// What counts: a render is usage when it is NOT a preview, has a consumer and wasn't refused as an
// unregistered caller (`countsAsUsage`). "Renders" are attempts, succeeded or failed (one denominator:
// succeeded = renders - failed); the failed ones are counted apart as errors.

import { daysUntilSunset, sunsetDay } from "../business-zone";
import { DAY_MS, addDays, dayStartMs, utcDay } from "../dates";
import { sunsetPassed } from "../lifecycle/sunset";
import type { PushPlatform } from "../messages/push";
import { compactCount } from "../numbers";
import { plural } from "../plural";
import type { RenderErrorCode } from "../render/types";
import { isReleased } from "../rounds";
import { CHANNELS, type Channel, type VersionState } from "../types";
import {
  HEATMAP_WEEKS,
  HISTORY_DAYS,
  NEARING_SUNSET_DAYS,
  TREND_WEEKS,
  USAGE_WINDOW_DAYS,
  type HeatCell,
  type TemplateUsageData,
  type TemplateUsageVersion,
  type UsageDashboard,
  type UsageHeatmap,
  type UsageRow,
  type UsageTag,
  type UsageTone,
} from "../golive-types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ── Weeks (UTC days, YYYY-MM-DD; the day arithmetic is ../dates.ts) ──────────

/** The Sunday that starts the day's week. */
export function weekStartOf(day: string): string {
  return addDays(day, -new Date(dayStartMs(day)).getUTCDay());
}

/** Every day from `from` to `to`, both included. */
export function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = dayStartMs(from), end = dayStartMs(to); ms <= end; ms += DAY_MS)
    days.push(utcDay(ms));
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
    seriesFromMs: Math.min(
      ...[sparkFrom, historyFrom, trendFrom, heatFrom].map(dayStartMs),
    ),
  };
}

/**
 * Is this render_log row usage at all? Previews and consumer-less rows never count, nor does a caller refused
 * as an unregistered consumer: the render pipeline writes no such row, and the count keeps out any an older
 * database still holds. A consumer later removed from the registry still counts: its rows were accepted
 * renders when they happened.
 */
export function countsAsUsage(row: {
  isPreview: boolean;
  consumerId: string | null;
  errorCode?: string | null;
}): boolean {
  return (
    !row.isPreview &&
    row.consumerId !== null &&
    row.errorCode !== "unknown_consumer"
  );
}

/** Which rolling window an instant falls in. */
export function windowOf(
  at: Date | number,
  w: UsageWindows,
): "current" | "previous" | null {
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
export function percent(
  part: number,
  whole: number,
  decimals = 1,
): number | null {
  if (whole === 0) return null;
  const f = 10 ** decimals;
  return Math.round((part / whole) * 100 * f) / f;
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

/**
 * `weeks` Sunday-first columns ending with `today`'s week. Level 0 = no renders; 1–4 by quartiles
 * (nearest rank) of the non-zero days in range. Days after today are out of range (count 0).
 */
export function heatmap(
  counts: ReadonlyMap<string, number>,
  today: string,
  weeks: number = HEATMAP_WEEKS,
): UsageHeatmap {
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
      if (count > 0 && (!busiest || count > busiest.count))
        busiest = { date, count };
      column.push({ date, count, inRange });
    }
    columns.push(column);
  }

  nonZero.sort((a, b) => a - b);
  const rank = (p: number) =>
    nonZero[Math.max(0, Math.ceil(p * nonZero.length) - 1)] ?? 0;
  const thresholds: [number, number, number, number] = [
    rank(0.25),
    rank(0.5),
    rank(0.75),
    rank(1),
  ];
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
    if (sunday.getUTCDate() <= 7)
      months.push({ label: MONTHS[sunday.getUTCMonth()]!, week });
  });

  return {
    weeks: columns.map((column) =>
      column.map((cell) => ({ ...cell, level: level(cell.count) })),
    ),
    months,
    thresholds,
    total,
    busiest,
  };
}

// ── Tags ─────────────────────────────────────────────────────────────────────

/** A version's sunset, decided at an instant in the business time zone (`usageSunset`). */
export interface UsageSunset {
  /** ISO: the instant renders stop, 00:00 on `day` in the business time zone. */
  at: string;
  /** YYYY-MM-DD: the sunset's day in the business time zone. */
  day: string;
  /** The sunset has come (`sunsetPassed`): renders of the version fail. */
  passed: boolean;
  /** Whole days from today to the sunset's day, both in the business time zone: 1 is tomorrow. */
  daysAway: number;
}

/** A version's sunset date as Usage reads it at `now`, or null while none is set. */
export function usageSunset(
  sunsetAt: Date | null,
  now: Date,
  zone: string,
): UsageSunset | null {
  if (!sunsetAt) return null;
  return {
    at: sunsetAt.toISOString(),
    day: sunsetDay(sunsetAt, zone),
    passed: sunsetPassed({ sunsetAt }, now),
    daysAway: daysUntilSunset(sunsetAt, now, zone),
  };
}

export interface UsageTagInput {
  state: VersionState;
  sunset: Pick<UsageSunset, "passed" | "daysAway"> | null;
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
 * lifecycle note already says so). Active rows get no lifecycle note. The days to a sunset are the
 * backend's (`usageSunset`), counted in the business time zone where its day is ("sunset tomorrow":
 * renders stop at midnight).
 */
export function usageTags(row: UsageTagInput): UsageTag[] {
  const tags: UsageTag[] = [];
  let failing = false;

  if (row.state === "revoked") {
    tags.push({ tone: "danger", text: "renders fail" });
    failing = true;
  } else if (row.state === "superseded" && row.sunset) {
    if (row.sunset.passed) {
      tags.push({ tone: "danger", text: "renders fail" });
      failing = true;
    } else {
      const days = row.sunset.daysAway;
      const when =
        days <= 0
          ? "sunset today"
          : days === 1
            ? "sunset tomorrow"
            : `sunset in ${days} days`;
      tags.push({
        tone: days <= NEARING_SUNSET_DAYS ? "warning" : "neutral",
        text: when,
      });
    }
  }

  if (row.errors30d > 0 && !failing) {
    tags.push({ tone: "danger", text: plural(row.errors30d, "failed render") });
  }
  return tags;
}

const TONE_RANK: Record<UsageTone, number> = {
  danger: 0,
  warning: 1,
  neutral: 2,
  positive: 3,
};

function tagRank(tags: readonly UsageTag[]): number {
  return tags.length === 0
    ? 4
    : Math.min(...tags.map((t) => TONE_RANK[t.tone]));
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

// ── The facts the backend answers ────────────────────────────────────────────
//
// Counts and decisions, no words: ids, ISO instants, YYYY-MM-DD days, codes. Every count already leaves out what
// isn't usage (`countsAsUsage`), is bounded by `asOf` (a render can't be in the future) and is bucketed by UTC
// day. The windows are `usageWindows(asOf)`.

/** A template Usage counts: its name is the CMS's (its open draft's, otherwise its newest version's). */
export interface UsageTemplateFacts {
  id: string;
  name: string;
  /** Compare teams by id (decision 0053); the slug is for links. */
  teamId: string;
  teamSlug: string;
}

/**
 * A numbered version of a template: the row a consumer's number means (`headOf`: the released row, else the
 * latest round), never the body.
 */
export interface UsageVersionFacts {
  templateId: string;
  number: number;
  state: VersionState;
  /** ISO. */
  activatedAt: string | null;
  sunset: UsageSunset | null;
  /** ISO: when a revoked version was revoked (confirmed, else started). */
  revokedAt: string | null;
}

/** A registered consumer. One that left the registry has no entry; its renders still count. */
export interface UsageConsumerFacts {
  id: string;
  name: string;
}

/**
 * The renders of one template, consumer, version and channel (and phone, for a push), counted as attempts in the
 * two rolling windows: the current one (`USAGE_WINDOW_DAYS` days up to `asOf`, the start included) and the one
 * before it.
 */
export interface UsageCell {
  templateId: string;
  consumerId: string;
  versionNumber: number;
  channel: Channel;
  /** A push's phone; null for every other channel, and for a push logged before the platform was kept. */
  platform: PushPlatform | null;
  /** Renders that succeeded in the current window. */
  ok30: number;
  /** Renders that failed in the current window. */
  err30: number;
  /** Attempts in the window before the current one. */
  prev: number;
  /** ISO: the latest render counted in this cell, either outcome. */
  lastAt: string;
}

/** Attempts of one template, consumer and version on one UTC day: a sparkline's point. */
export interface UsageSpark {
  templateId: string;
  consumerId: string;
  versionNumber: number;
  /** YYYY-MM-DD, UTC. */
  day: string;
  count: number;
}

/** Attempts on one UTC day by channel and outcome: the heatmap, the trend and the failure line. */
export interface UsageDayCount {
  day: string;
  channel: Channel;
  outcome: "ok" | "error";
  count: number;
}

/** Attempts of one template on one UTC day by version and outcome. */
export interface UsageVersionDayCount {
  day: string;
  versionNumber: number | null;
  outcome: "ok" | "error";
  count: number;
}

/** A failed render, for the template's recent failures. */
export interface UsageError {
  /** ISO. */
  at: string;
  consumerId: string;
  versionNumber: number | null;
  channel: Channel;
  platform: PushPlatform | null;
  code: RenderErrorCode;
}

/** The Usage dashboard of a space, as counts: `usageDashboard` lays it out. */
export interface DashboardUsageFacts {
  /** ISO: the instant the counts were made at. */
  asOf: string;
  /** The templates the viewer may see in the space. */
  templates: UsageTemplateFacts[];
  /** Their numbered versions. */
  versions: UsageVersionFacts[];
  /** The registry: names for the consumer ids the counts name. */
  consumers: UsageConsumerFacts[];
  /** Over the current window and the one before it. */
  cells: UsageCell[];
  /** Over the `USAGE_WINDOW_DAYS` days ending today. */
  sparks: UsageSpark[];
  /** Over the earliest of the screens' day ranges (`UsageWindows.seriesFromMs`) to `asOf`. */
  series: UsageDayCount[];
}

/** One template's Usage tab, as counts: `templateUsage` lays it out. */
export interface TemplateUsageFacts {
  asOf: string;
  template: UsageTemplateFacts;
  /** The channels its content type allows now. */
  allowedChannels: Channel[];
  versions: UsageVersionFacts[];
  consumers: UsageConsumerFacts[];
  /** All time, not only the two windows: a version's consumers include those that stopped rendering it. */
  cells: UsageCell[];
  sparks: UsageSpark[];
  series: UsageVersionDayCount[];
  /** The latest `RECENT_ERRORS` failures, newest first (equal instants: the later write first, decision 0063). */
  recentErrors: UsageError[];
}

/** How many failures the template's Usage tab lists. */
export const RECENT_ERRORS = 10;

// ── The screens, from the facts ──────────────────────────────────────────────

const versionKey = (templateId: string, number: number) =>
  `${templateId}#${number}`;
const rowKey = (
  templateId: string,
  consumerId: string,
  versionNumber: number,
) => `${templateId}#${consumerId}#${versionNumber}`;

const emptyChannels = (): Record<Channel, number> => ({
  pdf: 0,
  web: 0,
  email: 0,
  push: 0,
  sms: 0,
});

function trendWeeks(w: UsageWindows): string[] {
  return Array.from({ length: TREND_WEEKS }, (_, i) =>
    addDays(w.trendFrom, i * 7),
  );
}

/** The registry's names by id, and `consumerLabel` for an id that left it. */
function consumerNamer(
  consumers: readonly UsageConsumerFacts[],
): (id: string) => string {
  const names = new Map(consumers.map((c) => [c.id, c.name]));
  return (id) => names.get(id) ?? consumerLabel(id);
}

/** Sparkline points by template × consumer × version, then by day. */
function sparkIndex(
  sparks: readonly UsageSpark[],
): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const s of sparks) {
    const key = rowKey(s.templateId, s.consumerId, s.versionNumber);
    const byDay = index.get(key) ?? new Map<string, number>();
    byDay.set(s.day, s.count);
    index.set(key, byDay);
  }
  return index;
}

/** The consumers table: one row per consumer × template × version with any render in the current window. */
function usageRows(
  cells: readonly UsageCell[],
  src: {
    w: UsageWindows;
    templates: ReadonlyMap<string, UsageTemplateFacts>;
    versions: ReadonlyMap<string, UsageVersionFacts>;
    consumerName: (id: string) => string;
    sparks: ReadonlyMap<string, ReadonlyMap<string, number>>;
  },
): UsageRow[] {
  const grouped = new Map<
    string,
    {
      templateId: string;
      consumerId: string;
      versionNumber: number;
      ok: number;
      err: number;
      lastAt: number;
    }
  >();
  for (const c of cells) {
    const key = rowKey(c.templateId, c.consumerId, c.versionNumber);
    const g = grouped.get(key) ?? {
      templateId: c.templateId,
      consumerId: c.consumerId,
      versionNumber: c.versionNumber,
      ok: 0,
      err: 0,
      lastAt: 0,
    };
    g.ok += c.ok30;
    g.err += c.err30;
    g.lastAt = Math.max(g.lastAt, Date.parse(c.lastAt));
    grouped.set(key, g);
  }

  const sparkDays = dayList(src.w.sparkFrom, src.w.today);
  const rows: UsageRow[] = [];
  for (const [key, g] of grouped) {
    const attempts = g.ok + g.err;
    if (attempts === 0) continue;
    const template = src.templates.get(g.templateId);
    if (!template) continue;
    const version = src.versions.get(versionKey(g.templateId, g.versionNumber));
    const state = version?.state ?? "superseded";
    const sunset = version?.sunset ?? null;
    const spark = src.sparks.get(key);
    rows.push({
      consumer: { id: g.consumerId, name: src.consumerName(g.consumerId) },
      template: {
        id: template.id,
        name: template.name,
        teamSlug: template.teamSlug,
      },
      versionNumber: g.versionNumber,
      versionState: state,
      renders30d: attempts,
      errors30d: g.err,
      lastRenderAt: new Date(g.lastAt).toISOString(),
      tags: usageTags({ state, sunset, errors30d: g.err }),
      sunsetDay: sunset?.day ?? null,
      sunsetPassed: sunset?.passed ?? false,
      spark: sparkDays.map((d) => spark?.get(d) ?? 0),
    });
  }
  return rows.sort(compareUsageRows);
}

/** /[team]/usage: the dashboard of a space, from its counts. */
export function usageDashboard(
  facts: DashboardUsageFacts,
  space: { slug: string; name: string; isAll: boolean },
): UsageDashboard {
  const w = usageWindows(new Date(facts.asOf));
  const consumerName = consumerNamer(facts.consumers);
  const templateMap = new Map(facts.templates.map((t) => [t.id, t]));
  const versionMap = new Map(
    facts.versions.map((v) => [versionKey(v.templateId, v.number), v]),
  );
  const cells = facts.cells;

  const rows = usageRows(cells, {
    w,
    templates: templateMap,
    versions: versionMap,
    consumerName,
    sparks: sparkIndex(facts.sparks),
  });

  // Stats.
  let ok = 0;
  let errors = 0;
  let previous = 0;
  const byChannel = emptyChannels();
  for (const c of cells) {
    ok += c.ok30;
    errors += c.err30;
    previous += c.prev;
    byChannel[c.channel] += c.ok30 + c.err30;
  }
  const attempts = ok + errors;

  const activeTemplates = new Set(
    facts.versions.filter((v) => v.state === "active").map((v) => v.templateId),
  ).size;
  const nearing = facts.versions
    .filter(
      (v) =>
        v.state === "superseded" &&
        v.sunset !== null &&
        !v.sunset.passed &&
        v.sunset.daysAway <= NEARING_SUNSET_DAYS,
    )
    .sort((a, b) => Date.parse(a.sunset!.at) - Date.parse(b.sunset!.at));
  const soonest = nearing[0];

  // Consumers.
  const consumerTotals = new Map<string, number>();
  for (const r of rows)
    consumerTotals.set(
      r.consumer.id,
      (consumerTotals.get(r.consumer.id) ?? 0) + r.renders30d,
    );
  const byConsumer = [...consumerTotals]
    .map(([id, renders]) => ({
      consumer: { id, name: consumerName(id) },
      renders,
      share: attempts ? renders / attempts : 0,
    }))
    .sort(
      (a, b) =>
        b.renders - a.renders || a.consumer.name.localeCompare(b.consumer.name),
    );

  // Templates and versions.
  const templateTotals = new Map<string, number>();
  const otherVersions = new Map<
    string,
    {
      template: { id: string; name: string };
      versionNumber: number;
      renders: number;
    }
  >();
  let onActive = 0;
  for (const r of rows) {
    templateTotals.set(
      r.template.id,
      (templateTotals.get(r.template.id) ?? 0) + r.renders30d,
    );
    if (r.versionState === "active") {
      onActive += r.renders30d;
    } else if (r.renders30d > 0) {
      const key = versionKey(r.template.id, r.versionNumber);
      const o = otherVersions.get(key) ?? {
        template: { id: r.template.id, name: r.template.name },
        versionNumber: r.versionNumber,
        renders: 0,
      };
      o.renders += r.renders30d;
      otherVersions.set(key, o);
    }
  }
  const byTemplate = [...templateTotals]
    .filter(([, renders]) => renders > 0)
    .map(([id, renders]) => {
      const t = templateMap.get(id)!;
      return {
        template: { id: t.id, name: t.name, teamSlug: t.teamSlug },
        renders,
        share: attempts ? renders / attempts : 0,
      };
    })
    .sort(
      (a, b) =>
        b.renders - a.renders || a.template.name.localeCompare(b.template.name),
    );

  // Series.
  const rendersByDay = new Map<string, number>();
  const errByDay = new Map<string, number>();
  const weekly = new Map(
    trendWeeks(w).map((weekStart) => [
      weekStart,
      { weekStart, count: 0, errors: 0, channels: emptyChannels() },
    ]),
  );
  for (const s of facts.series) {
    rendersByDay.set(s.day, (rendersByDay.get(s.day) ?? 0) + s.count);
    if (s.outcome === "error")
      errByDay.set(s.day, (errByDay.get(s.day) ?? 0) + s.count);
    const week = weekly.get(weekStartOf(s.day));
    if (!week) continue;
    week.count += s.count;
    week.channels[s.channel] += s.count;
    if (s.outcome === "error") week.errors += s.count;
  }

  return {
    space,
    asOf: facts.asOf,
    today: w.today,
    stats: {
      renders: {
        value: attempts,
        display: compactCount(attempts),
        previous,
        trendPct: trendPct(attempts, previous),
      },
      activeTemplates: {
        value: activeTemplates,
        display: compactCount(activeTemplates),
      },
      consumers: {
        value: consumerTotals.size,
        display: compactCount(consumerTotals.size),
      },
      nearingSunset: {
        value: nearing.length,
        display: compactCount(nearing.length),
        soonest: soonest
          ? {
              templateName: templateMap.get(soonest.templateId)!.name,
              versionNumber: soonest.number,
              daysAway: soonest.sunset!.daysAway,
            }
          : null,
      },
    },
    success: { ok, errors, pct: percent(ok, attempts) },
    heatmap: heatmap(rendersByDay, w.today),
    byConsumer,
    rows,
    byChannel,
    onActive: {
      active: onActive,
      other: attempts - onActive,
      pct: percent(onActive, attempts),
      otherVersions: [...otherVersions.values()].sort(
        (a, b) => b.renders - a.renders,
      ),
    },
    byTemplate,
    weekly: [...weekly.values()],
    daily: dayList(w.historyFrom, w.today).map((date) => ({
      date,
      count: rendersByDay.get(date) ?? 0,
      errors: errByDay.get(date) ?? 0,
    })),
  };
}

/** The per-template Usage tab: the same counts, one template, every released version. */
export function templateUsage(facts: TemplateUsageFacts): TemplateUsageData {
  const w = usageWindows(new Date(facts.asOf));
  const consumerName = consumerNamer(facts.consumers);
  const template = facts.template;
  const info = {
    id: template.id,
    name: template.name,
    teamSlug: template.teamSlug,
  };
  const versionMap = new Map(
    facts.versions.map((v) => [versionKey(v.templateId, v.number), v]),
  );
  const cells = facts.cells;

  const rows = usageRows(cells, {
    w,
    templates: new Map([[template.id, template]]),
    versions: versionMap,
    consumerName,
    sparks: sparkIndex(facts.sparks),
  });

  let ok = 0;
  let errors = 0;
  let previous = 0;
  const byChannel = emptyChannels();
  const pushByPlatform = { ios: 0, android: 0, unrecorded: 0 };
  for (const c of cells) {
    ok += c.ok30;
    errors += c.err30;
    previous += c.prev;
    const renders = c.ok30 + c.err30;
    byChannel[c.channel] += renders;
    if (c.channel === "push")
      pushByPlatform[c.platform ?? "unrecorded"] += renders;
  }
  const attempts = ok + errors;

  // Released versions, newest first, each with every consumer that ever rendered it.
  const released = facts.versions
    .filter((v) => isReleased(v.state))
    .sort((a, b) => b.number - a.number);
  const versionsOut: TemplateUsageVersion[] = released.map((v) => {
    const byConsumer = new Map<
      string,
      {
        id: string;
        name: string;
        renders30d: number;
        errors30d: number;
        lastRenderAt: number;
      }
    >();
    for (const c of cells) {
      if (c.versionNumber !== v.number) continue;
      const e = byConsumer.get(c.consumerId) ?? {
        id: c.consumerId,
        name: consumerName(c.consumerId),
        renders30d: 0,
        errors30d: 0,
        lastRenderAt: 0,
      };
      e.renders30d += c.ok30 + c.err30;
      e.errors30d += c.err30;
      e.lastRenderAt = Math.max(e.lastRenderAt, Date.parse(c.lastAt));
      byConsumer.set(c.consumerId, e);
    }
    const list = [...byConsumer.values()]
      .sort(
        (a, b) =>
          b.renders30d - a.renders30d ||
          b.lastRenderAt - a.lastRenderAt ||
          a.name.localeCompare(b.name),
      )
      .map((e) => ({
        ...e,
        lastRenderAt: new Date(e.lastRenderAt).toISOString(),
      }));
    const errors30d = list.reduce((sum, e) => sum + e.errors30d, 0);
    return {
      number: v.number,
      state: v.state,
      activatedAt: v.activatedAt,
      sunsetAt: v.sunset?.at ?? null,
      sunsetPassed: v.sunset?.passed ?? false,
      revokedAt: v.revokedAt,
      consumers: list,
      tags: usageTags({ state: v.state, sunset: v.sunset, errors30d }),
    };
  });

  // "N% still on vX".
  const rendersByVersion = new Map<number, number>();
  for (const c of cells)
    rendersByVersion.set(
      c.versionNumber,
      (rendersByVersion.get(c.versionNumber) ?? 0) + c.ok30 + c.err30,
    );
  const stillOn = [...rendersByVersion]
    .map(([number, renders]) => ({
      number,
      renders,
      state:
        versionMap.get(versionKey(template.id, number))?.state ?? "superseded",
    }))
    .filter((v) => v.state !== "active" && v.renders > 0)
    .map((v) => ({
      versionNumber: v.number,
      state: v.state,
      renders: v.renders,
      pct: percent(v.renders, attempts, 0) ?? 0,
    }))
    .sort((a, b) => b.renders - a.renders);

  // Series: daily (with errors) and weekly by version.
  const rendersByDay = new Map<string, number>();
  const errByDay = new Map<string, number>();
  const weekly = new Map(
    trendWeeks(w).map((weekStart) => [
      weekStart,
      { weekStart, count: 0, byVersion: {} as Record<number, number> },
    ]),
  );
  const seriesVersions = new Set<number>();
  for (const s of facts.series) {
    if (s.outcome === "error")
      errByDay.set(s.day, (errByDay.get(s.day) ?? 0) + s.count);
    rendersByDay.set(s.day, (rendersByDay.get(s.day) ?? 0) + s.count);
    const week = weekly.get(weekStartOf(s.day));
    if (!week || s.versionNumber === null) continue;
    seriesVersions.add(s.versionNumber);
    week.count += s.count;
    week.byVersion[s.versionNumber] =
      (week.byVersion[s.versionNumber] ?? 0) + s.count;
  }
  const weeklyVersions = [...seriesVersions].sort((a, b) => a - b);
  for (const week of weekly.values())
    for (const n of weeklyVersions) week.byVersion[n] ??= 0;

  const consumersActive = new Set(rows.map((r) => r.consumer.id)).size;
  return {
    template: info,
    asOf: facts.asOf,
    today: w.today,
    stats: {
      renders: {
        value: attempts,
        display: compactCount(attempts),
        previous,
        trendPct: trendPct(attempts, previous),
      },
      consumers: {
        value: consumersActive,
        display: compactCount(consumersActive),
      },
      errors: { value: errors, display: compactCount(errors) },
    },
    daily: dayList(w.historyFrom, w.today).map((date) => ({
      date,
      count: rendersByDay.get(date) ?? 0,
      errors: errByDay.get(date) ?? 0,
    })),
    versions: versionsOut,
    recentErrors: facts.recentErrors.map((e) => ({
      at: e.at,
      consumer: { id: e.consumerId, name: consumerName(e.consumerId) },
      versionNumber: e.versionNumber,
      channel: e.channel,
      platform: e.platform,
      code: e.code,
      text: errorText(e.code),
    })),
    success: { ok, errors, pct: percent(ok, attempts) },
    channels: CHANNELS.filter((c) => facts.allowedChannels.includes(c)),
    byChannel,
    pushByPlatform,
    stillOn,
    weeklyVersions,
    weekly: [...weekly.values()],
    rows,
  };
}
