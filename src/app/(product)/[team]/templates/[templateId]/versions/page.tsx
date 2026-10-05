import { Stream } from "@/components/primitives/stream";
import { VersionsContent } from "@/components/versions/versions-content";
import { VersionsSkeleton } from "@/components/versions/versions-skeleton";

// Versions tab: the template's versions as a timeline, with Compare, Set sunset and Revoke. The
// document cell of the workspace grid (see workspace-grid.ts); the rail column stays reserved.
export default function TemplateVersionsPage({
  params,
}: PageProps<"/[team]/templates/[templateId]/versions">) {
  return (
    <Stream fallback={<VersionsSkeleton />}>
      <VersionsContent params={params} />
    </Stream>
  );
}
