import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import type { Channel, JSONContent, RequiredSection, SampleSet, Variable, VersionState } from "@/domain/types";
import { now } from "@/server/clock";
import { requireSpace } from "./spaces";
import { pickLatest } from "./library";
import { loadThreads } from "./threads";
import type { ThreadView } from "@/domain/review-types";

export interface WorkspaceHeaderData {
  id: string;
  name: string;
  teamSlug: string;
  teamName: string;
  status: VersionState;
  sunsetAt: Date | null;
  /**
   * What sits beside the status badge. The badge already says the state, so the label never
   * repeats it: "v2" on a version with a number, "Based on v2" on a draft of an earlier version,
   * and null on a brand-new draft that has no earlier version.
   */
  versionLabel: string | null;
  /** The number of the version an open draft was started from; null when it isn't based on one. */
  basedOnNumber: number | null;
  /** Number of the Active version, if any (the SHARE ring shows only then). */
  activeNumber: number | null;
  /** The number the shown version has, or will get at submit when it's a draft. */
  versionNumber: number;
  /** The viewer may edit this team's drafts (false = "View only"). */
  canEdit: boolean;
  /** The shown version is an open draft and the viewer can edit it (the name is a field, autosave runs). */
  editable: boolean;
  /** "Edit" is offered: the latest version is Active, there's no open draft, and the viewer can edit. */
  canStartDraft: boolean;
  /** "Submit for review" is offered: the shown version is an open draft and the viewer may submit it. */
  canSubmit: boolean;
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
        id: versions.id,
        number: versions.number,
        state: versions.state,
        sunsetAt: versions.sunsetAt,
        basedOnVersionId: versions.basedOnVersionId,
      })
      .from(versions)
      .where(eq(versions.templateId, templateId));

    const latest = pickLatest(list);
    const active = list.find((v) => v.state === "active");
    const highest = list.reduce((max, v) => Math.max(max, v.number ?? 0), 0);

    const isDraft = !latest || latest.state === "draft";
    const versionNumber = isDraft ? highest + 1 : (latest.number ?? highest);
    const basedOn = isDraft && latest?.basedOnVersionId ? list.find((v) => v.id === latest.basedOnVersionId) : undefined;
    const basedOnNumber = basedOn?.number ?? null;
    const versionLabel = isDraft ? (basedOnNumber !== null ? `Based on v${basedOnNumber}` : null) : `v${versionNumber}`;
    const canEdit = can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok;

    return {
      id: tpl.id,
      name: tpl.name,
      teamSlug: tpl.teamSlug,
      teamName: tpl.teamName,
      status: latest?.state ?? "draft",
      sunsetAt: latest?.sunsetAt ?? null,
      versionLabel,
      basedOnNumber,
      activeNumber: active?.number ?? null,
      versionNumber,
      canEdit,
      editable: canEdit && latest?.state === "draft",
      canStartDraft: canEdit && latest?.state === "active",
      canSubmit: latest?.state === "draft" && can(space.viewer, "version.submit", { teamId: tpl.teamId }).ok,
    };
  },
);

export interface WorkspaceDocumentData {
  /** The template's id (the render route is addressed by it). */
  templateId: string;
  /** The team the template belongs to; the email preview's sender line is made from it. */
  teamName: string;
  versionId: string;
  /** The shown version's number, or null for an open draft (the preview asks the route for "draft"). */
  versionNumber: number | null;
  /** Autosave ordering: the rev the client starts from. */
  rev: number;
  body: JSONContent;
  variables: Variable[];
  /** The Active version's variables when the shown version is a draft of a live template (contract flags). */
  baseline: Variable[] | null;
  channels: Channel[];
  /** The channels the content type allows: what the Channels selector offers. */
  allowedChannels: Channel[];
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  /** The version's named sample data sets, as saved. The preview's switcher fills in any default that is missing. */
  sampleSets: SampleSet[];
  /** The demo clock's date, YYYY-MM-DD: date samples are generated from it. */
  today: string;
  requiredSections: RequiredSection[];
  /** Only an open draft is editable, and only by an author on the template's team. */
  editable: boolean;
  /** The template's review threads, anchored against the shown version's blocks (the editor margin). */
  threads: ThreadView[];
}

/** The document shown on the Content tab: the open draft if there is one, otherwise the latest version. */
export const getWorkspaceDocument = cache(
  async (spaceSlug: string, templateId: string): Promise<WorkspaceDocumentData> => {
    const header = await getWorkspaceHeader(spaceSlug, templateId);
    const space = await requireSpace(spaceSlug);

    const tpl = await db
      .select({
        teamId: templates.teamId,
        requiredSections: contentTypes.requiredSections,
        allowedChannels: contentTypes.allowedChannels,
      })
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
        rev: versions.rev,
        body: versions.body,
        variables: versions.variables,
        channels: versions.channels,
        emailSubject: versions.emailSubject,
        emailPreheader: versions.emailPreheader,
        sampleSets: versions.sampleSets,
      })
      .from(versions)
      .where(eq(versions.templateId, header.id));

    const shown = pickLatest(list);
    if (!shown) notFound();
    const active = list.find((v) => v.state === "active");
    const today = (await now()).toISOString().slice(0, 10);
    const threads = await loadThreads(header.id, shown.body);

    return {
      templateId: header.id,
      teamName: header.teamName,
      versionId: shown.id,
      versionNumber: shown.state === "draft" ? null : shown.number,
      rev: shown.rev,
      body: shown.body,
      variables: shown.variables,
      baseline: shown.state === "draft" && active ? active.variables : null,
      channels: shown.channels,
      allowedChannels: tpl.allowedChannels,
      emailSubject: shown.emailSubject,
      emailPreheader: shown.emailPreheader,
      sampleSets: shown.sampleSets,
      today,
      requiredSections: tpl.requiredSections,
      editable: shown.state === "draft" && can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok,
      threads,
    };
  },
);
