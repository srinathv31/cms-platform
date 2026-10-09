import { TAB, TAB_ACTIVE, TAB_LABEL, TAB_UNDERLINE } from "@/components/primitives/tab-styles";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { heatmapBox } from "./charts";
import { BARS_HEIGHT, RATE_HEIGHT, STAT_CARD, TOP_TEMPLATES } from "./geometry";
import { Panel } from "./panel";
import { HEATMAP_WEEKS } from "@/domain/golive-types";

// The Usage dashboard while it streams: the tab labels, and the Overview's cards with the real
// geometry (same cards, same chart heights, the heatmap at its real aspect ratio).

export function UsageTabsSkeleton() {
  return (
    <div aria-hidden className="flex gap-7 border-b border-hairline">
      <span className={cn(TAB, TAB_ACTIVE)}>
        <span className={TAB_LABEL}>Overview</span>
        <span className={TAB_UNDERLINE} />
      </span>
      <span className={cn(TAB, "text-text-muted")}>
        <span className={TAB_LABEL}>Consumers</span>
      </span>
    </div>
  );
}

function HeadSkeleton({ aside = true }: { aside?: boolean }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <Skeleton className="h-6 w-40" />
      {aside ? <Skeleton className="h-3 w-24" /> : null}
    </div>
  );
}

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Panel className={cn(STAT_CARD, className)}>
      <Skeleton className="h-10 w-28" />
      <Skeleton className="mt-3 h-3 w-40" />
      <Skeleton className="mt-6 h-16 w-full" />
    </Panel>
  );
}

export function UsageSkeleton() {
  const heat = heatmapBox(HEATMAP_WEEKS);
  return (
    <div aria-hidden>
      <UsageTabsSkeleton />
      <div className="mt-9 grid gap-6 lg:grid-cols-6">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <Panel className="lg:col-span-3">
          <HeadSkeleton />
          <div className="mt-7 flex flex-col gap-4">
            {Array.from({ length: TOP_TEMPLATES }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex h-[1.125rem] items-center">
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-9" style={{ width: `${100 - i * 14}%` }} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="lg:col-span-3">
          <HeadSkeleton />
          <div className="flex flex-1 items-center py-6">
            <div className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)] grid-rows-[1.25rem_auto]">
              <div />
              <div />
              <div />
              <Skeleton className="w-full" style={{ aspectRatio: `${heat.width} / ${heat.height}` }} />
            </div>
          </div>
          <div className="h-5" />
        </Panel>
        <Panel className="lg:col-span-4">
          <HeadSkeleton />
          <Skeleton className="mt-5 w-full" style={{ height: BARS_HEIGHT }} />
          <div className="mt-3 h-5" />
        </Panel>
        <Panel className="lg:col-span-2">
          <HeadSkeleton />
          <Skeleton className="mt-5 w-full" style={{ height: RATE_HEIGHT }} />
        </Panel>
      </div>
    </div>
  );
}
