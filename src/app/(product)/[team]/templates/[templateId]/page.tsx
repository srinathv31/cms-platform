import { DocumentEditor } from "@/editor";
import { Stream } from "@/components/primitives/stream";
import { Skeleton } from "@/components/ui/skeleton";
import { getWorkspaceDocument } from "@/server/queries/workspace";

// Content tab. The document streams in as server-rendered HTML (StaticDocument),
// then the live editor mounts into the same box after hydration.
export default function TemplateContentPage({
  params,
}: PageProps<"/[team]/templates/[templateId]">) {
  return (
    <div data-slot="editor" className="mx-auto min-h-[32rem] w-full max-w-(--doc-width)">
      <Stream fallback={<DocumentSkeleton />}>
        <WorkspaceDocument params={params} />
      </Stream>
    </div>
  );
}

async function WorkspaceDocument({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const doc = await getWorkspaceDocument(team, templateId);
  return (
    <DocumentEditor
      key={doc.versionId}
      content={doc.body}
      variables={doc.variables}
      requiredSections={doc.requiredSections}
      readOnly={!doc.editable}
    />
  );
}

function DocumentSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 pt-1">
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-6 h-6 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-6 h-6 w-40" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
