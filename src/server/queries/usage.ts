import "server-only";
import { cache } from "react";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { daysUntilSunset, sunsetDay } from "@/domain/business-zone";
import {
  addDays,
  compactCount,
  compareUsageRows,
  consumerLabel,
  dayList,
  dayStartMs,
  errorText,
  heatmap,
  percent,
  trendPct,
  usageTags,
  usageWindows,
  weekStartOf,
  type UsageWindows,
} from "@/domain/golive/usage";
import {
  NEARING_SUNSET_DAYS,
  TREND_WEEKS,
  type TemplateUsageData,
  type TemplateUsageVersion,
  type UsageDashboard,
  type UsageRow,
} from "@/domain/golive-types";
import { ALL_SPACE, can } from "@/domain/permissions";
import type { RenderErrorCode } from "@/domain/render/types";
import { type Channel, type RevokeRecord, type VersionState } from "@/domain/types";
import { getBusinessZone } from "@/server/business-zone";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { consumers, renderLog, teams, templates, versions } from "@/server/db/schema/ucomp";
import { requireTemplate } from "./review-shared";
import { requireSpace } from "./spaces";
import { currentName } from "./template-name";

// The Usage read models (slice S2). render_log is ~27k rows: every number is grouped in SQL by
// day / consumer / template / version / channel, with the windows from `usageWindows(now)` (demo
// clock, UTC days). Only usage counts: `is_preview = 0 AND consumer_id IS NOT NULL`, never after now,
// and never a call the render route refused as `unknown_consumer`: that row keeps the caller's
// unregistered X-Consumer-Id in render_log (the trail of who tried), but a caller UCOMP refused as
// "not a consumer" is not a consumer. A consumer later removed from the registry still shows: its
// rows were accepted renders when they happened.
//
// One denominator everywhere: a render is an ATTEMPT, succeeded or failed. "Renders" (the headline, the
// bars, the heatmap, a consumer's row) count every attempt; "failed" is the subset that errored, and
// "succeeded" is the rest as a share of attempts. So a template whose only render failed reads "1 render,
// 0% succeeded, 1 failed" and every card reconciles with every other.

const RELEASED: readonly VersionState[] = ["active", "superseded", "revoked"];

const day = sql<string>`strftime('%Y-%m-%d', ${renderLog.at} / 1000, 'unixepoch')`;
const isOk = sql`${renderLog.outcome} = 'ok'`;
const isError = sql`${renderLog.outcome} = 'error'`;
const num = (v: unknown) => Number(v ?? 0);
const UNKNOWN_CONSUMER: RenderErrorCode = "unknown_consumer";

/** The rows that are usage, up to the demo clock, optionally for some templates only. */
function usageWhere(w: UsageWindows, templateIds: readonly string[] | null, from?: number): SQL {
  return and(
    eq(renderLog.isPreview, false),
    isNotNull(renderLog.consumerId),
    sql`coalesce(${renderLog.errorCode}, '') <> ${UNKNOWN_CONSUMER}`,
    lte(renderLog.at, new Date(w.until)),
    from === undefined ? undefined : gte(renderLog.at, new Date(from)),
    templateIds === null ? undefined : inArray(renderLog.templateId, [...templateIds]),
  )!;
}

// ── Shared loaders ───────────────────────────────────────────

interface VersionInfo {
  templateId: string;
  number: number;
  state: VersionState;
  activatedAt: Date | null;
  sunsetAt: Date | null;
  revokedAt: Date | null;
}

const versionKey = (templateId: string, number: number) => `${templateId}#${number}`;

function revokedAtOf(state: VersionState, revoke: RevokeRecord | null): Date | null {
  if (state !== "revoked" || !revoke) return null;
  return new Date(revoke.confirmedAt ?? revoke.startedAt);
}

/** Numbered versions of these templates (never the bodies). */
async function loadVersions(templateIds: readonly string[]): Promise<Map<string, VersionInfo>> {
  if (templateIds.length === 0) return new Map();
  const rows = await db
    .select({
      templateId: versions.templateId,
      number: versions.number,
      state: versions.state,
      activatedAt: versions.activatedAt,
      sunsetAt: versions.sunsetAt,
      revoke: versions.revoke,
    })
    .from(versions)
    .where(and(inArray(versions.templateId, [...templateIds]), isNotNull(versions.number)));
  return new Map(
    rows.map((r) => [
      versionKey(r.templateId, r.number!),
      {
        templateId: r.templateId,
        number: r.number!,
        state: r.state,
        activatedAt: r.activatedAt,
        sunsetAt: r.sunsetAt,
        revokedAt: revokedAtOf(r.state, r.revoke),
      },
    ]),
  );
}

async function loadConsumerNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: consumers.id, name: consumers.name }).from(consumers);
  return new Map(rows.map((r) => [r.id, r.name]));
}

interface Cell {
  templateId: string;
  consumerId: string;
  versionNumber: number;
  channel: Channel;
  ok30: number;
  err30: number;
  /** Attempts (succeeded or failed) in the 30 days before the current window. */
  prev: number;
  lastAt: number;
}

/** Per template × consumer × version × channel: the two rolling windows and the last render. */
async function loadCells(w: UsageWindows, templateIds: readonly string[] | null, from?: number): Promise<Cell[]> {
  const current = sql`${renderLog.at} >= ${w.since}`;
  const rows = await db
    .select({
      templateId: renderLog.templateId,
      consumerId: renderLog.consumerId,
      versionNumber: renderLog.versionNumber,
      channel: renderLog.channel,
      ok30: sql<number>`sum(case when ${isOk} and ${current} then 1 else 0 end)`,
      err30: sql<number>`sum(case when ${isError} and ${current} then 1 else 0 end)`,
      prev: sql<number>`sum(case when ${renderLog.at} >= ${w.previousSince} and ${renderLog.at} < ${w.since} then 1 else 0 end)`,
      lastAt: sql<number>`max(${renderLog.at})`,
    })
    .from(renderLog)
    .where(usageWhere(w, templateIds, from))
    .groupBy(renderLog.templateId, renderLog.consumerId, renderLog.versionNumber, renderLog.channel);
  return rows
    .filter((r) => r.versionNumber !== null)
    .map((r) => ({
      templateId: r.templateId,
      consumerId: r.consumerId!,
      versionNumber: r.versionNumber!,
      channel: r.channel,
      ok30: num(r.ok30),
      err30: num(r.err30),
      prev: num(r.prev),
      lastAt: num(r.lastAt),
    }));
}

/** Renders (attempts) per day for each template × consumer × version, over the sparkline days. */
async function loadSparks(w: UsageWindows, templateIds: readonly string[] | null): Promise<Map<string, Map<string, number>>> {
  const rows = await db
    .select({
      day,
      templateId: renderLog.templateId,
      consumerId: renderLog.consumerId,
      versionNumber: renderLog.versionNumber,
      count: sql<number>`count(*)`,
    })
    .from(renderLog)
    .where(usageWhere(w, templateIds, dayStartMs(w.sparkFrom)))
    .groupBy(day, renderLog.templateId, renderLog.consumerId, renderLog.versionNumber);
  const sparks = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = rowKey(r.templateId, r.consumerId!, r.versionNumber ?? 0);
    const byDay = sparks.get(key) ?? new Map<string, number>();
    byDay.set(r.day, num(r.count));
    sparks.set(key, byDay);
  }
  return sparks;
}

const rowKey = (templateId: string, consumerId: string, versionNumber: number) => `${templateId}#${consumerId}#${versionNumber}`;

interface TemplateInfo {
  id: string;
  name: string;
  teamSlug: string;
}

/** Cells → one UsageRow per consumer × template × version with any render in the last 30 days. */
function buildRows(
  cells: readonly Cell[],
  ctx: {
    now: Date;
    /** The business time zone: a sunset's day and the days to it are read there. */
    zone: string;
    w: UsageWindows;
    templates: ReadonlyMap<string, TemplateInfo>;
    versions: ReadonlyMap<string, VersionInfo>;
    consumerNames: ReadonlyMap<string, string>;
    sparks: ReadonlyMap<string, ReadonlyMap<string, number>>;
  },
): UsageRow[] {
  const grouped = new Map<string, { templateId: string; consumerId: string; versionNumber: number; ok: number; err: number; lastAt: number }>();
  for (const c of cells) {
    const key = rowKey(c.templateId, c.consumerId, c.versionNumber);
    const g = grouped.get(key) ?? { templateId: c.templateId, consumerId: c.consumerId, versionNumber: c.versionNumber, ok: 0, err: 0, lastAt: 0 };
    g.ok += c.ok30;
    g.err += c.err30;
    g.lastAt = Math.max(g.lastAt, c.lastAt);
    grouped.set(key, g);
  }

  const sparkDays = dayList(ctx.w.sparkFrom, ctx.w.today);
  const rows: UsageRow[] = [];
  for (const [key, g] of grouped) {
    const attempts = g.ok + g.err;
    if (attempts === 0) continue;
    const template = ctx.templates.get(g.templateId);
    const version = ctx.versions.get(versionKey(g.templateId, g.versionNumber));
    if (!template) continue;
    const state = version?.state ?? "superseded";
    const spark = ctx.sparks.get(key);
    rows.push({
      consumer: { id: g.consumerId, name: ctx.consumerNames.get(g.consumerId) ?? consumerLabel(g.consumerId) },
      template,
      versionNumber: g.versionNumber,
      versionState: state,
      renders30d: attempts,
      errors30d: g.err,
      lastRenderAt: new Date(g.lastAt).toISOString(),
      tags: usageTags(
        { versionNumber: g.versionNumber, state, sunsetAt: version?.sunsetAt ?? null, revokedAt: version?.revokedAt ?? null, errors30d: g.err },
        ctx.now,
        ctx.zone,
      ),
      sunsetDay: version?.sunsetAt ? sunsetDay(version.sunsetAt, ctx.zone) : null,
      spark: sparkDays.map((d) => spark?.get(d) ?? 0),
    });
  }
  return rows.sort(compareUsageRows);
}

const emptyChannels = (): Record<Channel, number> => ({ pdf: 0, web: 0, email: 0 });

function trendWeeks(w: UsageWindows): string[] {
  return Array.from({ length: TREND_WEEKS }, (_, i) => addDays(w.trendFrom, i * 7));
}

// ── The dashboard ────────────────────────────────────────────

/** /[team]/usage. A team space = that team's templates; "all" = every team the viewer can see. */
export const getUsageDashboard = cache(async (spaceSlug: string): Promise<UsageDashboard> => {
  const space = await requireSpace(spaceSlug);
  const nowDate = await now();
  const zone = await getBusinessZone();
  const w = usageWindows(nowDate);

  const templateRows = await db
    .select({ id: templates.id, name: currentName(templates.id), teamId: teams.id, teamSlug: teams.slug })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(space.isAll ? undefined : eq(teams.slug, spaceSlug));
  const visible = templateRows.filter((t) => can(space.viewer, "template.view", { teamId: t.teamId }).ok);
  const templateMap = new Map<string, TemplateInfo>(visible.map((t) => [t.id, { id: t.id, name: t.name, teamSlug: t.teamSlug }]));
  const ids = [...templateMap.keys()];
  // Every template counts in "all" when the viewer sees every team: skip the IN list then.
  const filter = space.isAll && visible.length === templateRows.length ? null : ids;

  const [versionMap, consumerNames, cells, sparks, series] = await Promise.all([
    loadVersions(ids),
    loadConsumerNames(),
    ids.length ? loadCells(w, filter, w.previousSince) : Promise.resolve([]),
    ids.length ? loadSparks(w, filter) : Promise.resolve(new Map<string, Map<string, number>>()),
    ids.length ? loadDailySeries(w, filter) : Promise.resolve([]),
  ]);

  const rows = buildRows(cells, { now: nowDate, zone, w, templates: templateMap, versions: versionMap, consumerNames, sparks });

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

  const activeTemplates = new Set([...versionMap.values()].filter((v) => v.state === "active").map((v) => v.templateId)).size;
  const nearing = [...versionMap.values()]
    .filter(
      (v) =>
        v.state === "superseded" &&
        v.sunsetAt !== null &&
        v.sunsetAt.getTime() > w.until &&
        daysUntilSunset(v.sunsetAt, nowDate, zone) <= NEARING_SUNSET_DAYS,
    )
    .sort((a, b) => a.sunsetAt!.getTime() - b.sunsetAt!.getTime());
  const soonest = nearing[0];

  // Consumers.
  const consumerTotals = new Map<string, number>();
  for (const r of rows) consumerTotals.set(r.consumer.id, (consumerTotals.get(r.consumer.id) ?? 0) + r.renders30d);
  const byConsumer = [...consumerTotals]
    .map(([id, renders]) => ({ consumer: { id, name: consumerNames.get(id) ?? consumerLabel(id) }, renders, share: attempts ? renders / attempts : 0 }))
    .sort((a, b) => b.renders - a.renders || a.consumer.name.localeCompare(b.consumer.name));

  // Templates and versions.
  const templateTotals = new Map<string, number>();
  const otherVersions = new Map<string, { template: { id: string; name: string }; versionNumber: number; renders: number }>();
  let onActive = 0;
  for (const r of rows) {
    templateTotals.set(r.template.id, (templateTotals.get(r.template.id) ?? 0) + r.renders30d);
    if (r.versionState === "active") {
      onActive += r.renders30d;
    } else if (r.renders30d > 0) {
      const key = versionKey(r.template.id, r.versionNumber);
      const o = otherVersions.get(key) ?? { template: { id: r.template.id, name: r.template.name }, versionNumber: r.versionNumber, renders: 0 };
      o.renders += r.renders30d;
      otherVersions.set(key, o);
    }
  }
  const byTemplate = [...templateTotals]
    .filter(([, renders]) => renders > 0)
    .map(([id, renders]) => ({ template: templateMap.get(id)!, renders, share: attempts ? renders / attempts : 0 }))
    .sort((a, b) => b.renders - a.renders || a.template.name.localeCompare(b.template.name));

  // Series.
  const rendersByDay = new Map<string, number>();
  const errByDay = new Map<string, number>();
  const weekly = new Map(trendWeeks(w).map((weekStart) => [weekStart, { weekStart, count: 0, errors: 0, channels: emptyChannels() }]));
  for (const s of series) {
    rendersByDay.set(s.day, (rendersByDay.get(s.day) ?? 0) + s.count);
    if (s.outcome === "error") errByDay.set(s.day, (errByDay.get(s.day) ?? 0) + s.count);
    const week = weekly.get(weekStartOf(s.day));
    if (!week) continue;
    week.count += s.count;
    week.channels[s.channel] += s.count;
    if (s.outcome === "error") week.errors += s.count;
  }

  return {
    space: { slug: space.slug, name: space.name, isAll: space.slug === ALL_SPACE },
    today: w.today,
    stats: {
      renders: { value: attempts, display: compactCount(attempts), previous, trendPct: trendPct(attempts, previous) },
      activeTemplates: { value: activeTemplates, display: compactCount(activeTemplates) },
      consumers: { value: consumerTotals.size, display: compactCount(consumerTotals.size) },
      nearingSunset: {
        value: nearing.length,
        display: compactCount(nearing.length),
        soonest: soonest
          ? {
              templateName: templateMap.get(soonest.templateId)!.name,
              versionNumber: soonest.number,
              daysAway: daysUntilSunset(soonest.sunsetAt!, nowDate, zone),
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
      otherVersions: [...otherVersions.values()].sort((a, b) => b.renders - a.renders),
    },
    byTemplate,
    weekly: [...weekly.values()],
    daily: dayList(w.historyFrom, w.today).map((date) => ({ date, count: rendersByDay.get(date) ?? 0, errors: errByDay.get(date) ?? 0 })),
  };
});

/** Per day × channel × outcome, from the earliest series day to now. */
async function loadDailySeries(w: UsageWindows, templateIds: readonly string[] | null) {
  const rows = await db
    .select({ day, channel: renderLog.channel, outcome: renderLog.outcome, count: sql<number>`count(*)` })
    .from(renderLog)
    .where(usageWhere(w, templateIds, w.seriesFromMs))
    .groupBy(day, renderLog.channel, renderLog.outcome);
  return rows.map((r) => ({ day: r.day, channel: r.channel, outcome: r.outcome, count: num(r.count) }));
}

// ── One template ─────────────────────────────────────────────

/** The per-template Usage tab: the same sources, one template, every released version. */
export const getTemplateUsage = cache(async (spaceSlug: string, templateId: string): Promise<TemplateUsageData> => {
  const { template } = await requireTemplate(spaceSlug, templateId);
  const nowDate = await now();
  const zone = await getBusinessZone();
  const w = usageWindows(nowDate);
  const info: TemplateInfo = { id: template.id, name: template.name, teamSlug: template.teamSlug };
  const ids = [template.id];

  const [versionMap, consumerNames, cells, sparks, series, errorRows] = await Promise.all([
    loadVersions(ids),
    loadConsumerNames(),
    // All time: a version's consumers include those that stopped rendering it.
    loadCells(w, ids),
    loadSparks(w, ids),
    db
      .select({ day, versionNumber: renderLog.versionNumber, outcome: renderLog.outcome, count: sql<number>`count(*)` })
      .from(renderLog)
      .where(usageWhere(w, ids, w.seriesFromMs))
      .groupBy(day, renderLog.versionNumber, renderLog.outcome),
    db
      .select({
        at: renderLog.at,
        consumerId: renderLog.consumerId,
        versionNumber: renderLog.versionNumber,
        channel: renderLog.channel,
        code: renderLog.errorCode,
      })
      .from(renderLog)
      .where(and(usageWhere(w, ids), isError))
      .orderBy(desc(renderLog.at))
      .limit(10),
  ]);

  const rows = buildRows(cells, { now: nowDate, zone, w, templates: new Map([[info.id, info]]), versions: versionMap, consumerNames, sparks });

  let ok = 0;
  let errors = 0;
  let previous = 0;
  for (const c of cells) {
    ok += c.ok30;
    errors += c.err30;
    previous += c.prev;
  }
  const attempts = ok + errors;

  // Released versions, newest first, each with every consumer that ever rendered it.
  const released = [...versionMap.values()].filter((v) => RELEASED.includes(v.state)).sort((a, b) => b.number - a.number);
  const versionsOut: TemplateUsageVersion[] = released.map((v) => {
    const byConsumer = new Map<string, { id: string; name: string; renders30d: number; errors30d: number; lastRenderAt: number }>();
    for (const c of cells) {
      if (c.versionNumber !== v.number) continue;
      const e = byConsumer.get(c.consumerId) ?? { id: c.consumerId, name: consumerNames.get(c.consumerId) ?? consumerLabel(c.consumerId), renders30d: 0, errors30d: 0, lastRenderAt: 0 };
      e.renders30d += c.ok30 + c.err30;
      e.errors30d += c.err30;
      e.lastRenderAt = Math.max(e.lastRenderAt, c.lastAt);
      byConsumer.set(c.consumerId, e);
    }
    const list = [...byConsumer.values()]
      .sort((a, b) => b.renders30d - a.renders30d || b.lastRenderAt - a.lastRenderAt || a.name.localeCompare(b.name))
      .map((e) => ({ ...e, lastRenderAt: new Date(e.lastRenderAt).toISOString() }));
    const errors30d = list.reduce((sum, e) => sum + e.errors30d, 0);
    return {
      number: v.number,
      state: v.state,
      activatedAt: v.activatedAt?.toISOString() ?? null,
      sunsetAt: v.sunsetAt?.toISOString() ?? null,
      sunsetPassed: v.sunsetAt !== null && v.sunsetAt.getTime() <= w.until,
      revokedAt: v.revokedAt?.toISOString() ?? null,
      consumers: list,
      tags: usageTags({ versionNumber: v.number, state: v.state, sunsetAt: v.sunsetAt, revokedAt: v.revokedAt, errors30d }, nowDate, zone),
    };
  });

  // "N% still on vX".
  const rendersByVersion = new Map<number, number>();
  for (const c of cells) rendersByVersion.set(c.versionNumber, (rendersByVersion.get(c.versionNumber) ?? 0) + c.ok30 + c.err30);
  const stillOn = [...rendersByVersion]
    .map(([number, renders]) => ({ number, renders, state: versionMap.get(versionKey(template.id, number))?.state ?? "superseded" }))
    .filter((v) => v.state !== "active" && v.renders > 0)
    .map((v) => ({ versionNumber: v.number, state: v.state, renders: v.renders, pct: percent(v.renders, attempts, 0) ?? 0 }))
    .sort((a, b) => b.renders - a.renders);

  // Series: daily (with errors) and weekly by version.
  const rendersByDay = new Map<string, number>();
  const errByDay = new Map<string, number>();
  const weeks = trendWeeks(w);
  const weekly = new Map(weeks.map((weekStart) => [weekStart, { weekStart, count: 0, byVersion: {} as Record<number, number> }]));
  const seriesVersions = new Set<number>();
  for (const s of series) {
    const count = num(s.count);
    if (s.outcome === "error") errByDay.set(s.day, (errByDay.get(s.day) ?? 0) + count);
    rendersByDay.set(s.day, (rendersByDay.get(s.day) ?? 0) + count);
    const week = weekly.get(weekStartOf(s.day));
    if (!week || s.versionNumber === null) continue;
    seriesVersions.add(s.versionNumber);
    week.count += count;
    week.byVersion[s.versionNumber] = (week.byVersion[s.versionNumber] ?? 0) + count;
  }
  const weeklyVersions = [...seriesVersions].sort((a, b) => a - b);
  for (const week of weekly.values()) for (const n of weeklyVersions) week.byVersion[n] ??= 0;

  const consumersActive = new Set(rows.map((r) => r.consumer.id)).size;
  return {
    template: info,
    today: w.today,
    stats: {
      renders: { value: attempts, display: compactCount(attempts), previous, trendPct: trendPct(attempts, previous) },
      consumers: { value: consumersActive, display: compactCount(consumersActive) },
      errors: { value: errors, display: compactCount(errors) },
    },
    daily: dayList(w.historyFrom, w.today).map((date) => ({ date, count: rendersByDay.get(date) ?? 0, errors: errByDay.get(date) ?? 0 })),
    versions: versionsOut,
    recentErrors: errorRows.map((e) => {
      const code = (e.code ?? "render_failed") as RenderErrorCode;
      return {
        at: e.at.toISOString(),
        consumer: { id: e.consumerId!, name: consumerNames.get(e.consumerId!) ?? consumerLabel(e.consumerId!) },
        versionNumber: e.versionNumber,
        channel: e.channel,
        code,
        text: errorText(code),
      };
    }),
    success: { ok, errors, pct: percent(ok, attempts) },
    stillOn,
    weeklyVersions,
    weekly: [...weekly.values()],
    rows,
  };
});
