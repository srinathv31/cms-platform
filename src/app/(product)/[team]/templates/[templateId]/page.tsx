import { Stream } from "@/components/primitives/stream";
import { ContentSkeleton } from "@/components/workspace/content/content-skeleton";
import { WorkspaceContent } from "@/components/workspace/content/workspace-content";

// Content tab. Two cells of the layout's grid: the document (server-rendered HTML first, then the
// live editor mounts into the same box after hydration) and the rail beside everything.
export default function TemplateContentPage({
  params,
}: PageProps<"/[team]/templates/[templateId]">) {
  return (
    <Stream fallback={<ContentSkeleton />}>
      <WorkspaceContent params={params} />
    </Stream>
  );
}
