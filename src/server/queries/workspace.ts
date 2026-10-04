import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import type { JSONContent, RequiredSection, Variable, VersionState } from "@/domain/types";
import { requireSpace } from "./spaces";
import { pickLatest } from "./library";

export interface WorkspaceHeaderData {
  id: string;
  name: string;
  teamSlug: string;
  teamName: string;
  status: VersionState;
  sunsetAt: Date | null;
  /** "v2" or "Draft of v3". */
  versionLabel: string;
  /** Number of the Active version, if any (the SHARE ring shows only then). */
  activeNumber: number | null;
  canEdit: boolean;
}

/** Header data for /{team}/templates/{templateId}. 404 when the template isn't visible here. */
export const getWorkspaceHeader = cache(
  async (spaceSlug: string, templateId: string): Promise<WorkspaceHeaderData> => {
    const space = await requireSpace(spaceSlug);

    const tpl = await db
      .select({
        id: templates.id,
        name: templates.name,
        teamId: templates.teamId,
        teamSlug: teams.slug,
        teamName: teams.name,
      })
      .from(templates)
      .innerJoin(teams, eq(teams.id, templates.teamId))
      .where(eq(templates.id, templateId))
      .limit(1)
      .then((r) => r[0]);

    if (!tpl) notFound();
    if (spaceSlug !== ALL_SPACE && tpl.teamSlug !== spaceSlug) notFound();
    if (!canSeeSpace(space.viewer, tpl.teamSlug)) notFound();

    const list = await db
      .select({
        number: versions.number,
        state: versions.state,
        sunsetAt: versions.sunsetAt,
      })
      .from(versions)
      .where(eq(versions.templateId, templateId));

    const latest = pickLatest(list);
    const active = list.find((v) => v.state === "active");
    const highest = list.reduce((max, v) => Math.max(max, v.number ?? 0), 0);

    const versionLabel =
      !latest || latest.state === "draft" ? `Draft of v${highest + 1}` : `v${latest.number}`;

    return {
      id: tpl.id,
      name: tpl.name,
      teamSlug: tpl.teamSlug,
      teamName: tpl.teamName,
      status: latest?.state ?? "draft",
      sunsetAt: latest?.sunsetAt ?? null,
      versionLabel,
      activeNumber: active?.number ?? null,
      canEdit: can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok,
    };
  },
);

export interface WorkspaceDocumentData {
  versionId: string;
  body: JSONContent;
  variables: Variable[];
  requiredSections: RequiredSection[];
  /** Only an open draft is editable, and only by an author on the template's team. */
  editable: boolean;
}

/** The document shown on the Content tab: the open draft if there is one, otherwise the latest version. */
export const getWorkspaceDocument = cache(
  async (spaceSlug: string, templateId: string): Promise<WorkspaceDocumentData> => {
    const header = await getWorkspaceHeader(spaceSlug, templateId);
    const space = await requireSpace(spaceSlug);

    const tpl = await db
      .select({ teamId: templates.teamId, requiredSections: contentTypes.requiredSections })
      .from(templates)
      .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
      .where(eq(templates.id, header.id))
      .limit(1)
      .then((r) => r[0]);
    if (!tpl) notFound();

    const list = await db
      .select({
        id: versions.id,
        number: versions.number,
        state: versions.state,
        sunsetAt: versions.sunsetAt,
        body: versions.body,
        variables: versions.variables,
      })
      .from(versions)
      .where(eq(versions.templateId, header.id));

    const shown = pickLatest(list);
    if (!shown) notFound();

    return {
      versionId: shown.id,
      body: shown.body,
      variables: shown.variables,
      requiredSections: tpl.requiredSections,
      editable: shown.state === "draft" && can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok,
    };
  },
);
