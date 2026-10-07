import { cn } from "@/lib/utils";
import { EyebrowSkeleton, PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS, FOLDS, ROW, statusColumn } from "./columns";

// The Library's frame and its skeletons, with nothing from the server: the page streams real content
// into the frame's slots, and the frame's pending view (app-shell/pending-views.tsx) fills them with
// these, so the two can't drift apart.

/** Serif title, the space's name above it, the one primary action, then the list. */
export function LibraryFrame({
  eyebrow,
  action,
  children,
}: {
  eyebrow: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title="Library" eyebrow={eyebrow} action={action} />
      {children}
    </div>
  );
}

/** Same geometry as the loaded list (toolbar, header row, six rows), so nothing shifts when it streams in. */
export function LibraryListSkeleton() {
  return (
    <div aria-hidden style={statusColumn(false)}>
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 pb-4">
        <Skeleton className="h-9 w-72 rounded-full" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-14 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
      <div className="border-b border-hairline">
        <div className={cn(ROW, "h-10", COLUMNS)}>
          <span className="caps-label">Template</span>
          <span className="caps-label">Status</span>
          <span className="caps-label">Active</span>
          <span className={cn("caps-label", FOLDS)}>Last edited</span>
          <span className={cn("caps-label", FOLDS)}>Owner</span>
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-b border-hairline last:border-b-0">
          <div className={cn(ROW, "min-h-[4.25rem] py-3", COLUMNS)}>
            <span>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </span>
            <Skeleton className="h-[22px] w-24 rounded-md" />
            <Skeleton className="h-4 w-7" />
            <Skeleton className={cn("h-4 w-20", FOLDS)} />
            <span className={cn("flex items-center gap-2.5", FOLDS)}>
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The Library before anything has streamed: what its static shell shows (the action's fallback is empty). */
export function LibraryPageSkeleton() {
  return (
    <LibraryFrame eyebrow={<EyebrowSkeleton />}>
      <LibraryListSkeleton />
    </LibraryFrame>
  );
}
