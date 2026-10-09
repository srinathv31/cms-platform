import "server-only";
import { and, asc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { apiBadRequest, QUERY_MESSAGES } from "@/domain/golive/api-errors";
import { contractDiff } from "@/domain/golive/contract-diff";
import { compareSearchKeys, cutPage, noticeCursor, searchCursor, type SearchKey } from "@/domain/golive/cursor";
import { apiVariables, contractJsonSchema } from "@/domain/golive/json-schema";
import { noticeView } from "@/domain/golive/notices";
import { contractBaseline, sunsetPassed } from "@/domain/lifecycle";
import type {
  ApiContract,
  ApiError,
  ApiNotice,
  ApiTemplateDetail,
  ApiTemplateSummary,
  ApiVersionState,
  ApiVersionSummary,
} from "@/domain/golive-types";
import {
  checkVersion,
  consumerRequired,
  templateNotFound,
  unknownConsumer,
  versionNotFound,
  versionNotReleased,
} from "@/domain/render";
import { CHANNELS, type Channel, type VersionState } from "@/domain/types";
import { readBusinessZone } from "@/server/business-zone";
import { db } from "@/server/db/client";
import { consumerNotices, consumers, contentTypes, settings, teams, templates, versions } from "@/server/db/schema/ucomp";

// The consumer API's reads (GET /api/v1/…). No viewer: a consumer is identified by X-Consumer-Id and
// sees every released version of every template, nothing else. Drafts and versions in review never
// leave UCOMP; a template with no released version doesn't exist as far as a consumer can tell.

const RELEASED: readonly ApiVersionState[] = ["active", "superseded", "revoked"];
const isReleased = (state: VersionState): state is ApiVersionState => (RELEASED as readonly string[]).includes(state);

/**
 * The channels a consumer can render, in the contract's order (pdf, web, email): the ones turned on
 * for the version that its content type still allows. Channel rules can turn a channel off after a
 * version went Active, and the render route refuses it from then on (channel_not_allowed), so the API
 * never advertises it.
 */
const published = (versionChannels: readonly Channel[], allowed: readonly Channel[]): Channel[] =>
  CHANNELS.filter((c) => versionChannels.includes(c) && allowed.includes(c));

// ── Consumers ────────────────────────────────────────────────────────────────

export interface Consumer {
  id: string;
  name: string;
}

/** A registered consumer by id, or null. */
export async function findConsumer(consumerId: string): Promise<Consumer | null> {
  const [row] = await db
    .select({ id: consumers.id, name: consumers.name })
    .from(consumers)
    .where(eq(consumers.id, consumerId))
    .limit(1);
  return row ?? null;
}

/** The X-Consumer-Id header: present (400 consumer_required) and registered (403 unknown_consumer). */
export async function requireConsumer(
  header: string | null,
): Promise<{ ok: true; consumer: Consumer } | { ok: false; error: ApiError }> {
  const id = header?.trim() ?? "";
  if (id === "") return { ok: false, error: consumerRequired() };
  const consumer = await findConsumer(id);
  return consumer ? { ok: true, consumer } : { ok: false, error: unknownConsumer(id) };
}

// ── Search ───────────────────────────────────────────────────────────────────

/** "uc-4f7k2q", "UC-4F7K2Q" and "4F7K2Q" → "UC-4F7K2Q"; null when the query can't be an id. */
export function templateIdFromQuery(q: string): string | null {
  const code = q.trim().toUpperCase().replace(/^UC-/, "");
  return /^[0-9A-Z]{6}$/.test(code) ? `UC-${code}` : null;
}

/** One page of a search: `ApiTemplateSearch` without the query and the clock. */
export interface SearchPage {
  results: ApiTemplateSummary[];
  hasMore: boolean;
  nextCursor: string;
}

/**
 * Templates with an Active version that match `q`: the id (with or without "UC-", any case) or every
 * word in the name. An exact id first, then names that start with the query, then the rest; ties by
 * name, then id (`compareSearchKeys`). An empty query lists every Active template. One page of `limit`
 * results after the key `after` (from the request's cursor; null for the first page). The name is the
 * Active version's, for matching, ordering, the cursor and the result alike: a draft's rename shows
 * here only once that draft goes live.
 */
export async function searchActiveTemplates(q: string, limit: number, after: SearchKey | null = null): Promise<SearchPage> {
  const rows = await db
    .select({
      id: templates.id,
      name: versions.name,
      teamId: teams.id,
      teamName: teams.name,
      contentTypeKey: contentTypes.key,
      contentTypeName: contentTypes.name,
      allowedChannels: contentTypes.allowedChannels,
      number: versions.number,
      activatedAt: versions.activatedAt,
      createdAt: versions.createdAt,
      channels: versions.channels,
      variables: versions.variables,
    })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(versions.state, "active"));

  const query = q.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const exactId = templateIdFromQuery(query);

  type Row = (typeof rows)[number];
  const keyOf = (row: Row): SearchKey | null => {
    const key = (rank: number) => ({ rank, name: row.name, id: row.id });
    if (row.id === exactId) return key(0);
    const name = row.name.toLowerCase();
    if (!words.every((word) => name.includes(word))) return null;
    return key(name.startsWith(query) ? 1 : 2);
  };

  const matches = rows
    .map((row) => ({ row, key: keyOf(row) }))
    .filter((r): r is { row: Row; key: SearchKey } => r.key !== null)
    .filter((r) => after === null || compareSearchKeys(r.key, after) > 0)
    .sort((a, b) => compareSearchKeys(a.key, b.key));
  const { items, hasMore } = cutPage(matches, limit);
  return {
    results: items.map(({ row }) => ({
      id: row.id,
      name: row.name,
      team: { id: row.teamId, name: row.teamName },
      contentType: { key: row.contentTypeKey, name: row.contentTypeName },
      activeVersion: row.number!,
      activatedAt: (row.activatedAt ?? row.createdAt).toISOString(),
      channels: published(row.channels, row.allowedChannels),
      variableCount: row.variables.length,
      requiredCount: row.variables.filter((v) => v.required).length,
    })),
    hasMore,
    nextCursor: searchCursor(q, items.at(-1)?.key ?? after),
  };
}

// ── One template ─────────────────────────────────────────────────────────────

type VersionRow = typeof versions.$inferSelect;

function versionSummary(
  v: VersionRow & { state: ApiVersionState },
  activeNumber: number | null,
  allowed: readonly Channel[],
  now: Date,
  zone: string,
): ApiVersionSummary {
  const revokedAt = v.revoke?.confirmedAt ?? null;
  return {
    number: v.number!,
    state: v.state,
    activatedAt: (v.activatedAt ?? v.createdAt).toISOString(),
    supersededAt: v.supersededAt?.toISOString() ?? null,
    sunsetAt: v.sunsetAt?.toISOString() ?? null,
    sunsetPassed: sunsetPassed(v, now),
    revokedAt,
    renders: checkVersion({
      version: { number: v.number!, state: v.state, sunsetAt: v.sunsetAt, revokedAt: revokedAt ? new Date(revokedAt) : null },
      activeNumber,
      now,
      zone,
    }).ok,
    channels: published(v.channels, allowed),
  };
}

/**
 * A template's released versions and one version's contract (the Active one by default), plus the
 * changes since an older released version when `since` is given. Errors as in api-v1.ts.
 */
export async function getTemplateDetail(
  templateId: string,
  opts: { version?: number; since?: number },
  now: Date,
): Promise<{ ok: true; detail: ApiTemplateDetail } | { ok: false; error: ApiError }> {
  if (opts.version !== undefined && opts.since !== undefined && opts.since >= opts.version) {
    return { ok: false, error: apiBadRequest(QUERY_MESSAGES.sinceOrder) };
  }

  const [template] = await db
    .select({
      id: templates.id,
      teamId: teams.id,
      teamName: teams.name,
      contentTypeKey: contentTypes.key,
      contentTypeName: contentTypes.name,
      allowedChannels: contentTypes.allowedChannels,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!template) return { ok: false, error: templateNotFound(templateId) };

  const all = (await db.select().from(versions).where(eq(versions.templateId, template.id))).filter((v) => v.number !== null);
  const released = all
    .filter((v): v is VersionRow & { state: ApiVersionState } => isReleased(v.state))
    .sort((a, b) => b.number! - a.number!);
  // Unreleased templates are invisible to consumers.
  if (released.length === 0) return { ok: false, error: templateNotFound(template.id) };

  const active = released.find((v) => v.state === "active") ?? null;
  const activeNumber = active?.number ?? null;
  // The template's name is the Active version's. With none Active (it was revoked), the name of the
  // version consumers can still render (`contractBaseline`); with nothing rendering, the newest released one's.
  const name = (contractBaseline(released, now) ?? released[0]!).name;
  const zone = await readBusinessZone(db);

  /** A version a consumer may read by number: 404 when there's none, 409 when it isn't released. */
  const readable = (number: number) => {
    const found = all.find((v) => v.number === number);
    if (!found) return { ok: false as const, error: versionNotFound(template.id, number) };
    if (!isReleased(found.state)) {
      const state = found.state as "draft" | "in_review" | "changes_requested";
      return { ok: false as const, error: versionNotReleased(number, state, activeNumber) };
    }
    return { ok: true as const, version: found as VersionRow & { state: ApiVersionState } };
  };

  let target: (VersionRow & { state: ApiVersionState }) | null = active;
  if (opts.version !== undefined) {
    const found = readable(opts.version);
    if (!found.ok) return found;
    target = found.version;
  }

  let changes: ApiTemplateDetail["changes"];
  if (opts.since !== undefined && target) {
    if (opts.since >= target.number!) return { ok: false, error: apiBadRequest(QUERY_MESSAGES.sinceOrder) };
    const from = readable(opts.since);
    if (!from.ok) return from;
    changes = contractDiff(
      { number: from.version.number!, variables: from.version.variables },
      { number: target.number!, variables: target.variables },
    );
  }

  const contract: ApiContract | null = target
    ? {
        version: target.number!,
        state: target.state,
        channels: published(target.channels, template.allowedChannels),
        variables: apiVariables(target.variables),
        jsonSchema: contractJsonSchema({
          templateId: template.id,
          templateName: target.name,
          versionNumber: target.number!,
          variables: target.variables,
        }),
      }
    : null;

  const detail: ApiTemplateDetail = {
    id: template.id,
    name,
    team: { id: template.teamId, name: template.teamName },
    contentType: { key: template.contentTypeKey, name: template.contentTypeName },
    asOf: now.toISOString(),
    activeVersion: activeNumber,
    versions: released.map((v) => versionSummary(v, activeNumber, template.allowedChannels, now, zone)),
    contract,
    ...(changes ? { changes } : {}),
  };
  return { ok: true, detail };
}

// ── Notices ──────────────────────────────────────────────────────────────────

/** One page of a consumer's notices: `ApiNoticeList` without the consumer and the clock. */
export interface NoticePage {
  notices: ApiNotice[];
  hasMore: boolean;
  nextCursor: string;
}

/** The settings row the seed writes at every reset: the notice cursors' epoch. */
const SEEDED_AT_KEY = "seeded_at";

/**
 * The epoch notice cursors carry: `settings.seeded_at`, which a demo reset rewrites when it starts
 * the notice numbers again. Null for a database that was never seeded.
 */
export async function noticeEpoch(): Promise<string | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SEEDED_AT_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/**
 * One consumer's notices, oldest first in the order they were written (`seq`), normalized (both
 * payload shapes) and worded: `limit` of them after `after` (a `seq` from the request's cursor; 0 for
 * the first page). The next cursor is the page's last `seq`, or `after` again when the page is empty.
 * `epoch` is the one the route checked the cursor against; it's read here when not given.
 */
export async function listNotices(
  consumerId: string,
  opts: { after?: number; templateId?: string; limit: number; epoch?: string | null },
): Promise<NoticePage> {
  const after = opts.after ?? 0;
  const epoch = opts.epoch === undefined ? await noticeEpoch() : opts.epoch;
  const where: SQL[] = [eq(consumerNotices.consumerId, consumerId), gt(consumerNotices.seq, after)];
  if (opts.templateId) where.push(eq(consumerNotices.templateId, opts.templateId));
  const rows = await db
    .select()
    .from(consumerNotices)
    .where(and(...where))
    .orderBy(asc(consumerNotices.seq))
    .limit(opts.limit + 1);
  const { items, hasMore } = cutPage(rows, opts.limit);
  return {
    notices: (await withActiveVersion(items)).map(noticeView),
    hasMore,
    nextCursor: noticeCursor({ consumerId, templateId: opts.templateId ?? null, epoch }, items.at(-1)?.seq ?? after),
  };
}

type NoticeDbRow = typeof consumerNotices.$inferSelect;

/**
 * Seeded revoke notices don't say which version was Active when they were written (live ones do).
 * Fill it in from the versions' own dates: the other version that was Active at that moment, if any.
 */
async function withActiveVersion(rows: NoticeDbRow[]): Promise<NoticeDbRow[]> {
  const gaps = rows.filter((r) => r.kind === "revoked" && !Object.hasOwn(r.payload ?? {}, "activeVersion"));
  if (gaps.length === 0) return rows;
  const history = await db
    .select({
      id: versions.id,
      templateId: versions.templateId,
      number: versions.number,
      activatedAt: versions.activatedAt,
      supersededAt: versions.supersededAt,
    })
    .from(versions)
    .where(inArray(versions.templateId, [...new Set(gaps.map((r) => r.templateId))]));

  return rows.map((row) => {
    if (!gaps.includes(row)) return row;
    const at = row.createdAt.getTime();
    const active = history.find(
      (v) =>
        v.templateId === row.templateId &&
        v.id !== row.versionId &&
        v.number !== null &&
        v.activatedAt !== null &&
        v.activatedAt.getTime() <= at &&
        (v.supersededAt === null || v.supersededAt.getTime() > at),
    );
    return { ...row, payload: { ...row.payload, activeVersion: active?.number ?? null } };
  });
}
