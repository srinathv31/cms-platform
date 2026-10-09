import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { PaletteResults, PaletteTemplateRow } from "@/domain/import-types";
import { normalizePaletteQuery, PALETTE_QUERY_MAX, paletteTemplates } from "@/domain/palette";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { VersionState, Viewer } from "@/domain/types";
import { refusal, type ReadResult } from "@/server/api/reads";
import { db } from "@/server/db/client";
import { auditEvents, teams, templates, versions } from "@/server/db/schema/ucomp";
import { pickLatest } from "./library";
import { currentName } from "./template-name";

// The ⌘K palette's search, served by GET /api/palette/[space]?q=&template= when the palette opens and
// as the viewer types. The templates are searched here, not in the browser: no page carries the
// catalog. A read, so it checks only that the viewer can see the space, writes nothing, and answers
// a `ReadResult` (src/server/api/reads.ts).

const Input = z.object({
  space: z.string().min(1).max(64),
  q: z.string().max(PALETTE_QUERY_MAX).nullable(),
  template: z.string().min(1).max(64).nullable(),
});

/** How many of the viewer's newest audit rows to read to find five distinct templates. */
const RECENT_SCAN = 200;

/**
 * What the palette lists for one space and one search (`q`), for this viewer. `template` is the
 * template whose pages they are on: Recent leaves it out, and `current` says whether it is theirs to
 * see here (the palette offers its tabs only then).
 */
export async function searchPalette(
  viewer: Viewer,
  input: { space: string; q: string | null; template: string | null },
): Promise<ReadResult<PaletteResults>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.invalidSearch);
  const { space, template: currentId } = parsed.data;
  if (!canSeeSpace(viewer, space)) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);

  const query = normalizePaletteQuery(parsed.data.q ?? "");
  const [rows, recentIds] = await Promise.all([spaceTemplates(viewer, space), recentTemplateIds(viewer)]);
  const { recent, templates: listed } = paletteTemplates({ templates: rows, query, recentIds, currentId });

  return {
    ok: true,
    viewerId: viewer.userId,
    space,
    query,
    // Creating needs a team, so the cross-team space never offers it (as the Library doesn't).
    canCreate: space !== ALL_SPACE && can(viewer, "template.create", { teamId: space }).ok,
    current: currentId !== null && rows.some((r) => r.id === currentId),
    recent,
    templates: listed,
  };
}

/** The templates the viewer can see in the space ("all": every team), in name order, with the Library's name and status. */
async function spaceTemplates(viewer: Viewer, space: string): Promise<PaletteTemplateRow[]> {
  const name = currentName(templates.id);
  const rows = await db
    .select({ id: templates.id, name, teamSlug: teams.slug, teamName: teams.name })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(space === ALL_SPACE ? undefined : eq(teams.slug, space))
    .orderBy(name);
  const visible = rows.filter((r) => canSeeSpace(viewer, r.teamSlug));
  if (visible.length === 0) return [];

  // Light columns only: never load `body` for a list.
  const versionRows = await db
    .select({ templateId: versions.templateId, number: versions.number, state: versions.state })
    .from(versions)
    .where(
      inArray(
        versions.templateId,
        visible.map((r) => r.id),
      ),
    );
  const byTemplate = new Map<string, { number: number | null; state: VersionState }[]>();
  for (const v of versionRows) {
    const list = byTemplate.get(v.templateId);
    if (list) list.push(v);
    else byTemplate.set(v.templateId, [v]);
  }
  return visible.map((r) => ({
    ...r,
    status: pickLatest(byTemplate.get(r.id) ?? [])?.state ?? ("draft" as VersionState),
  }));
}

/** Templates the viewer acted on (their audit events), newest first, each once. */
async function recentTemplateIds(viewer: Viewer): Promise<string[]> {
  const events = await db
    .select({ templateId: auditEvents.templateId })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorId, viewer.userId), isNotNull(auditEvents.templateId)))
    .orderBy(desc(auditEvents.at))
    .limit(RECENT_SCAN);
  return [...new Set(events.map((e) => e.templateId).filter((id): id is string => id !== null))];
}
