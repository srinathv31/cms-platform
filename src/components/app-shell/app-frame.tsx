import type { CSSProperties } from "react";
import { Stream } from "@/components/primitives/stream";
import { DemoPillHole } from "@/components/demo/demo-pill-hole";
import { SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, NavDrawerTrigger } from "./app-sidebar";
import { CanvasScroll } from "./canvas-scroll";
import { HomeLink } from "./home-link";
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
      {/* One landmark for the whole sidebar: the product name, the switcher, the space's pages, its card, Settings and Help.
          A column from 800px up, a drawer below it (decision 0045). */}
      <AppSidebar>
        <SidebarHeader className="gap-0 px-3 pt-5 pb-2">
          <HomeLink />
          <Stream fallback={<TeamSwitcherSkeleton />}>
            <TeamSwitcherHole />
          </Stream>
        </SidebarHeader>
        <Stream fallback={<SidebarBodySkeleton />}>
          <SidebarBodyHole />
        </Stream>
      </AppSidebar>

      <PersonaSwitchProvider>
        <SidebarInset className="m-3 wide:ml-0 min-h-0 min-w-0 overflow-hidden rounded-4xl border border-hairline bg-canvas shadow-none">
          <header
            data-slot="top-bar"
            className="flex h-16 shrink-0 items-center justify-end px-(--canvas-pad-x)"
          >
            <NavDrawerTrigger />
            <Stream fallback={<TopBarSkeleton />}>
              <TopBarHole />
            </Stream>
          </header>
          <CanvasFade className="@container/canvas min-h-0 flex-1 overflow-y-auto px-(--canvas-pad-x) pb-14">
            <div className="mx-auto w-full max-w-[96rem]">{children}</div>
          </CanvasFade>
        </SidebarInset>
        {/* After the canvas, so its layout effects run after the page's own. */}
        <CanvasScroll />
        <DemoPillHole />
      </PersonaSwitchProvider>
    </SidebarProvider>
  );
}
