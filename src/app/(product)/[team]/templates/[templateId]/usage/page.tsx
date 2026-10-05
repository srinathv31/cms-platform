import { Stream } from "@/components/primitives/stream";
import { TemplateUsageContent } from "@/components/usage/template-usage";
import { TemplateUsageSkeleton } from "@/components/usage/template-usage-skeleton";

// Usage tab: which consumers render which version of this template. The document cell of the workspace
// grid (see workspace-grid.ts), widened over the rail column that this tab leaves empty.
export default function TemplateUsagePage({ params }: PageProps<"/[team]/templates/[templateId]/usage">) {
  return (
    <Stream fallback={<TemplateUsageSkeleton />}>
      <TemplateUsageContent params={params} />
    </Stream>
  );
}
