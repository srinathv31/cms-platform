import { Skeleton } from "@/components/ui/skeleton";

/** The scrolling page area: one inset, a comfortable measure, room under the Demo pill. */
export function PageScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-8 py-6 pb-14">
      <div className="mx-auto flex max-w-[68rem] flex-col gap-5">{children}</div>
    </div>
  );
}

/** Skeleton with the real geometry of a page: header block, then panels of `rows` rows. */
export function PageSkeleton({ panels = [4] }: { panels?: number[] }) {
  return (
    <PageScroll>
      <div aria-hidden className="flex min-h-[3.75rem] flex-col justify-end gap-2">
        <Skeleton className="h-4 w-40 bg-(--sim-line)" />
        <Skeleton className="h-7 w-64 bg-(--sim-line)" />
      </div>
      {panels.map((rows, i) => (
        <div key={i} aria-hidden className="rounded-md border border-(--sim-line) bg-(--sim-panel)">
          <div className="h-11 border-b border-(--sim-line)" />
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex h-[3.25rem] items-center border-b border-(--sim-line) px-4 last:border-0">
              <Skeleton className="h-4 w-1/3 bg-(--sim-line)" />
            </div>
          ))}
        </div>
      ))}
    </PageScroll>
  );
}
