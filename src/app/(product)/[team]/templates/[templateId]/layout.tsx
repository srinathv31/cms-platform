import { Stream } from "@/components/primitives/stream";
import { WorkspaceSessionProvider } from "@/components/workspace/session/workspace-session";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspacePageSlot } from "@/components/workspace/workspace-page-slot";
import { WorkspaceFrame, WorkspaceHeaderSkeleton } from "@/components/workspace/workspace-skeleton";
import { WorkspaceTabBar } from "@/components/workspace/workspace-tab-bar";

// The workspace is one grid (see workspace-grid.ts): the header and the tab bar here, and whatever
// the page renders (its document, and on Content the rail beside everything) as direct children.
export default function TemplateWorkspaceLayout({
  children,
  params,
}: LayoutProps<"/[team]/templates/[templateId]">) {
  return (
    <WorkspaceSessionProvider>
      <WorkspaceFrame
        header={
          <Stream fallback={<WorkspaceHeaderSkeleton />}>
            <WorkspaceHeader params={params} />
          </Stream>
        }
        tabBar={<WorkspaceTabBar params={params} />}
      >
        <WorkspacePageSlot>{children}</WorkspacePageSlot>
      </WorkspaceFrame>
    </WorkspaceSessionProvider>
  );
}
