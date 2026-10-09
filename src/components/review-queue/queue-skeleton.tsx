import { cn } from "@/lib/utils";
import { TAB, TAB_LABEL } from "@/components/primitives/tab-styles";
import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS, FOLDS, ROW, ROW_HEIGHT } from "./columns";
import { TAB_META } from "./format-row";
import { TAB_BAR } from "./tab-styles";

/** Same geometry as the loaded list (tab bar, header row, four rows), so nothing shifts when it streams in. */
export function QueueSkeleton() {
  return (
    <div aria-hidden>
      <div className={TAB_BAR}>
        {Object.values(TAB_META).map(({ label }) => (
          <span key={label} className={cn(TAB, "text-text-muted")}>
            <span className={TAB_LABEL}>
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
