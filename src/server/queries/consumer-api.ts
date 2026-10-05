import "server-only";
import { and, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { apiBadRequest, QUERY_MESSAGES } from "@/domain/golive/api-errors";
import { contractDiff } from "@/domain/golive/contract-diff";
import { apiVariables, contractJsonSchema } from "@/domain/golive/json-schema";
import { noticeView } from "@/domain/golive/notices";
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
import { db } from "@/server/db/client";
import { consumerNotices, consumers, contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";

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

/**
 * Templates with an Active version that match `q`: the id (with or without "UC-", any case) or every
 * word in the name. An exact id first, then names that start with the query, then the rest; ties by
 * name. An empty query lists every Active template.
 */
export async function searchActiveTemplates(q: string, limit: number): Promise<ApiTemplateSummary[]> {
  const rows = await db
    .select({
      id: templates.id,
      name: templates.name,
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

  const rank = (row: (typeof rows)[number]): number | null => {
    if (row.id === exactId) return 0;
    const name = row.name.toLowerCase();
    if (!words.every((word) => name.includes(word))) return null;
    return name.startsWith(query) ? 1 : 2;
  };

  return rows
    .map((row) => ({ row, rank: rank(row) }))
    .filter((r): r is { row: (typeof rows)[number]; rank: number } => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      name: row.name,
      team: { id: row.teamId, name: row.teamName },
      contentType: { key: row.contentTypeKey, name: row.contentTypeName },
      activeVersion: row.number!,
      activatedAt: (row.activatedAt ?? row.createdAt).toISOString(),
      channels: published(row.channels, row.allowedChannels),
      variableCount: row.variables.length,
      requiredCount: row.variables.filter((v) => v.required).length,
    }));
}

// ── One template ─────────────────────────────────────────────────────────────

type VersionRow = typeof versions.$inferSelect;

function versionSummary(
  v: VersionRow & { state: ApiVersionState },
  activeNumber: number | null,
  allowed: readonly Channel[],
  now: Date,
): ApiVersionSummary {
  const revokedAt = v.revoke?.confirmedAt ?? null;
  return {
    number: v.number!,
    state: v.state,
    activatedAt: (v.activatedAt ?? v.createdAt).toISOString(),
    supersededAt: v.supersededAt?.toISOString() ?? null,
    sunsetAt: v.sunsetAt?.toISOString() ?? null,
    sunsetPassed: v.sunsetAt !== null && v.sunsetAt.getTime() <= now.getTime(),
    revokedAt,
    renders: checkVersion({
      version: { number: v.number!, state: v.state, sunsetAt: v.sunsetAt, revokedAt: revokedAt ? new Date(revokedAt) : null },
      activeNumber,
      now,
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
      name: templates.name,
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
          templateName: template.name,
          versionNumber: target.number!,
          variables: target.variables,
        }),
      }
    : null;

  const detail: ApiTemplateDetail = {
    id: template.id,
    name: template.name,
    team: { id: template.teamId, name: template.teamName },
    contentType: { key: template.contentTypeKey, name: template.contentTypeName },
    asOf: now.toISOString(),
    activeVersion: activeNumber,
    versions: released.map((v) => versionSummary(v, activeNumber, template.allowedChannels, now)),
    contract,
    ...(changes ? { changes } : {}),
  };
  return { ok: true, detail };
}

// ── Notices ──────────────────────────────────────────────────────────────────

/** One consumer's notices, newest first, normalized (both payload shapes) and worded. */
export async function listNotices(
  consumerId: string,
  opts: { since?: Date; templateId?: string; limit: number },
): Promise<ApiNotice[]> {
  const where: SQL[] = [eq(consumerNotices.consumerId, consumerId)];
  if (opts.since) where.push(gt(consumerNotices.createdAt, opts.since));
  if (opts.templateId) where.push(eq(consumerNotices.templateId, opts.templateId));
  const rows = await db
    .select()
    .from(consumerNotices)
    .where(and(...where))
    .orderBy(desc(consumerNotices.createdAt), desc(consumerNotices.id))
    .limit(opts.limit);
  return (await withActiveVersion(rows)).map(noticeView);
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
