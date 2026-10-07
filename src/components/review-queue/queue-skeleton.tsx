import { cn } from "@/lib/utils";
import { EyebrowSkeleton, PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS, FOLDS, ROW, ROW_HEIGHT } from "./columns";
import { TAB_META } from "./tab-meta";
import { TAB, TAB_BAR, TAB_CONTENT } from "./tab-styles";

/** The review queue's frame: the title over the queue. The page streams into it; its pending view fills it with skeletons. */
export function ReviewQueueFrame({ eyebrow, children }: { eyebrow: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Review" eyebrow={eyebrow} />
      {children}
    </div>
  );
}

/** Same geometry as the loaded list (tab bar, header row, four rows), so nothing shifts when it streams in. */
export function QueueSkeleton() {
  return (
    <div aria-hidden>
      <div className={TAB_BAR}>
        {Object.values(TAB_META).map(({ label }) => (
          <span key={label} className={cn(TAB, "text-text-muted")}>
            <span className={TAB_CONTENT}>
              {label}
              <Skeleton className="h-4 w-2.5" />
            </span>
          </span>
        ))}
      </div>
      <div className={cn("border-b border-hairline", FOLDS)}>
        <div className={cn(ROW, "h-10", COLUMNS)}>
          <span className="caps-label">Template</span>
          <span className="caps-label">Author</span>
          <span className="caps-label">Submitted</span>
          <span className="caps-label">Stage</span>
        </div>
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="border-b border-hairline last:border-b-0">
          <div className={cn(ROW, ROW_HEIGHT, "py-3", COLUMNS)}>
            <span>
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </span>
            <span className={cn("flex items-center gap-2.5", FOLDS)}>
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </span>
            <Skeleton className={cn("h-4 w-16", FOLDS)} />
            <Skeleton className={cn("h-4 w-20", FOLDS)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The queue before anything has streamed: what its static shell shows. */
export function ReviewQueuePageSkeleton() {
  return (
    <ReviewQueueFrame eyebrow={<EyebrowSkeleton />}>
      <QueueSkeleton />
    </ReviewQueueFrame>
  );
}
