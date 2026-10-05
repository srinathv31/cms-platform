import { versionTakesComments } from "@/components/comments/thread-state";
import { can } from "@/domain/permissions";
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
  // Review comments: who is looking (their comments show at once, under their name), and whether they may comment.
  // Only a draft or a version in review takes them: on an Active (or any decided) version the threads are a record,
  // as on the review screen. (The shown version is the latest one, whose state the header carries.)
  const { space, template } = await requireTemplate(team, templateId);
  const { status } = await getWorkspaceHeader(team, templateId);
  const viewer = personOf(await getPeople(), space.viewer.userId);
  const canComment = can(space.viewer, "review.comment", { teamId: template.teamId }).ok && versionTakesComments(status);
  const nowIso = (await now()).toISOString();
  return (
    <ContentWorkspace
      // A different version is a different document, editor and autosave session. So is the same
      // version once it can't be edited any more (submitted, or the viewer changed): the key then
      // changes with `editable`, and the new workspace mounts read-only and unbinds the session.
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
      emailSubject={doc.emailSubject}
      emailPreheader={doc.emailPreheader}
      sampleSets={doc.sampleSets}
      today={doc.today}
      editable={doc.editable}
      threads={doc.threads}
      canComment={canComment}
      viewer={viewer}
      now={nowIso}
    />
  );
}
