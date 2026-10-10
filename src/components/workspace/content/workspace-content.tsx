import { now } from "@/server/clock";
import { getPeople, personOf, requireTemplate } from "@/server/queries/review-shared";
import { getWorkspaceDocument, getWorkspaceHeader } from "@/server/queries/workspace";
import { ContentWorkspace } from "./content-workspace";

/** Reads the document the Content tab shows and hands it to the client workspace (document + rail). */
export async function WorkspaceContent({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const doc = await getWorkspaceDocument(team, templateId);
  // Review comments: who is looking (their comments show at once, under their name). Whether they may comment comes
  // decided with the document (`doc.can.comment`).
  const { space } = await requireTemplate(team, templateId);
  const { status, versionNumber } = await getWorkspaceHeader(team, templateId);
  const viewer = personOf(await getPeople(), space.viewer.userId);
  const nowIso = (await now()).toISOString();
  // A version in review opens on the review screen, in this space (anyone who sees the template here can).
  const reviewHref = status === "in_review" ? `/${team}/review/${templateId}/${versionNumber}` : null;
  return (
    <ContentWorkspace
      // A different version is a different document and editor. So is the same version once it can't
      // be edited any more (submitted, or the viewer changed): the key then changes with `editable`,
      // and the new workspace mounts read-only. The header, re-rendered with it, unbinds the session.
      key={`${doc.versionId}:${doc.editable ? "edit" : "view"}`}
      templateId={doc.templateId}
      teamName={doc.teamName}
      versionId={doc.versionId}
      versionNumber={doc.versionNumber}
      rev={doc.rev}
      body={doc.body}
      variables={doc.variables}
      baseline={doc.baseline}
      requiredSections={doc.requiredSections}
      channels={doc.channels}
      allowedChannels={doc.allowedChannels}
      channelFields={doc.channelFields}
      sampleSets={doc.sampleSets}
      today={doc.today}
      editable={doc.editable}
      threads={doc.threads}
      canComment={doc.can.comment.ok}
      viewer={viewer}
      now={nowIso}
      importOriginal={doc.importOriginal}
      reviewHref={reviewHref}
    />
  );
}
