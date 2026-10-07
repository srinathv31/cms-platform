import { PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivitySkeleton } from "@/components/activity/activity-skeleton";
import type { WorkspaceTab } from "@/components/app-shell/pending-routes";
import { TemplateUsageSkeleton } from "@/components/usage/template-usage-skeleton";
import { VersionsSkeleton } from "@/components/versions/versions-skeleton";
import { ContentSkeleton } from "./content/content-skeleton";
import { WS } from "./workspace-grid";
import { WorkspaceTabsSkeleton } from "./workspace-tabs";

// The workspace's frame and its skeletons, with nothing from the server: the template layout streams
// real content into the frame's slots, and the pending views (app-shell/pending-views.tsx) fill them
// with these, so the two can't drift apart.

/** The header's small grid (see workspace-header.tsx), shared with its skeleton. */
export const HEADER = "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-y-1.5";

/** The workspace grid (see workspace-grid.ts): header, tab bar, the rail column's reserved width, then the tab's own cells. */
export function WorkspaceFrame({
  header,
  tabBar,
  children,
}: {
  header: React.ReactNode;
  tabBar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="workspace" className={WS.grid}>
      {header}
      {tabBar}
      <div aria-hidden className={WS.railSpace} />
      {children}
    </div>
  );
}

/** The tabs at the left of the tab bar, the template's actions at the right end of the same line. */
export function TabBarFrame({ tabs, actions }: { tabs: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div data-slot="tab-bar" className={WS.tabs}>
      {tabs}
      <div className="flex h-11 shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

/** Name line and status row, same rows as the header. */
export function WorkspaceHeaderSkeleton() {
  return (
    <div aria-hidden className={cn(WS.header, HEADER)}>
      <Skeleton className="col-span-2 col-start-1 row-start-1 my-[3px] h-7 w-72" />
      <div className="col-start-1 row-start-2 flex min-h-[2.625rem] items-end gap-3 pb-[3px]">
        <Skeleton className="h-[22px] w-20 rounded-md" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}

/** Each tab's own fallback: the cells its page streams into. */
export function WorkspaceTabSkeleton({ tab }: { tab: WorkspaceTab }) {
  switch (tab) {
    case "content":
      return <ContentSkeleton />;
    case "versions":
      return <VersionsSkeleton />;
    case "usage":
      return <TemplateUsageSkeleton />;
    case "activity":
      return <ActivitySkeleton />;
  }
}

/**
 * The Content tab's rail toggle as the static shell draws it (workspace-actions.tsx), without the
 * session it opens. It shows only below the rail's breakpoint, like the real one.
 */
function RailToggleStandIn() {
  return (
    <span
      aria-hidden
      className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "pointer-events-none @min-[53rem]/ws:hidden")}
    >
      <PanelRight strokeWidth={1.75} />
    </span>
  );
}

/** A template before anything has streamed, on `tab`: what its static shell shows. */
export function TemplatePageSkeleton({ tab }: { tab: WorkspaceTab }) {
  return (
    <WorkspaceFrame
      header={<WorkspaceHeaderSkeleton />}
      tabBar={
        <TabBarFrame
          tabs={<WorkspaceTabsSkeleton />}
          actions={
            <>
              {tab === "content" ? <RailToggleStandIn /> : null}
              {/* The actions' own fallback (workspace-tab-bar.tsx), so the toggle sits where it will. */}
              <span aria-hidden />
            </>
          }
        />
      }
    >
      <WorkspaceTabSkeleton tab={tab} />
    </WorkspaceFrame>
  );
}
