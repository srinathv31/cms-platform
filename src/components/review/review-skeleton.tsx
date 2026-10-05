import { Skeleton } from "@/components/ui/skeleton";
import { ReviewHeaderSkeleton } from "./review-header";
import { RV } from "./review-grid";

/**
 * The review screen before its data arrives, in the screen's own cells: the header's rows, the tab
 * bar (its tabs are static, so they are real), a document's worth of lines, and the rail with the
 * stepper, the two buttons' row and the sections. Same grid, same classes, so nothing moves when it
 * streams in.
 */
export function ReviewSkeleton() {
  return (
    <>
      <ReviewHeaderSkeleton />
      <div data-slot="tab-bar" className={RV.tabs}>
        <div className="flex gap-7" aria-hidden>
          <span className="flex h-11 items-center text-[15px] font-medium text-text">
            <span className="-mx-1.5 px-1.5">Document</span>
          </span>
          <span className="flex h-11 items-center text-[15px] text-text-subtle">
            <span className="-mx-1.5 px-1.5">Preview</span>
          </span>
        </div>
      </div>
      <div aria-hidden className={RV.doc}>
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-9 h-6 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <aside aria-hidden className={RV.rail}>
        <div className={RV.railHead}>
          <div className="flex h-6 items-center">
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="mt-3 flex items-start gap-3">
            <Skeleton className="mt-0.5 size-5 rounded-full" />
            <div className="flex flex-col">
              <Skeleton className="my-[5px] h-3.5 w-28" />
              <Skeleton className="my-[3px] h-3.5 w-36" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
        </div>
        <div className={RV.railBody}>
          <Skeleton className="h-[4.25rem] w-full rounded-xl" />
          <div className="mt-8 flex h-6 items-center">
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </aside>
    </>
  );
}
