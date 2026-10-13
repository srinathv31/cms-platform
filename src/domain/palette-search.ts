// The ⌘K palette's search as the backend answers it (the templates service's `palette`, src/server/services/
// templates.ts): who may see which templates in a space, the viewer's recent ones, and what the search lists.
// The local implementation and the fake decide with `paletteSearch`; the ranking itself is `paletteTemplates`
// in palette.ts, which client components share and which therefore imports no permission rules.

import { compareCodePoints } from "./golive/cursor";
import type { PaletteTemplateRow } from "./import-types";
import { normalizePaletteQuery, paletteTemplates } from "./palette";
import { can, canSeeSpace } from "./permissions";
import { latestVersion } from "./rounds";
import type { RoundRow } from "./rounds";
import type { PermissionResult, Viewer } from "./types";

/** How many of the viewer's newest audit rows the backend reads to find five distinct templates. */
export const PALETTE_RECENT_SCAN = 200;

/**
 * The templates a viewer acted on, newest first, each once: from their audit rows, newest first (rows at one
 * instant: the later write first, decision 0063).
 */
export function recentTemplateIds(
  events: readonly { templateId: string | null }[],
): string[] {
  return [
    ...new Set(
      events.map((e) => e.templateId).filter((id): id is string => id !== null),
    ),
  ];
}

/** A template the palette may list, and the team it belongs to (for who may see it). */
export interface PaletteTemplate {
  id: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
}

/** The light columns of a version: its name and state decide how the palette shows the template. */
export interface PaletteVersion extends RoundRow {
  templateId: string;
  name: string;
}

/** What the palette lists for one space and one search, as facts. */
export interface PaletteFacts {
  /** The search this answers, normalized (`normalizePaletteQuery`); "" at rest. */
  query: string;
  can: {
    /** New template, from the palette. Never in the cross-team space, as in the Library. */
    create: PermissionResult;
  };
  /** The template asked about is one the viewer may see in this space. */
  current: boolean;
  /** At rest: up to five templates the viewer acted on most recently, without the current one. Empty while searching. */
  recent: PaletteTemplateRow[];
  /** At rest: the first page by name, without those in `recent`. Searching: the matches, best first. */
  templates: PaletteTemplateRow[];
}

/**
 * The palette's answer for a viewer in a space (a team by id; null, every team), or null when they may not
 * enter it. `templates` are candidates of any team; the space's own that the viewer may see are listed, each by
 * its latest version's name and state (`latestVersion`, as the Library shows it), in name order then id by code
 * point (decision 0059's order) before `paletteTemplates` ranks them, so what ties keeps a stable order.
 * `recentIds` are the viewer's templates, newest first (`recentTemplateIds`).
 */
export function paletteSearch(input: {
  viewer: Viewer;
  teamId: string | null;
  templates: readonly PaletteTemplate[];
  versions: readonly PaletteVersion[];
  recentIds: readonly string[];
  q: string | null;
  currentId: string | null;
}): PaletteFacts | null {
  const { viewer, teamId, currentId } = input;
  if (!canSeeSpace(viewer, teamId)) return null;
  const query = normalizePaletteQuery(input.q ?? "");

  const byTemplate = new Map<string, PaletteVersion[]>();
  for (const v of input.versions) {
    const list = byTemplate.get(v.templateId);
    if (list) list.push(v);
    else byTemplate.set(v.templateId, [v]);
  }
  const visible = input.templates
    .filter(
      (t) =>
        (teamId === null || t.teamId === teamId) &&
        canSeeSpace(viewer, t.teamId),
    )
    .map((t): PaletteTemplateRow => {
      const latest = latestVersion(byTemplate.get(t.id) ?? []);
      return {
        id: t.id,
        name: latest?.name ?? t.id,
        teamSlug: t.teamSlug,
        teamName: t.teamName,
        status: latest?.state ?? "draft",
      };
    })
    .sort(
      (a, b) =>
        compareCodePoints(a.name, b.name) || compareCodePoints(a.id, b.id),
    );

  const { recent, templates } = paletteTemplates({
    templates: visible,
    query,
    recentIds: input.recentIds,
    currentId,
  });
  return {
    query,
    can: { create: can(viewer, "template.create", { teamId }) },
    current: currentId !== null && visible.some((r) => r.id === currentId),
    recent,
    templates,
  };
}
