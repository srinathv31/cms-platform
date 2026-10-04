import { Stream } from "@/components/primitives/stream";
import { WorkspaceHeader, WorkspaceHeaderSkeleton } from "@/components/workspace/workspace-header";
import { WorkspaceTabs, WorkspaceTabsSkeleton } from "@/components/workspace/workspace-tabs";

export default function TemplateWorkspaceLayout({
  children,
  params,
}: LayoutProps<"/[team]/templates/[templateId]">) {
  return (
    <div>
      <Stream fallback={<WorkspaceHeaderSkeleton />}>
        <WorkspaceHeader params={params} />
      </Stream>
      <Stream fallback={<WorkspaceTabsSkeleton />}>
        {params.then(({ team, templateId }) => (
          <WorkspaceTabs base={`/${team}/templates/${templateId}`} />
        ))}
      </Stream>
      <div className="pt-10">{children}</div>
    </div>
  );
}
