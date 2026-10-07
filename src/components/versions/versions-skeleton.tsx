import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { WS } from "@/components/workspace/workspace-grid";
import { ENTRY_GEOMETRY } from "./entry-geometry";

/** The row above the timeline: the Compare button's height and the room below it. The real page has it for every template. */
export const TOOLBAR = "mb-8 flex h-8 justify-end";

/**
 * What the Versions tab shows while the timeline streams in: the toolbar row and three entries on the
 * timeline column, with the heading row, byline and fact rows of a real entry. It is drawn from the same
 * constants as the real entry (the heading row is 32px for every entry), and the toolbar row is there on
 * the real page for every template, so nothing moves when the data arrives.
 */
export function VersionsSkeleton() {
  return (
    <div data-slot="versions" aria-hidden className={cn(WS.doc, "flex flex-col")}>
      <div className={TOOLBAR}>
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
      <div className="flex flex-col">
        {[true, true, false].map((more, i) => (
          <div key={i} className={cn("relative", ENTRY_GEOMETRY.indent, more ? "pb-9" : "pb-0")}>
            <Skeleton className={cn(ENTRY_GEOMETRY.dot, "ring-0")} />
            {more ? <span className={ENTRY_GEOMETRY.line} /> : null}
            <div className={ENTRY_GEOMETRY.head}>
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-[22px] w-24 rounded-md" />
            </div>
            <div className="mt-0.5 flex h-5 items-center gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-52" />
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {["w-4/5", "w-3/5", "w-2/3"].map((width) => (
                // A fact row is 24px (the text's line height); its bar is the text's height.
                <div key={width} className="flex h-6 items-center">
                  <Skeleton className={cn("h-4", width)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
