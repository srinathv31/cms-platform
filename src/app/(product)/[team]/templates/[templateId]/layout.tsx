import { Stream } from "@/components/primitives/stream";
import { ResetCanvasScroll } from "@/components/workspace/reset-canvas-scroll";
import { WorkspaceSessionProvider } from "@/components/workspace/session/workspace-session";
import { WorkspaceHeader, WorkspaceHeaderSkeleton } from "@/components/workspace/workspace-header";
import { WS } from "@/components/workspace/workspace-grid";
import { WorkspaceTabBar } from "@/components/workspace/workspace-tab-bar";

// The workspace is one grid (see workspace-grid.ts): the header and the tab bar here, and whatever
// the page renders (its document, and on Content the rail beside everything) as direct children.
export default function TemplateWorkspaceLayout({
  children,
  params,
}: LayoutProps<"/[team]/templates/[templateId]">) {
  return (
    <WorkspaceSessionProvider>
      <ResetCanvasScroll />
      <div data-slot="workspace" className={WS.grid}>
        <Stream fallback={<WorkspaceHeaderSkeleton />}>
          <WorkspaceHeader params={params} />
        </Stream>
        <WorkspaceTabBar params={params} />
        <div aria-hidden className={WS.railSpace} />
        {children}
      </div>
    </WorkspaceSessionProvider>
  );
}
