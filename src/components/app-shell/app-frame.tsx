import type { CSSProperties } from "react";
import { Stream } from "@/components/primitives/stream";
import { DemoPillHole } from "@/components/demo/demo-pill-hole";
import { Sidebar, SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CanvasFade, PersonaSwitchProvider } from "./persona-switch";
import { SidebarBodyHole, TeamSwitcherHole } from "./sidebar-holes";
import { SidebarBodySkeleton, TeamSwitcherSkeleton, TopBarSkeleton } from "./skeletons";
import { TopBarHole } from "./top-bar-hole";

/**
 * The static frame: stone background, sidebar, and the inset canvas panel.
 * Nothing here reads the request. Everything that depends on who is looking streams inside <Stream>.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "var(--sidebar-w)" } as CSSProperties}
      className="h-svh min-h-0 overflow-hidden bg-app"
    >
      <Sidebar variant="inset" collapsible="none" className="shrink-0">
        <SidebarHeader className="gap-0 px-3 pt-4 pb-2">
          <Stream fallback={<TeamSwitcherSkeleton />}>
            <TeamSwitcherHole />
          </Stream>
        </SidebarHeader>
        <Stream fallback={<SidebarBodySkeleton />}>
          <SidebarBodyHole />
        </Stream>
      </Sidebar>

      <PersonaSwitchProvider>
        <SidebarInset className="m-3 ml-0 min-h-0 min-w-0 overflow-hidden rounded-4xl border border-hairline bg-canvas shadow-none">
          <header
            data-slot="top-bar"
            className="flex h-16 shrink-0 items-center justify-end px-(--canvas-pad-x)"
          >
            <Stream fallback={<TopBarSkeleton />}>
              <TopBarHole />
            </Stream>
          </header>
          <CanvasFade className="@container/canvas min-h-0 flex-1 overflow-y-auto px-(--canvas-pad-x) pb-14">
            <div className="mx-auto w-full max-w-[96rem]">{children}</div>
          </CanvasFade>
        </SidebarInset>
        <DemoPillHole />
      </PersonaSwitchProvider>
    </SidebarProvider>
  );
}
