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
      // A different version is a different document, editor and autosave session.
      key={doc.versionId}
      versionId={doc.versionId}
      rev={doc.rev}
      body={doc.body}
      variables={doc.variables}
      baseline={doc.baseline}
      requiredSections={doc.requiredSections}
      channels={doc.channels}
      allowedChannels={doc.allowedChannels}
      editable={doc.editable}
    />
  );
}
