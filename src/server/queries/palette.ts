import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { teams, templates } from "@/server/db/schema/ucomp";
import { canSeeSpace } from "@/domain/permissions";
import { getViewer } from "@/server/viewer";

export interface PaletteTemplate {
  id: string;
  name: string;
  teamSlug: string;
  teamName: string;
}

/** Templates the viewer can see across all their spaces; the palette narrows to the current space. */
export const getPaletteTemplates = cache(async (): Promise<PaletteTemplate[]> => {
  const viewer = await getViewer();
  const rows = await db
    .select({
      id: templates.id,
      name: templates.name,
      teamSlug: teams.slug,
      teamName: teams.name,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .orderBy(templates.name);
  return rows.filter((r) => canSeeSpace(viewer, r.teamSlug));
});
