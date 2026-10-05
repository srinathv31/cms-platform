import { getWorkspaceDocument } from "@/server/queries/workspace";
import { ContentWorkspace } from "./content-workspace";

/** Reads the document the Content tab shows and hands it to the client workspace (document + rail). */
export async function WorkspaceContent({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const doc = await getWorkspaceDocument(team, templateId);
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
    />
  );
}
