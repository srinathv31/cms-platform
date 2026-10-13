import { reviewPath } from "@/domain/rounds";
import {
  getWorkspaceDocument,
  getWorkspaceHeader,
} from "@/server/queries/workspace";
import { ContentWorkspace } from "./content-workspace";

/** Reads the document the Content tab shows and hands it to the client workspace (document + rail). */
export async function WorkspaceContent({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const doc = await getWorkspaceDocument(team, templateId);
  // Review comments: who is looking (`doc.viewer`: their comments show at once, under their name). Whether they may
  // comment comes decided with the document (`doc.can.comment`), and the margin's times count from `doc.now`.
  const { inReview } = await getWorkspaceHeader(team, templateId);
  // A round in review opens on its review screen, in this space (anyone who sees the template here can).
  const reviewHref = inReview ? reviewPath(team, templateId, inReview) : null;
  return (
    <ContentWorkspace
      // A different version is a different document and editor. So is the same version once it can't
      // be edited any more (submitted, or the viewer changed): the key then changes with `editable`,
      // and the new workspace mounts read-only. The header, re-rendered with it, unbinds the session.
      key={`${doc.versionId}:${doc.editable ? "edit" : "view"}`}
      version={{
        templateId: doc.templateId,
        family: doc.family,
        versionId: doc.versionId,
        versionNumber: doc.versionNumber,
        round: doc.round,
        rev: doc.rev,
        editable: doc.editable,
      }}
      draft={{
        body: doc.body,
        variables: doc.variables,
        baseline: doc.baseline,
        channels: doc.channels,
        allowedChannels: doc.allowedChannels,
        channelFields: doc.channelFields,
        sampleSets: doc.sampleSets,
      }}
      preview={{
        teamName: doc.teamName,
        messageRules: doc.messageRules,
        senders: doc.senders,
        today: doc.today,
      }}
      comments={{
        threads: doc.threads,
        canComment: doc.can.comment.ok,
        viewer: doc.viewer,
        now: doc.now,
      }}
      rail={{ importOriginal: doc.importOriginal, reviewHref }}
    />
  );
}
