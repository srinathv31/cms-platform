import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { ChannelFields } from "@/domain/channel-fields";
import { utcDay } from "@/domain/dates";
import type { ImportOriginalRef } from "@/domain/import-types";
import type { WorkspaceActions } from "@/domain/lifecycle/version-actions";
import type {
  MessageTypeRules,
  TeamSenders,
} from "@/domain/platform-config/limits";
import type { Person } from "@/domain/review-types";
import { versionLabel, type NumberedRound } from "@/domain/rounds";
import type {
  Channel,
  ChannelFamily,
  JSONContent,
  PermissionResult,
  SampleSet,
  Variable,
  VersionState,
} from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type {
  WorkspaceDocumentFacts,
  WorkspaceHeaderFacts,
} from "@/server/services/workspace";
import { personOf, type People } from "./people";
import { requireSpace } from "./spaces";
import { threadViews, type ThreadView } from "./threads";

// A template's workspace: the header every tab shows, and the document the Content tab edits or shows. The
// template service decides (which version the workspace shows, what the viewer may do: services/workspace.ts);
// these word its facts ("Based on v2", "Revert to v1, round 1") and lay them out. Not found when the template
// isn't in the URL's space or isn't the viewer's to see.

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
  /** The latest version's sunset has passed (`sunsetPassed`): the badge says "Sunset passed". */
  sunsetPassed: boolean;
  /**
   * What sits beside the status badge. The badge already says the state, so the label never
   * repeats it: "v2" (or "v3 · Round 2", rounds.ts) on a version with a number, "Based on v2" (or
   * "Based on v1 · Round 1") on a draft of an earlier version, and null on a brand-new draft that has
   * no earlier version.
   */
  versionLabel: string | null;
  /**
   * The version an open draft was started from: its label in a sentence ("Revert to v3", "Revert to
   * v1, round 1"), and whether it is the Active version. Null when it isn't based on one.
   */
  basedOn: { label: string; active: boolean } | null;
  /** Number of the Active version, if any (the SHARE ring shows only then). */
  activeNumber: number | null;
  /** The number the shown version has, or will get at submit when it's a draft (`nextRound`). */
  versionNumber: number;
  /** The round the shown version is, or will be at submit when it's a draft. */
  round: number;
  /** The round in review, if there is one: the workspace links to its review screen (`reviewPath`). */
  inReview: NumberedRound | null;
  /** The shown version is an open draft and the viewer can edit it (the name is a field, autosave runs). */
  editable: boolean;
  /**
   * The draft autosave saves to, when `editable`: its id, and its `rev` where autosave starts. The
   * header binds the workspace session to it, so the name saves on every tab. Null otherwise.
   */
  draft: { versionId: string; rev: number } | null;
  /**
   * What the viewer may do here, decided: `edit` the team's drafts ("View only" when refused), Edit
   * (`startDraft`: the black button on a live template), and Submit for review (`submit`, on the open draft).
   */
  can: WorkspaceActions;
  /** ISO: the backend's instant the header was decided at (`asOf`); the badge's dates read against it. */
  now: string;
}

/** Header data for /{team}/templates/{templateId}. 404 when the template isn't visible here. */
export const getWorkspaceHeader = cache(
  async (spaceSlug: string, templateId: string): Promise<WorkspaceHeaderData> =>
    workspaceHeaderData(await getWorkspaceHeaderFacts(spaceSlug, templateId)),
);

/**
 * The service's header facts for the template as seen from a space, asked once per render (the header is on
 * every tab). Not found when the template isn't in the URL's space or isn't the viewer's to see.
 */
export const getWorkspaceHeaderFacts = cache(
  async (
    spaceSlug: string,
    templateId: string,
  ): Promise<WorkspaceHeaderFacts> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const header = await services().templates.workspaceHeader(ctx, {
      templateId,
    });
    // All teams holds every team's templates; a team's space only its own.
    if (
      !header.ok ||
      (space.teamId !== null && header.template.teamId !== space.teamId)
    )
      notFound();
    return header;
  },
);

/** The header from the service's facts: the name and status the badge shows, and the labels beside it. */
export function workspaceHeaderData(
  header: WorkspaceHeaderFacts,
): WorkspaceHeaderData {
  const { shown, basedOn } = header;
  const draft = shown?.state === "draft" ? shown : null;
  const editable = draft !== null && header.can.edit.ok;
  return {
    id: header.template.id,
    // A template with no version at all (never the case through the app) shows its id, as the Library does.
    name: shown?.name ?? header.template.id,
    activeName: header.active?.name ?? null,
    teamSlug: header.template.teamSlug,
    teamName: header.template.teamName,
    status: shown?.state ?? "draft",
    sunsetDay: shown?.sunsetDay ?? null,
    sunsetPassed: shown?.sunsetPassed ?? false,
    // A submitted version is numbered as it is (`numbered`); a draft says what it was based on.
    versionLabel:
      shown && !draft
        ? versionLabel({ ...header.numbered, state: shown.state })
        : basedOn
          ? `Based on ${versionLabel(basedOn)}`
          : null,
    basedOn: basedOn
      ? {
          label: versionLabel(basedOn, { style: "sentence" }),
          active: basedOn.state === "active",
        }
      : null,
    activeNumber: header.active?.number ?? null,
    versionNumber: header.numbered.number,
    round: header.numbered.round,
    inReview: header.inReview,
    editable,
    draft: editable && draft ? { versionId: draft.id, rev: draft.rev } : null,
    can: header.can,
    now: header.asOf,
  };
}

export interface WorkspaceDocumentData {
  /** The template's id (the render route is addressed by it). */
  templateId: string;
  /** The team the template belongs to; the email preview's sender line is made from it. */
  teamName: string;
  versionId: string;
  /** The shown version's number, or null for an open draft (the preview asks the route for "draft"). */
  versionNumber: number | null;
  /** The shown version's round, or null for an open draft (a preview of an earlier round asks for it). */
  round: number | null;
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
   * message (the Content tab is the message composer). Decision 0034.
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
  /** The UTC day of `now`, YYYY-MM-DD: date samples are generated from it. */
  today: string;
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
  /** The file the template was imported from (the rail's Original tab), on every version; null when it wasn't imported. */
  importOriginal: ImportOriginalRef | null;
  /** Who is looking: the comments they write show under their name at once, before the server confirms them. */
  viewer: Person;
  /** ISO: the backend's instant the document was read at (`asOf`); the margin's times count from it. */
  now: string;
}

/** The document shown on the Content tab: the open draft if there is one, otherwise the latest version. */
export const getWorkspaceDocument = cache(
  async (
    spaceSlug: string,
    templateId: string,
  ): Promise<WorkspaceDocumentData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const document = await services().templates.workspaceDocument(ctx, {
      templateId,
    });
    if (
      !document.ok ||
      (space.teamId !== null && document.template.teamId !== space.teamId)
    )
      notFound();
    return workspaceDocumentData(document, ctx.viewer.userId);
  },
);

/** The Content tab's document from the service's facts. `viewerId` is who is looking. */
export function workspaceDocumentData(
  document: WorkspaceDocumentFacts,
  viewerId: string,
): WorkspaceDocumentData {
  const people: People = new Map(document.people.map((p) => [p.id, p]));
  const { template, version, importOriginal } = document;
  return {
    templateId: template.id,
    teamName: template.teamName,
    versionId: version.id,
    versionNumber: version.number,
    round: version.round,
    rev: version.rev,
    body: version.body,
    variables: version.variables,
    baseline: document.baseline,
    channels: version.channels,
    allowedChannels: template.allowedChannels,
    family: template.family,
    messageRules: document.messageRules,
    senders: document.senders,
    channelFields: version.channelFields,
    sampleSets: version.sampleSets,
    today: utcDay(document.asOf),
    editable: version.state === "draft" && document.can.edit.ok,
    threads: threadViews(document.threads, people),
    can: { comment: document.can.comment },
    importOriginal: importOriginal
      ? {
          uploadId: importOriginal.uploadId,
          filename: importOriginal.filename,
          kind: importOriginal.kind,
          size: importOriginal.size,
          uploadedAt: importOriginal.uploadedAt,
          uploadedByName: personOf(people, importOriginal.uploadedBy).name,
        }
      : null,
    viewer: personOf(people, viewerId),
    now: document.asOf,
  };
}
