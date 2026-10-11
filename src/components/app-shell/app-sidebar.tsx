"use client";

import { useEffect, type ReactNode } from "react";
import { Sidebar, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

/**
 * The sidebar. From 800px up it is the fixed column it always was (`collapsible="none"`, so nothing about the
 * laptop layout depends on the shadcn sidebar's own desktop mode). Below 800px, where `useIsMobile` is true, it is
 * the shadcn sidebar's sheet, opened from `NavDrawerTrigger` in the top bar (decision 0045).
 *
 * The server and the first client render say "not mobile", so the column is in the HTML; `narrow:hidden` takes it
 * out of a narrow window before any script runs, and React swaps it for the sheet once the window is measured.
 */
export function AppSidebar({ children }: { children: ReactNode }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  // Widening the window past the breakpoint with the drawer open must not leave it open for the next narrowing.
  useEffect(() => {
    if (!isMobile && openMobile) setOpenMobile(false);
  }, [isMobile, openMobile, setOpenMobile]);

  return (
    <Sidebar
      variant="inset"
      collapsible={isMobile ? "offcanvas" : "none"}
      role="navigation"
      aria-label="Sidebar"
      className="shrink-0 narrow:hidden"
    >
      {isMobile ? (
        // Following a link is the end of the drawer's job: close it, so the page it opened isn't behind a scrim.
        <div
          className="contents"
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest("a[href]")) setOpenMobile(false);
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </Sidebar>
  );
}

/**
 * Opens the drawer. It is in the top bar's HTML at every width and `wide:` takes it out of the layout from 800px
 * up, so the bar has the same geometry as before there. It is the shadcn trigger, named for what it does.
 */
export function NavDrawerTrigger() {
  const { openMobile } = useSidebar();
  return (
    <SidebarTrigger
      aria-label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={openMobile}
      className="mr-auto size-9 rounded-full text-text hover:bg-hover wide:hidden [&_svg:not([class*='size-'])]:size-5"
    />
  );
}
