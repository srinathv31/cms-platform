import { AuditPageSkeleton } from "@/components/audit/audit-skeleton";
import { LibraryPageSkeleton } from "@/components/library/library-skeleton";
import { ReviewScreenSkeleton } from "@/components/review/review-skeleton";
import { ReviewQueuePageSkeleton } from "@/components/review-queue/queue-skeleton";
import { UsagePageSkeleton } from "@/components/usage/usage-skeleton";
import { TemplatePageSkeleton, WorkspaceTabSkeleton } from "@/components/workspace/workspace-skeleton";
import type { PendingView, WorkspaceTab } from "./pending-routes";

// Every pending view (see pending-nav.tsx), by destination. Each is its page's frame filled with the
// page's own fallbacks, so it is what the page's static shell shows, to the pixel. Imported statically
// into the frame, so a click never waits on a chunk; only development builds keep them.

/** The whole canvas, for a page in its own right. */
export function CanvasPendingView({ view }: { view: Extract<PendingView, { scope: "canvas" }> }) {
  switch (view.page) {
    case "library":
      return <LibraryPageSkeleton />;
    case "review":
      return <ReviewQueuePageSkeleton />;
    case "usage":
      return <UsagePageSkeleton />;
    case "audit":
      return <AuditPageSkeleton />;
    case "template":
      return <TemplatePageSkeleton tab={view.tab} />;
    case "review-version":
      return <ReviewScreenSkeleton />;
  }
}

/** A tab of the template already open: the tab's cells only. */
export function WorkspaceTabPending({ tab }: { tab: WorkspaceTab }) {
  return <WorkspaceTabSkeleton tab={tab} />;
}
