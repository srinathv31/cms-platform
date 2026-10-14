import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { AuditFilters, AuditRow } from "@/domain/access-types";
import type { AuditPageData } from "@/server/queries/access-models";
import {
  SYSTEM_ACTOR,
  SYSTEM_INITIALS,
  eventVersionLabel,
} from "@/domain/activity";
import {
  AUDIT_CATEGORIES,
  CATEGORY_LABEL,
  SYSTEM_PERSON,
  actionLabel,
  actionOptions,
  auditQuery,
  categoryOf,
  datePresets,
  describeAuditEvent,
  filterValues,
  subjectIdOf,
  toCsv,
  withFilterValues,
  type AuditSearch,
} from "@/domain/audit";
import { formatAgo, formatDateTime, utcDay } from "@/domain/dates";
import type { Person } from "@/domain/review-types";
import type { NumberedRound } from "@/domain/rounds";
import {
  requireRequestContext,
  type RequestContext,
} from "@/server/context/request";
import { services } from "@/server/services";
import type {
  AuditEventFacts,
  AuditExportFacts,
  AuditPageFacts,
  AuditTeamFacts,
} from "@/server/services/audit";
import type { ReadRefusal } from "@/server/services/results";
import { peopleById, personOf, type People } from "@/domain/people";
import { getShellFacts, requireSpace } from "./spaces";

// The Audit page (/{team}/audit) and its CSV export (/{team}/audit/export). The facts and the decisions come
// from the audit service (`services().audit`, decision 0070): the events, the search narrowed to what the
// space knows, and the counts and options the menus list under every other filter. The URL names a team by its
// slug, so this resolves the `?team=` slugs to ids on the way in and back to slugs on the way out (decision
// 0053); it words everything (a sentence for each event, its labels, "3 days ago", the menus' names, the CSV's
// cells) and decides nothing. Everything is read-only.

const SYSTEM_PERSON_VIEW: Person = {
  id: SYSTEM_PERSON,
  name: SYSTEM_ACTOR,
  initials: SYSTEM_INITIALS,
  hue: 0,
};

const FILTER_KEYS = [
  "team",
  "person",
  "action",
  "template",
  "from",
  "to",
] as const satisfies readonly (keyof AuditFilters)[];

/**
 * The Audit page's read model. Not found without `audit.view` in the space (a hidden page, not a refusal).
 * Read once per request: the header's Export count and the table each pass their own filters object,
 * and React's `cache` keys an object by identity, so the read is cached on a string key instead.
 */
export function getAuditPage(
  spaceSlug: string,
  filters: AuditFilters,
): Promise<AuditPageData> {
  return auditPageFor(
    spaceSlug,
    JSON.stringify(FILTER_KEYS.map((key) => filters[key] ?? null)),
  );
}

const auditPageFor = cache(
  async (spaceSlug: string, filtersKey: string): Promise<AuditPageData> => {
    const values = JSON.parse(filtersKey) as (string | null)[];
    const filters: AuditFilters = {};
    FILTER_KEYS.forEach((key, i) => {
      if (values[i] !== null) filters[key] = values[i]!;
    });
    const space = await requireSpace(spaceSlug);
    const ctx = await requireRequestContext();
    const shell = await getShellFacts();
    const facts = await services().audit.page(ctx, {
      teamId: space.teamId,
      search: auditSearch(filters, shell.spaces),
    });
    if (!facts.ok) notFound();
    return auditPageData(facts, {
      slug: space.slug,
      isAll: space.isAll,
      name: space.name,
    });
  },
);

export type AuditExport =
  { ok: true; filename: string; csv: string; count: number } | ReadRefusal;

/**
 * The CSV of every event the filters match (no page limit), for the export route. A route answers with a
 * refusal and its status instead of redirecting: a team that isn't there, or isn't the viewer's to enter, is
 * 404 `space_unavailable`; no `audit.view` there is 403 `generic`.
 */
export async function getAuditExport(
  ctx: RequestContext,
  spaceSlug: string,
  filters: AuditFilters,
): Promise<AuditExport> {
  const space = await services().identity.space(ctx, { slug: spaceSlug });
  if (!space.ok) return space;
  const shell = await services().identity.shell(ctx);
  if (!shell.ok) return shell;
  const facts = await services().audit.exportRows(ctx, {
    teamId: space.space.teamId,
    search: auditSearch(filters, shell.spaces),
  });
  if (!facts.ok) return facts;
  return auditExport(facts, space.space.slug);
}

/** The export's file from the service's facts. */
export function auditExport(facts: AuditExportFacts, spaceSlug: string) {
  const rows = auditRows(facts.events, facts);
  return {
    ok: true as const,
    filename: `stencil-audit-${spaceSlug}-${utcDay(facts.asOf)}.csv`,
    csv: toCsv(rows),
    count: rows.length,
  };
}

// ── Filters: the URL's slugs, the service's ids ───────────────

/** The URL's filters as the service takes them: the `?team=` slugs become team ids (a slug no team has is dropped). */
export function auditSearch(
  filters: AuditFilters,
  spaces: readonly { teamId: string | null; slug: string }[],
): AuditSearch {
  const idOf = new Map(
    spaces.flatMap((s): [string, string][] =>
      s.teamId === null ? [] : [[s.slug, s.teamId]],
    ),
  );
  return {
    teamIds: filterValues(filters, "team").flatMap(
      (slug) => idOf.get(slug) ?? [],
    ),
    personIds: filterValues(filters, "person"),
    actions: filterValues(filters, "action"),
    templateIds: filterValues(filters, "template"),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
}

/** The search the service applied, as the URL's filters: team ids back to slugs. */
function auditFilters(
  applied: AuditSearch,
  slugOf: ReadonlyMap<string, string>,
): AuditFilters {
  let filters: AuditFilters = {};
  filters = withFilterValues(
    filters,
    "team",
    applied.teamIds.flatMap((id) => slugOf.get(id) ?? []),
  );
  filters = withFilterValues(filters, "person", applied.personIds);
  filters = withFilterValues(filters, "action", applied.actions);
  filters = withFilterValues(filters, "template", applied.templateIds);
  if (applied.from) filters.from = applied.from;
  if (applied.to) filters.to = applied.to;
  return filters;
}

// ── The page and its rows ─────────────────────────────────────

/** The Audit page from the service's facts. */
export function auditPageData(
  facts: AuditPageFacts,
  space: AuditPageData["space"],
): AuditPageData {
  const people = peopleById(facts.people);
  const teamsById = new Map(facts.teams.map((t) => [t.id, t]));
  const slugOf = new Map(facts.teams.map((t) => [t.id, t.slug]));
  const applied = auditFilters(facts.applied, slugOf);
  const countOf = new Map(
    facts.options.actions.map((a) => [a.action, a.count]),
  );
  const today = utcDay(facts.asOf);
  const systemLast = (a: string, b: string) =>
    Number(a === SYSTEM_PERSON) - Number(b === SYSTEM_PERSON);

  return {
    space,
    rows: auditRows(facts.events, facts),
    total: facts.total,
    applied,
    options: {
      teams: facts.options.teams
        .flatMap((o) => {
          const team = teamsById.get(o.id);
          return team
            ? [{ slug: team.slug, name: team.name, count: o.count }]
            : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      people: facts.options.people
        .map((o) => ({
          ...(o.id === SYSTEM_PERSON
            ? SYSTEM_PERSON_VIEW
            : personOf(people, o.id)),
          count: o.count,
        }))
        .sort((a, b) => systemLast(a.id, b.id) || a.name.localeCompare(b.name)),
      categories: AUDIT_CATEGORIES.map((c) => ({
        value: c,
        label: CATEGORY_LABEL[c],
        count:
          facts.options.categories.find((o) => o.category === c)?.count ?? 0,
      })),
      actions: actionOptions()
        .filter((o) => countOf.has(o.value))
        .map((o) => ({ ...o, count: countOf.get(o.value) ?? 0 })),
      templates: facts.options.templates
        .map((t) => ({
          id: t.id,
          name: t.name,
          teamSlug: (t.teamId && slugOf.get(t.teamId)) || "",
          count: t.count,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      datePresets: datePresets(today),
    },
    csvHref: `/${space.slug}/audit/export${auditQuery(applied)}`,
    today,
  };
}

/** The events as rows, worded: a sentence for each, its labels, and its times counted from the read's `asOf`. */
function auditRows(
  events: readonly AuditEventFacts[],
  facts: {
    asOf: string;
    teams: readonly AuditTeamFacts[];
    people: readonly Person[];
  },
): AuditRow[] {
  const people = peopleById(facts.people);
  const teamsById = new Map(facts.teams.map((t) => [t.id, t]));
  return events.map((e) => toRow(e, people, teamsById, facts.asOf));
}

function toRow(
  e: AuditEventFacts,
  people: People,
  teamsById: ReadonlyMap<string, AuditTeamFacts>,
  asOf: string,
): AuditRow {
  const actor = e.actorId ? personOf(people, e.actorId) : null;
  const subjectId = subjectIdOf(e.action, e.details);
  // A team id names a team row (teams are never deleted); the row's slug and name, never the id, show.
  const team = e.teamId ? (teamsById.get(e.teamId) ?? null) : null;
  const version: NumberedRound | null = e.version;
  return {
    id: e.id,
    at: e.at,
    actor,
    team: team ? { slug: team.slug, name: team.name } : null,
    template: e.templateId
      ? { id: e.templateId, name: e.templateName ?? e.templateId }
      : null,
    // The cell names the version as the event does: the round for a review event (`eventVersionLabel`).
    versionLabel: eventVersionLabel(e.action, version),
    action: e.action,
    category: categoryOf(e.action),
    actionLabel: actionLabel(e.action, actor !== null),
    summary: describeAuditEvent(
      { action: e.action, details: e.details, version },
      actor,
    ),
    subject: subjectId ? personOf(people, subjectId) : null,
    when: formatDateTime(e.at, asOf),
    ago: formatAgo(e.at, asOf, { capitalize: true }),
  };
}
