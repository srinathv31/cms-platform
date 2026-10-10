import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentTypes, teams, templates, versions } from "@/server/db/schema/ucomp";
import { sunsetDay } from "@/domain/business-zone";
import type { ChannelFields } from "@/domain/channel-fields";
import { contractBaseline, planDraftStart, smsFooterOf } from "@/domain/lifecycle";
import { canComment } from "@/domain/comments";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import type { MessageTypeRules, TeamSenders } from "@/domain/platform-config";
import {
  contentTypeFamily,
  type Channel,
  type ChannelFamily,
  type JSONContent,
  type PermissionResult,
  type RequiredSection,
  type SampleSet,
  type Variable,
  type VersionState,
} from "@/domain/types";
import { getBusinessZone } from "@/server/business-zone";
import { now } from "@/server/clock";
import { requireSpace } from "./spaces";
import { pickLatest } from "./library";
import { anchorIdsOf } from "./review-shared";
import { loadThreads } from "./threads";
import type { ThreadView } from "@/domain/review-types";
import type { ImportOriginalRef } from "@/domain/import-types";
import { getImportOriginalRef } from "./import";

export interface WorkspaceHeaderData {
  id: string;
  /** The shown version's name: the open draft's (the field the author renames), otherwise the newest version's. */
  name: string;
  /** The Active version's name, if any: what consumers see, so the SHARE ring's details carry it. */
  activeName: string | null;
  teamSlug: string;
  teamName: string;
  status: VersionState;
  /** YYYY-MM-DD: the latest version's sunset day in the business time zone, for the badge. */
  sunsetDay: string | null;
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
  /**
   * The draft autosave saves to, when `editable`: its id, and its `rev` where autosave starts. The
   * header binds the workspace session to it, so the name saves on every tab. Null otherwise.
   */
  draft: { versionId: string; rev: number } | null;
  /**
   * "Edit" is offered: there's no open draft, the latest version is Active or Revoked (`planDraftStart`),
   * and the viewer can edit.
   */
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
        name: versions.name,
        sunsetAt: versions.sunsetAt,
        basedOnVersionId: versions.basedOnVersionId,
        rev: versions.rev,
      })
      .from(versions)
      .where(eq(versions.templateId, templateId));

    const latest = pickLatest(list);
    const active = list.find((v) => v.state === "active");
    const highest = list.reduce((max, v) => Math.max(max, v.number ?? 0), 0);
    const zone = await getBusinessZone();

    const isDraft = !latest || latest.state === "draft";
    const versionNumber = isDraft ? highest + 1 : (latest.number ?? highest);
    const basedOn = isDraft && latest?.basedOnVersionId ? list.find((v) => v.id === latest.basedOnVersionId) : undefined;
    const basedOnNumber = basedOn?.number ?? null;
    const versionLabel = isDraft ? (basedOnNumber !== null ? `Based on v${basedOnNumber}` : null) : `v${versionNumber}`;
    const canEdit = can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok;
    const editable = canEdit && latest?.state === "draft";

    return {
      id: tpl.id,
      name: latest?.name ?? tpl.id,
      activeName: active?.name ?? null,
      teamSlug: tpl.teamSlug,
      teamName: tpl.teamName,
      status: latest?.state ?? "draft",
      sunsetDay: latest?.sunsetAt ? sunsetDay(latest.sunsetAt, zone) : null,
      versionLabel,
      basedOnNumber,
      activeNumber: active?.number ?? null,
      versionNumber,
      canEdit,
      editable,
      draft: editable && latest ? { versionId: latest.id, rev: latest.rev } : null,
      canStartDraft: canEdit && planDraftStart(list).kind === "create",
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
  /**
   * When the shown version is a draft: the variables of the newest version that still renders
   * (`contractBaseline`), for the contract flags. Null when none does.
   */
  baseline: Variable[] | null;
  channels: Channel[];
  /** The channels the content type allows: what the Channels selector offers. */
  allowedChannels: Channel[];
  /**
   * The template's family, fixed by its content type: a document (the Content tab is the editor) or a
   * message (the Content tab is the message composer). Decision 0033.
   */
  family: ChannelFamily;
  /**
   * The SMS footer and part budget: what the message preview renders an SMS with (`renderMessage`'s
   * `rules.smsFooter`) and the parts submit allows with the long sample values. The footer is the shown
   * version's (`smsFooterOf`): a draft's is its content type's as it stands, a submitted version's the one
   * frozen into it.
   */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from in the phone preview: the push app name and the SMS sender. */
  senders: TeamSenders;
  /** Each channel's own fields (src/domain/channel-fields.ts), whether or not the channel is on. */
  channelFields: ChannelFields;
  /** The version's named sample data sets, as saved. The preview's switcher fills in any default that is missing. */
  sampleSets: SampleSet[];
  /** The demo clock's date, YYYY-MM-DD: date samples are generated from it. */
  today: string;
  requiredSections: RequiredSection[];
  /** Only an open draft is editable, and only by an author on the template's team. */
  editable: boolean;
  /** The template's review threads, anchored against the shown version's blocks (the editor margin). */
  threads: ThreadView[];
  /**
   * What the viewer may do here. `comment`: start a thread, reply, resolve and reopen, which needs the
   * comment permission on the team and a shown version that takes comments (the open draft, or the latest
   * version while it is in review). Every thread shown here is one the viewer may then act on.
   */
  can: { comment: PermissionResult };
  /** Phase 7a: the file the template was imported from (the rail's Original tab), on every version; null when it wasn't imported. */
  importOriginal: ImportOriginalRef | null;
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
        smsFooter: contentTypes.smsFooter,
        smsMaxParts: contentTypes.smsMaxParts,
        appName: teams.appName,
        smsSender: teams.smsSender,
      })
      .from(templates)
      .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
      .innerJoin(teams, eq(teams.id, templates.teamId))
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
        channelFields: versions.channelFields,
        smsFooter: versions.smsFooter,
        sampleSets: versions.sampleSets,
      })
      .from(versions)
      .where(eq(versions.templateId, header.id));

    const shown = pickLatest(list);
    if (!shown) notFound();
    const at = await now();
    const today = at.toISOString().slice(0, 10);
    const threads = await loadThreads(header.id, anchorIdsOf(shown));
    const importOriginal = await getImportOriginalRef(header.id);

    return {
      templateId: header.id,
      teamName: header.teamName,
      versionId: shown.id,
      versionNumber: shown.state === "draft" ? null : shown.number,
      rev: shown.rev,
      body: shown.body,
      variables: shown.variables,
      baseline: shown.state === "draft" ? (contractBaseline(list, at)?.variables ?? null) : null,
      channels: shown.channels,
      allowedChannels: tpl.allowedChannels,
      family: contentTypeFamily(tpl.allowedChannels),
      messageRules: { smsFooter: smsFooterOf(shown, tpl.smsFooter), smsMaxParts: tpl.smsMaxParts },
      senders: { appName: tpl.appName, smsSender: tpl.smsSender },
      channelFields: shown.channelFields,
      sampleSets: shown.sampleSets,
      today,
      requiredSections: tpl.requiredSections,
      editable: shown.state === "draft" && can(space.viewer, "draft.edit", { teamId: tpl.teamId }).ok,
      threads,
      // The workspace is the team's: whoever a review stage names comments from the review screen.
      can: { comment: canComment(space.viewer, { teamId: tpl.teamId, version: { state: shown.state, stageApproverIds: [] } }) },
      importOriginal,
    };
  },
);
