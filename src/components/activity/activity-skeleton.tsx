import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { WS } from "@/components/workspace/workspace-grid";

/** One day label and six rows (avatar, a sentence, a version chip and a time), as in the real list. */
export function ActivitySkeleton() {
  return (
    <div data-slot="activity" aria-hidden className={cn(WS.doc, "flex flex-col gap-8")}>
      <div>
        <div className="mb-1.5 flex h-4 items-center">
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="flex flex-col divide-y divide-hairline">
          {[72, 58, 66, 48, 62, 54].map((width, i) => (
            <div key={i} className="flex items-start gap-3 py-3">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <div className="flex h-6 min-w-0 flex-1 items-center">
                <Skeleton className="h-4" style={{ width: `${width}%` }} />
              </div>
              <Skeleton className="h-6 w-8 shrink-0 rounded-md" />
              <div className="flex h-6 w-24 shrink-0 items-center justify-end">
                <Skeleton className="h-3.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
