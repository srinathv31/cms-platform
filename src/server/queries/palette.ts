import "server-only";
import { cache } from "react";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditEvents, teams, templates, versions } from "@/server/db/schema/ucomp";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import type { PaletteContext } from "@/domain/import-types";
import type { VersionState } from "@/domain/types";
import { getViewer } from "@/server/viewer";
import { pickLatest } from "./library";
import { currentName } from "./template-name";

export interface PaletteTemplate {
  id: string;
  /** As the Library shows it: the open draft's name, otherwise the newest version's. */
  name: string;
  teamSlug: string;
  teamName: string;
  /** State of the template's latest version (a draft counts as latest), as the Library shows it. */
  status: VersionState;
}

/** Templates the viewer can see across all their spaces; the palette narrows to the current space. */
export const getPaletteTemplates = cache(async (): Promise<PaletteTemplate[]> => {
  const viewer = await getViewer();
  const name = currentName(templates.id);
  const rows = await db
    .select({
      id: templates.id,
      name,
      teamSlug: teams.slug,
      teamName: teams.name,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
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
});

const RECENT_LIMIT = 5;
/** How many of the viewer's newest audit rows to read to find five distinct templates. */
const RECENT_SCAN = 200;

/**
 * What the palette needs beyond the shell's data, for one space. Null when the viewer can't see the
 * space. Permission-scoped: `recent` holds only templates the viewer can see, in that space.
 */
export async function getPaletteContext(spaceSlug: string): Promise<PaletteContext | null> {
  const viewer = await getViewer();
  if (!canSeeSpace(viewer, spaceSlug)) return null;
  const isAll = spaceSlug === ALL_SPACE;

  const events = await db
    .select({ templateId: auditEvents.templateId })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorId, viewer.userId), isNotNull(auditEvents.templateId)))
    .orderBy(desc(auditEvents.at))
    .limit(RECENT_SCAN);
  const ids = [...new Set(events.map((e) => e.templateId).filter((id): id is string => id !== null))];

  let recent: string[] = [];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: templates.id, teamSlug: teams.slug })
      .from(templates)
      .innerJoin(teams, eq(teams.id, templates.teamId))
      .where(inArray(templates.id, ids));
    const visible = new Set(
      rows.filter((r) => (isAll || r.teamSlug === spaceSlug) && canSeeSpace(viewer, r.teamSlug)).map((r) => r.id),
    );
    recent = ids.filter((id) => visible.has(id)).slice(0, RECENT_LIMIT);
  }

  // The space's templates, read now: the shell's list is from when the page loaded.
  const spaceTemplates = (await getPaletteTemplates()).filter((t) => isAll || t.teamSlug === spaceSlug);

  return {
    space: spaceSlug,
    templates: spaceTemplates,
    // Creating needs a team, so the cross-team space never offers it (as the Library doesn't).
    canCreate: !isAll && can(viewer, "template.create", { teamId: spaceSlug }).ok,
    recent,
  };
}
