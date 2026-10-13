import "server-only";
import { eq } from "drizzle-orm";
import { can } from "@/domain/permissions";
import type { Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import { teams, templates } from "@/server/db/schema/ucomp";

// The template a read names, on this app's own database, and whether the viewer may see it: the first step of
// every read about one template (its workspace, threads, activity, Compare, the review screen).

/** A template with its team. */
export interface TemplateRow {
  id: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  contentTypeId: string;
}

/** The template, whether or not the viewer may see it; undefined when it doesn't exist. */
export async function findTemplate(
  templateId: string,
): Promise<TemplateRow | undefined> {
  const [row] = await db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      teamSlug: teams.slug,
      teamName: teams.name,
      contentTypeId: templates.contentTypeId,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(templates.id, templateId))
    .limit(1);
  return row;
}

/**
 * The template, when it exists and the viewer may see its team (`template.view`); null otherwise. A read
 * answers the two the same (decision 0052).
 */
export async function visibleTemplate(
  viewer: Viewer,
  templateId: string,
): Promise<TemplateRow | null> {
  const template = await findTemplate(templateId);
  return template &&
    can(viewer, "template.view", { teamId: template.teamId }).ok
    ? template
    : null;
}
