import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  AUDIT_CATEGORIES,
  AUDIT_PAGE_LIMIT,
  actionKeyOf,
  auditSearchCounts,
  filterAuditEvents,
  personKeysOf,
  sanitizeAuditSearch,
  SYSTEM_PERSON,
  type AuditSearch,
} from "@/domain/audit";
import { can, isCrossTeam, REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Person } from "@/domain/review-types";
import { db } from "@/server/db/client";
import {
  auditEvents,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import type { AuditEventFacts, AuditService, AuditTeamFacts } from "../audit";
import { refusal, type ReadResult } from "../results";
import type { RequestContext } from "../types";
import type { LocalDeps } from "./command";
import { currentName } from "./template-name";

// The audit log on this app's own database (src/server/services/audit.ts says what each read promises): a
// space's events, read once and filtered in memory, because the menus need counts under every OTHER filter and
// an audit log of a prototype's size (hundreds to a few thousand rows) is cheap to scan. The filters, the
// counts and what a space knows are the domain's (src/domain/audit.ts); this reads and arranges.
//
// Scope: a team space shows that team's events to whoever holds `audit.view` there (its Team Admins, the
// Auditor, the Platform Admin). All teams (`teamId` null: the Auditor, the Platform Admin) shows every event,
// platform-wide ones (team null) included, with a Team filter.

/** The teams whose events a read covers, or why the viewer may not read them. */
async function scopeOf(
  ctx: RequestContext,
  teamId: string | null,
): Promise<ReadResult<{ teams: AuditTeamFacts[] }>> {
  const { viewer } = ctx;
  if (teamId === null) {
    if (!isCrossTeam(viewer) || !can(viewer, "audit.view", { teamId: null }).ok)
      return refusal(403, REASONS.generic);
    return {
      ok: true,
      teams: await db
        .select({ id: teams.id, slug: teams.slug, name: teams.name })
        .from(teams)
        .orderBy(teams.name, teams.id),
    };
  }
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
  if (!can(viewer, "audit.view", { teamId: team.id }).ok)
    return refusal(403, REASONS.generic);
  return {
    ok: true,
    teams: [{ id: team.id, slug: team.slug, name: team.name }],
  };
}

/**
 * The space's events, newest first (same-moment rows: newest written first). An event about a version
 * names the template as that version had it, so the record (and its export) keeps the name the event
 * happened under; an event about the template alone (its creation) names it as the Library does now
 * (`currentName`).
 */
async function loadEvents(teamId: string | null): Promise<AuditEventFacts[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      actorId: auditEvents.actorId,
      teamId: auditEvents.teamId,
      templateId: auditEvents.templateId,
      templateName: sql<
        string | null
      >`coalesce(${versions.name}, ${currentName(templates.id)})`,
      templateCurrentName: currentName(templates.id),
      action: auditEvents.action,
      details: auditEvents.details,
      versionNumber: versions.number,
      versionRound: versions.round,
      versionState: versions.state,
    })
    .from(auditEvents)
    .leftJoin(versions, eq(versions.id, auditEvents.versionId))
    .leftJoin(templates, eq(templates.id, auditEvents.templateId))
    .where(teamId === null ? undefined : eq(auditEvents.teamId, teamId))
    .orderBy(desc(auditEvents.at), desc(sql`${auditEvents}.rowid`));
  return rows.map((e): AuditEventFacts => ({
    id: e.id,
    at: e.at.toISOString(),
    actorId: e.actorId,
    teamId: e.teamId,
    templateId: e.templateId,
    templateName: e.templateName,
    templateCurrentName: e.templateCurrentName,
    action: e.action,
    details: e.details,
    version:
      e.versionNumber !== null &&
      e.versionRound !== null &&
      e.versionState !== null
        ? {
            number: e.versionNumber,
            round: e.versionRound,
            state: e.versionState,
          }
        : null,
  }));
}

/** The users with these ids (those still there), by id. */
async function loadPeople(ids: Iterable<string>): Promise<Person[]> {
  const wanted = [...new Set(ids)].filter((id) => id !== SYSTEM_PERSON);
  if (wanted.length === 0) return [];
  return db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      hue: users.avatarHue,
    })
    .from(users)
    .where(inArray(users.id, wanted))
    .orderBy(users.id);
}

export function localAuditReads(
  deps: LocalDeps,
): Pick<AuditService, "page" | "exportRows"> {
  /** The space's events and the search narrowed to what the space knows. */
  async function readSpace(
    ctx: RequestContext,
    teamId: string | null,
    requested: AuditSearch,
  ) {
    const scope = await scopeOf(ctx, teamId);
    if (!scope.ok) return scope;
    const asOf = (await deps.clock()).toISOString();
    const universe = await loadEvents(teamId);
    const applied = sanitizeAuditSearch(
      requested,
      { isAll: teamId === null, teamIds: scope.teams.map((t) => t.id) },
      universe,
    );
    return {
      ok: true as const,
      asOf,
      teams: scope.teams,
      universe,
      applied,
      matching: filterAuditEvents(universe, applied),
    };
  }

  return {
    async page(ctx, { teamId, search }) {
      const space = await readSpace(ctx, teamId, search);
      if (!space.ok) return space;
      const { asOf, teams: spaceTeams, universe, applied, matching } = space;
      const counts = auditSearchCounts(universe, applied);

      // What the menus list: whatever the space's events name, once.
      const personIds = new Set<string>();
      const actions = new Set<string>(applied.actions);
      const templateOptions = new Map<
        string,
        { id: string; name: string; teamId: string | null }
      >();
      for (const e of universe) {
        for (const key of personKeysOf(e)) personIds.add(key);
        actions.add(actionKeyOf(e));
        if (e.templateId && !templateOptions.has(e.templateId))
          templateOptions.set(e.templateId, {
            id: e.templateId,
            name: e.templateCurrentName ?? e.templateName ?? e.templateId,
            teamId: e.teamId,
          });
      }
      const events = matching.slice(0, AUDIT_PAGE_LIMIT);
      const people = await loadPeople([
        ...personIds,
        ...events.flatMap(personKeysOf),
      ]);

      return {
        ok: true,
        asOf,
        teams: spaceTeams,
        applied,
        total: matching.length,
        events,
        options: {
          teams:
            teamId === null
              ? spaceTeams.map((t) => ({
                  id: t.id,
                  count: counts.team[t.id] ?? 0,
                }))
              : [],
          people: [...personIds].map((id) => ({
            id,
            count: counts.person[id] ?? 0,
          })),
          categories: AUDIT_CATEGORIES.map((category) => ({
            category,
            count: counts.action[category] ?? 0,
          })),
          actions: [...actions].map((action) => ({
            action,
            count: counts.action[action] ?? 0,
          })),
          templates: [...templateOptions.values()].map((t) => ({
            ...t,
            count: counts.template[t.id] ?? 0,
          })),
        },
        people,
      };
    },

    async exportRows(ctx, { teamId, search }) {
      const space = await readSpace(ctx, teamId, search);
      if (!space.ok) return space;
      const { asOf, teams: spaceTeams, matching } = space;
      return {
        ok: true,
        asOf,
        teams: spaceTeams,
        events: matching,
        people: await loadPeople(matching.flatMap(personKeysOf)),
      };
    },
  };
}
