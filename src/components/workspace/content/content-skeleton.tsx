import { ArrivalRailSkeleton } from "@/components/import/arrival-rail-skeleton";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { WS } from "../workspace-grid";

/**
 * What the Content tab shows while the document streams in: the same two cells, in the same places, as
 * the page itself (the document and the rail), so nothing moves when they swap.
 */
export function ContentSkeleton() {
  return (
    <>
      <div
        data-slot="editor"
        aria-hidden
        className={cn(WS.doc, "flex flex-col gap-3")}
      >
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-6 h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-6 h-6 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
      {/* Arriving from an import, the rail's stand-in is already widened (the page opens on the Original view). */}
      <ArrivalRailSkeleton
        narrow={
          <div aria-hidden data-slot="rail" className={WS.rail}>
            <div className="flex h-6 items-center px-2">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-3 flex gap-1 px-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-[4.5rem] rounded-md" />
            </div>
            <div className="mt-8 flex flex-col gap-3 px-2">
              <Skeleton className="h-3 w-20" />
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex flex-col gap-1.5 py-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        }
      />
    </>
  );
}
