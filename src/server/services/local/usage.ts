import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { dayStartMs } from "@/domain/dates";
import {
  RECENT_ERRORS,
  usageSunset,
  usageWindows,
  type UsageCell,
  type UsageConsumerFacts,
  type UsageDayCount,
  type UsageError,
  type UsageSpark,
  type UsageTemplateFacts,
  type UsageVersionDayCount,
  type UsageVersionFacts,
  type UsageWindows,
} from "@/domain/golive/usage";
import { can, canSeeSpace } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { RenderErrorCode } from "@/domain/render/types";
import { headOf } from "@/domain/rounds";
import type { RevokeRecord, VersionState } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  consumers,
  contentTypes,
  renderLog,
  teams,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { refusal } from "../results";
import type { UsageService } from "../usage";
import { readBusinessZone } from "./business-zone";
import type { LocalDeps } from "./command";
import { currentName } from "./template-name";

// The Usage counts on this app's own database (src/server/services/usage.ts says what each read promises).
// render_log is ~27k rows: every count is grouped in SQL by day / consumer / template / version / channel, with
// the windows from `usageWindows(asOf)` (the backend's clock, UTC days). Only usage counts (`countsAsUsage`):
// `is_preview = 0 AND consumer_id IS NOT NULL`, never after the clock, and never a row refused as
// `unknown_consumer`: the render pipeline writes none (a caller that isn't a registered consumer leaves no row),
// and the filter keeps out any an older database still holds. A consumer later removed from the registry still
// counts: its rows were accepted renders when they happened.
//
// One denominator everywhere: a render is an ATTEMPT, succeeded or failed. The BFF adds the counts up
// (`usageDashboard`, `templateUsage`); nothing here words anything.

const day = sql<string>`strftime('%Y-%m-%d', ${renderLog.at} / 1000, 'unixepoch')`;
const isOk = sql`${renderLog.outcome} = 'ok'`;
const isError = sql`${renderLog.outcome} = 'error'`;
const num = (v: unknown) => Number(v ?? 0);
const UNKNOWN_CONSUMER: RenderErrorCode = "unknown_consumer";

/** The rows that are usage (`countsAsUsage`), up to the clock, optionally for some templates only. */
function usageWhere(
  w: UsageWindows,
  templateIds: readonly string[] | null,
  from?: number,
): SQL {
  return and(
    eq(renderLog.isPreview, false),
    isNotNull(renderLog.consumerId),
    sql`coalesce(${renderLog.errorCode}, '') <> ${UNKNOWN_CONSUMER}`,
    lte(renderLog.at, new Date(w.until)),
    from === undefined ? undefined : gte(renderLog.at, new Date(from)),
    templateIds === null
      ? undefined
      : inArray(renderLog.templateId, [...templateIds]),
  )!;
}

// ── Loaders ──────────────────────────────────────────────────

function revokedAtOf(
  state: VersionState,
  revoke: RevokeRecord | null,
): string | null {
  if (state !== "revoked" || !revoke) return null;
  return new Date(revoke.confirmedAt ?? revoke.startedAt).toISOString();
}

/**
 * Numbered versions of these templates (never the bodies), one per number: its head, the released row, else its
 * latest round (`headOf` in domain/rounds.ts), which is the row a consumer's number means. A number's sent-back
 * rounds never stand in for the version consumers render.
 */
async function loadVersions(
  templateIds: readonly string[],
  asOf: Date,
  zone: string,
): Promise<UsageVersionFacts[]> {
  if (templateIds.length === 0) return [];
  const rows = await db
    .select({
      templateId: versions.templateId,
      number: versions.number,
      round: versions.round,
      state: versions.state,
      activatedAt: versions.activatedAt,
      sunsetAt: versions.sunsetAt,
      revoke: versions.revoke,
    })
    .from(versions)
    .where(
      and(
        inArray(versions.templateId, [...templateIds]),
        isNotNull(versions.number),
      ),
    );
  const byTemplate = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTemplate.get(r.templateId) ?? [];
    list.push(r);
    byTemplate.set(r.templateId, list);
  }
  const heads: UsageVersionFacts[] = [];
  for (const [templateId, list] of byTemplate) {
    for (const number of new Set(list.map((r) => r.number!))) {
      const head = headOf(list, number)!;
      heads.push({
        templateId,
        number,
        state: head.state,
        activatedAt: head.activatedAt?.toISOString() ?? null,
        sunset: usageSunset(head.sunsetAt, asOf, zone),
        revokedAt: revokedAtOf(head.state, head.revoke),
      });
    }
  }
  return heads;
}

async function loadConsumers(): Promise<UsageConsumerFacts[]> {
  return db.select({ id: consumers.id, name: consumers.name }).from(consumers);
}

/** Per template × consumer × version × channel (× platform, for a push): the two rolling windows and the last render. */
async function loadCells(
  w: UsageWindows,
  templateIds: readonly string[] | null,
  from?: number,
): Promise<UsageCell[]> {
  const current = sql`${renderLog.at} >= ${w.since}`;
  const rows = await db
    .select({
      templateId: renderLog.templateId,
      consumerId: renderLog.consumerId,
      versionNumber: renderLog.versionNumber,
      channel: renderLog.channel,
      platform: renderLog.platform,
      ok30: sql<number>`sum(case when ${isOk} and ${current} then 1 else 0 end)`,
      err30: sql<number>`sum(case when ${isError} and ${current} then 1 else 0 end)`,
      prev: sql<number>`sum(case when ${renderLog.at} >= ${w.previousSince} and ${renderLog.at} < ${w.since} then 1 else 0 end)`,
      lastAt: sql<number>`max(${renderLog.at})`,
    })
    .from(renderLog)
    .where(usageWhere(w, templateIds, from))
    .groupBy(
      renderLog.templateId,
      renderLog.consumerId,
      renderLog.versionNumber,
      renderLog.channel,
      renderLog.platform,
    );
  return rows
    .filter((r) => r.versionNumber !== null)
    .map((r) => ({
      templateId: r.templateId,
      consumerId: r.consumerId!,
      versionNumber: r.versionNumber!,
      channel: r.channel,
      platform: r.platform,
      ok30: num(r.ok30),
      err30: num(r.err30),
      prev: num(r.prev),
      lastAt: new Date(num(r.lastAt)).toISOString(),
    }));
}

/** Renders (attempts) per day for each template × consumer × version, over the sparkline days. */
async function loadSparks(
  w: UsageWindows,
  templateIds: readonly string[] | null,
): Promise<UsageSpark[]> {
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
    .groupBy(
      day,
      renderLog.templateId,
      renderLog.consumerId,
      renderLog.versionNumber,
    );
  return rows
    .filter((r) => r.versionNumber !== null)
    .map((r) => ({
      templateId: r.templateId,
      consumerId: r.consumerId!,
      versionNumber: r.versionNumber!,
      day: r.day,
      count: num(r.count),
    }));
}

/** Per day × channel × outcome, from the earliest series day to the clock. */
async function loadDailySeries(
  w: UsageWindows,
  templateIds: readonly string[] | null,
): Promise<UsageDayCount[]> {
  const rows = await db
    .select({
      day,
      channel: renderLog.channel,
      outcome: renderLog.outcome,
      count: sql<number>`count(*)`,
    })
    .from(renderLog)
    .where(usageWhere(w, templateIds, w.seriesFromMs))
    .groupBy(day, renderLog.channel, renderLog.outcome);
  return rows.map((r) => ({
    day: r.day,
    channel: r.channel,
    outcome: r.outcome,
    count: num(r.count),
  }));
}

/** One template's per day × version × outcome, over the same days. */
async function loadVersionSeries(
  w: UsageWindows,
  templateId: string,
): Promise<UsageVersionDayCount[]> {
  const rows = await db
    .select({
      day,
      versionNumber: renderLog.versionNumber,
      outcome: renderLog.outcome,
      count: sql<number>`count(*)`,
    })
    .from(renderLog)
    .where(usageWhere(w, [templateId], w.seriesFromMs))
    .groupBy(day, renderLog.versionNumber, renderLog.outcome);
  return rows.map((r) => ({
    day: r.day,
    versionNumber: r.versionNumber,
    outcome: r.outcome,
    count: num(r.count),
  }));
}

/** The latest failed renders of a template, newest first; at one instant the later write first (decision 0063; `rowid` is this database's `seq`). */
async function loadRecentErrors(
  w: UsageWindows,
  templateId: string,
): Promise<UsageError[]> {
  const rows = await db
    .select({
      at: renderLog.at,
      consumerId: renderLog.consumerId,
      versionNumber: renderLog.versionNumber,
      channel: renderLog.channel,
      platform: renderLog.platform,
      code: renderLog.errorCode,
    })
    .from(renderLog)
    .where(and(usageWhere(w, [templateId]), isError))
    .orderBy(desc(renderLog.at), desc(sql`${renderLog}.rowid`))
    .limit(RECENT_ERRORS);
  return rows.map((e) => ({
    at: e.at.toISOString(),
    consumerId: e.consumerId!,
    versionNumber: e.versionNumber,
    channel: e.channel,
    platform: e.platform,
    code: (e.code ?? "render_failed") as RenderErrorCode,
  }));
}

// ── The service ──────────────────────────────────────────────

export function localUsage(deps: LocalDeps): UsageService {
  return {
    async dashboard(ctx, { teamId }) {
      const { viewer } = ctx;
      if (!canSeeSpace(viewer, teamId))
        return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      const asOf = await deps.clock();
      const zone = await readBusinessZone(db);
      const w = usageWindows(asOf);

      const templateRows = await db
        .select({
          id: templates.id,
          name: currentName(templates.id),
          teamId: templates.teamId,
          teamSlug: teams.slug,
        })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .where(teamId === null ? undefined : eq(templates.teamId, teamId));
      const visible: UsageTemplateFacts[] = templateRows.filter(
        (t) => can(viewer, "template.view", { teamId: t.teamId }).ok,
      );
      const ids = visible.map((t) => t.id);
      // Every template counts in "all" when the viewer sees every team: skip the IN list then.
      const filter =
        teamId === null && visible.length === templateRows.length ? null : ids;

      const [versionFacts, consumerFacts, cells, sparks, series] =
        await Promise.all([
          loadVersions(ids, asOf, zone),
          loadConsumers(),
          ids.length
            ? loadCells(w, filter, w.previousSince)
            : Promise.resolve([]),
          ids.length ? loadSparks(w, filter) : Promise.resolve([]),
          ids.length ? loadDailySeries(w, filter) : Promise.resolve([]),
        ]);

      return {
        ok: true,
        asOf: asOf.toISOString(),
        templates: visible,
        versions: versionFacts,
        consumers: consumerFacts,
        cells,
        sparks,
        series,
      };
    },

    async template(ctx, { templateId }) {
      const [template] = await db
        .select({
          id: templates.id,
          name: currentName(templates.id),
          teamId: templates.teamId,
          teamSlug: teams.slug,
          allowedChannels: contentTypes.allowedChannels,
        })
        .from(templates)
        .innerJoin(teams, eq(teams.id, templates.teamId))
        .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
        .where(eq(templates.id, templateId))
        .limit(1);
      // Not there, and not the viewer's to see, read the same (decision 0052).
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);

      const asOf = await deps.clock();
      const zone = await readBusinessZone(db);
      const w = usageWindows(asOf);
      const ids = [template.id];

      const [versionFacts, consumerFacts, cells, sparks, series, recentErrors] =
        await Promise.all([
          loadVersions(ids, asOf, zone),
          loadConsumers(),
          // All time: a version's consumers include those that stopped rendering it.
          loadCells(w, ids),
          loadSparks(w, ids),
          loadVersionSeries(w, template.id),
          loadRecentErrors(w, template.id),
        ]);

      const { allowedChannels, ...info } = template;
      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: info,
        allowedChannels,
        versions: versionFacts,
        consumers: consumerFacts,
        cells,
        sparks,
        series,
        recentErrors,
      };
    },
  };
}
