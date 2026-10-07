import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import {
  AUDIT_PAGE_LIMIT,
  type AuditCategory,
  type AuditFilters,
  type AuditPageData,
  type AuditRow,
} from "@/domain/access-types";
import { SYSTEM_ACTOR, SYSTEM_INITIALS } from "@/domain/activity";
import {
  AUDIT_CATEGORIES,
  CATEGORY_LABEL,
  SYSTEM_PERSON,
  actionKeyOf,
  actionLabel,
  actionOptions,
  auditFacetCounts,
  auditQuery,
  categoryOf,
  datePresets,
  describeAuditEvent,
  filterAuditRows,
  filterValues,
  personKeysOf,
  subjectIdOf,
  toCsv,
  withFilterValues,
} from "@/domain/audit";
import { ALL_SPACE, can, isCrossTeam } from "@/domain/permissions";
import type { Person } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { auditEvents, teams, templates, versions } from "@/server/db/schema/ucomp";
import { formatDateTime } from "@/domain/dates";
import { dayAgo } from "./format";
import { dayOf, getPeople, iso, personOf, type People } from "./review-shared";
import { requireSpace } from "./spaces";

// The Audit page (/{team}/audit) and its CSV export (/{team}/audit/export), from one read.
//
// Scope: a team space shows that team's events to whoever holds `audit.view` there (its Team
// Admins, the Auditor, the Platform Admin). "All teams" (Auditor, Platform Admin) shows every event,
// platform-wide ones (team null) included, with a Team filter. Everything is read-only.
//
// The space's events are read once and filtered in memory: the menus need counts under every OTHER
// filter, and an audit log of a prototype's size (hundreds to a few thousand rows) is cheap to scan.

interface AuditScope {
  slug: string;
  isAll: boolean;
  /** null: every team (the All teams space). */
  teamId: string | null;
  name: string;
}

const SYSTEM_PERSON_VIEW: Person = { id: SYSTEM_PERSON, name: SYSTEM_ACTOR, initials: SYSTEM_INITIALS, hue: 0 };

const FILTER_KEYS = ["team", "person", "action", "template", "from", "to"] as const satisfies readonly (keyof AuditFilters)[];

/**
 * The Audit page's read model. 404 without `audit.view` in the space (a hidden page, not a refusal).
 * Read once per request: the header's Export count and the table each pass their own filters object,
 * and React's `cache` keys an object by identity, so the read is cached on a string key instead.
 */
export function getAuditPage(spaceSlug: string, filters: AuditFilters): Promise<AuditPageData> {
  return auditPageFor(spaceSlug, JSON.stringify(FILTER_KEYS.map((key) => filters[key] ?? null)));
}

const auditPageFor = cache(async (spaceSlug: string, filtersKey: string): Promise<AuditPageData> => {
  const values = JSON.parse(filtersKey) as (string | null)[];
  const filters: AuditFilters = {};
  FILTER_KEYS.forEach((key, i) => {
    if (values[i] !== null) filters[key] = values[i]!;
  });
  const space = await requireSpace(spaceSlug);
  if (!can(space.viewer, "audit.view", { teamId: space.teamId ?? ALL_SPACE }).ok) notFound();
  const { data } = await readAudit(
    { slug: space.slug, isAll: space.isAll, teamId: space.teamId, name: space.name },
    filters,
    await now(),
  );
  return data;
});

export type AuditExport =
  | { ok: true; filename: string; csv: string; count: number }
  | { ok: false; status: 403 | 404; reason: string };

/**
 * The CSV of every event the filters match (no page limit), for the export route. A route answers
 * with a status instead of redirecting: unknown team → 404; no `audit.view` there → 403.
 */
export async function getAuditExport(viewer: Viewer, spaceSlug: string, filters: AuditFilters): Promise<AuditExport> {
  const scope = await auditScope(viewer, spaceSlug);
  if (!scope.ok) return scope;
  const nowDate = await now();
  const { matching } = await readAudit(scope.scope, filters, nowDate);
  return {
    ok: true,
    filename: `stencil-audit-${scope.scope.slug}-${dayOf(nowDate)}.csv`,
    csv: toCsv(matching),
    count: matching.length,
  };
}

/** Who may read which space's audit, answered as a status (for the export route). */
export async function auditScope(
  viewer: Viewer,
  spaceSlug: string,
): Promise<{ ok: true; scope: AuditScope } | { ok: false; status: 403 | 404; reason: string }> {
  const refused = { ok: false as const, status: 403 as const, reason: "You don't have access to this audit log." };
  if (spaceSlug === ALL_SPACE) {
    if (!isCrossTeam(viewer) || !can(viewer, "audit.view", { teamId: ALL_SPACE }).ok) return refused;
    return { ok: true, scope: { slug: ALL_SPACE, isAll: true, teamId: null, name: "All teams" } };
  }
  const team = await db.query.teams.findFirst({ where: eq(teams.slug, spaceSlug) });
  if (!team) return { ok: false, status: 404, reason: "No such team." };
  if (!can(viewer, "audit.view", { teamId: team.id }).ok) return refused;
  return { ok: true, scope: { slug: team.slug, isAll: false, teamId: team.id, name: team.name } };
}

// ── The read ─────────────────────────────────────────────────

async function readAudit(
  space: AuditScope,
  requested: AuditFilters,
  nowDate: Date,
): Promise<{ data: AuditPageData; matching: AuditRow[] }> {
  const [events, people, teamRows] = await Promise.all([
    loadEvents(space.teamId),
    getPeople(),
    db.select({ id: teams.id, slug: teams.slug, name: teams.name }).from(teams),
  ]);
  const teamsById = new Map(teamRows.map((t) => [t.id, t]));
  const universe = events.map((e) => toRow(e, people, teamsById, nowDate));

  // Pin a team space to itself, and keep only values the space knows: an unknown id in the URL
  // would otherwise show a chip that matches nothing.
  const filters = sanitize(requested, space, universe, teamRows);
  const matching = filterAuditRows(universe, filters);
  const counts = auditFacetCounts(universe, filters);
  const today = dayOf(nowDate);

  const knownPeople = new Map<string, Person>();
  const knownTemplates = new Map<string, { id: string; name: string; teamSlug: string }>();
  const knownActions = new Set<string>();
  for (const row of universe) {
    for (const key of personKeysOf(row)) {
      if (!knownPeople.has(key)) knownPeople.set(key, key === SYSTEM_PERSON ? SYSTEM_PERSON_VIEW : personOf(people, key));
    }
    if (row.template && !knownTemplates.has(row.template.id)) {
      knownTemplates.set(row.template.id, { ...row.template, teamSlug: row.team?.slug ?? "" });
    }
    knownActions.add(actionKeyOf(row));
  }

  const data: AuditPageData = {
    space: { slug: space.slug, isAll: space.isAll, name: space.name },
    rows: matching.slice(0, AUDIT_PAGE_LIMIT),
    total: matching.length,
    applied: filters,
    options: {
      teams: space.isAll
        ? teamRows
            .map((t) => ({ slug: t.slug, name: t.name, count: counts.team[t.slug] ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
      people: [...knownPeople.values()]
        .map((p) => ({ ...p, count: counts.person[p.id] ?? 0 }))
        .sort((a, b) => systemLast(a.id, b.id) || a.name.localeCompare(b.name)),
      categories: AUDIT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c], count: counts.action[c] ?? 0 })),
      actions: actionOptions()
        .filter((o) => knownActions.has(o.value) || filterValues(filters, "action").includes(o.value))
        .map((o) => ({ ...o, count: counts.action[o.value] ?? 0 })),
      templates: [...knownTemplates.values()]
        .map((t) => ({ ...t, count: counts.template[t.id] ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      datePresets: datePresets(today),
    },
    csvHref: `/${space.slug}/audit/export${auditQuery(filters)}`,
    today,
  };
  return { data, matching };
}

interface EventRow {
  id: string;
  at: Date;
  actorId: string | null;
  teamId: string | null;
  templateId: string | null;
  templateName: string | null;
  action: string;
  details: Record<string, unknown> | null;
  versionNumber: number | null;
}

/** The space's events, newest first (same-moment rows: newest written first). */
async function loadEvents(teamId: string | null): Promise<EventRow[]> {
  return db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      actorId: auditEvents.actorId,
      teamId: auditEvents.teamId,
      templateId: auditEvents.templateId,
      templateName: templates.name,
      action: auditEvents.action,
      details: auditEvents.details,
      versionNumber: versions.number,
    })
    .from(auditEvents)
    .leftJoin(versions, eq(versions.id, auditEvents.versionId))
    .leftJoin(templates, eq(templates.id, auditEvents.templateId))
    .where(teamId === null ? undefined : eq(auditEvents.teamId, teamId))
    .orderBy(desc(auditEvents.at), desc(sql`${auditEvents}.rowid`));
}

function toRow(
  e: EventRow,
  people: People,
  teamsById: ReadonlyMap<string, { slug: string; name: string }>,
  nowDate: Date,
): AuditRow {
  const actor = e.actorId ? personOf(people, e.actorId) : null;
  const subjectId = subjectIdOf(e.action, e.details);
  const team = e.teamId ? (teamsById.get(e.teamId) ?? { slug: e.teamId, name: e.teamId }) : null;
  const versionNumber = e.versionNumber ?? null;
  const category: AuditCategory = categoryOf(e.action);
  return {
    id: e.id,
    at: iso(e.at),
    actor,
    team: team ? { slug: team.slug, name: team.name } : null,
    template: e.templateId ? { id: e.templateId, name: e.templateName ?? e.templateId } : null,
    versionNumber,
    action: e.action,
    category,
    actionLabel: actionLabel(e.action, actor !== null),
    summary: describeAuditEvent({ action: e.action, details: e.details, versionNumber }, actor),
    subject: subjectId ? personOf(people, subjectId) : null,
    when: formatDateTime(e.at, nowDate),
    ago: dayAgo(e.at, nowDate),
  };
}

function sanitize(
  requested: AuditFilters,
  space: AuditScope,
  universe: readonly AuditRow[],
  teamRows: readonly { slug: string }[],
): AuditFilters {
  let f: AuditFilters = { ...requested };
  if (space.isAll) {
    const slugs = new Set(teamRows.map((t) => t.slug));
    f = withFilterValues(f, "team", filterValues(f, "team").filter((s) => slugs.has(s)));
  } else {
    delete f.team;
  }
  const people = new Set(universe.flatMap(personKeysOf));
  const templateIds = new Set(universe.flatMap((r) => (r.template ? [r.template.id] : [])));
  f = withFilterValues(f, "person", filterValues(f, "person").filter((p) => people.has(p)));
  f = withFilterValues(f, "template", filterValues(f, "template").filter((t) => templateIds.has(t)));
  return f;
}

function systemLast(a: string, b: string): number {
  return Number(a === SYSTEM_PERSON) - Number(b === SYSTEM_PERSON);
}
