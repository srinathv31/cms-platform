import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "./panel";
import { TEMPLATE_BARS_HEIGHT, USAGE_CELL, USAGE_COLUMNS } from "./template-usage";

/** The Usage tab while it streams: the chart card, the two number cards and the table's card. */
export function TemplateUsageSkeleton() {
  return (
    <div data-slot="usage" aria-hidden className={USAGE_CELL}>
      <div className={USAGE_COLUMNS}>
        <Panel>
          <div className="flex min-h-9 items-center justify-between">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="mt-2 h-5" />
          <Skeleton className="mt-4 w-full" style={{ height: TEMPLATE_BARS_HEIGHT }} />
        </Panel>
        <div className="grid grid-rows-[auto_1fr] gap-6">
          <Panel>
            <Skeleton className="h-10 w-28" />
            <div className="mt-3 flex h-[18px] items-center">
              <Skeleton className="h-3 w-32" />
            </div>
          </Panel>
          <Panel>
            <Skeleton className="h-10 w-20" />
            <div className="mt-3 flex h-4 items-center">
              <Skeleton className="h-3 w-24" />
            </div>
          </Panel>
        </div>
      </div>
      <Panel className="mt-6">
        <div className="flex min-h-9 items-center">
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="mt-3 h-[9.625rem] w-full" />
      </Panel>
    </div>
  );
}
