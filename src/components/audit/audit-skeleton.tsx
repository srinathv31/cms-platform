import { cn } from "@/lib/utils";
import { EyebrowSkeleton, PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AUDIT_CELL as at, AUDIT_ROW, AUDIT_TABLE, CHIP_ROW, auditGrid } from "./columns";

// The Audit page's frame and its skeletons, with nothing from the server: the page streams real content
// into the frame's slots, and the frame's pending view (app-shell/pending-views.tsx) fills them with
// these, so the two can't drift apart.

/** The Export button and its skeleton are one width (10.5rem fits "Export 9999 events"; wider only past that), so nothing shifts as it streams in. */
export const EXPORT_WIDTH = "w-[10.5rem] min-w-fit";

/** Serif title, the space's name above it, Export at the right, then the log. */
export function AuditFrame({
  eyebrow,
  action,
  children,
}: {
  eyebrow: React.ReactNode;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title="Audit" eyebrow={eyebrow} action={action} className="pb-5" />
      {children}
    </div>
  );
}

export function ExportSkeleton() {
  return <Skeleton className={cn("h-8 rounded-lg", EXPORT_WIDTH)} />;
}

/** Same geometry as the loaded page (menus, count line, header row, rows), so nothing shifts. */
export function AuditSkeleton() {
  // The team column shows only in All teams; the skeleton can't know yet, so it draws the wider grid.
  const grid = auditGrid(true);
  return (
    <div aria-hidden className={AUDIT_TABLE}>
      <div className="flex gap-2">
        {["w-20", "w-24", "w-24", "w-28", "w-20"].map((w, i) => (
          <Skeleton key={i} className={cn("h-8 rounded-lg", w)} />
        ))}
      </div>
      <div className={CHIP_ROW} />
      <div className="mt-4 flex h-6 items-center">
        <Skeleton className="h-4 w-20" />
      </div>
      <div className={cn("min-h-9 items-center border-b border-hairline py-1.5", grid)}>
        <Skeleton className={cn("h-3 w-10", at.when)} />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={cn("items-center border-b border-hairline py-2", grid, AUDIT_ROW)}>
          <span className={at.when}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1 h-3 w-16" />
          </span>
          <span className={cn("flex items-center gap-2", at.who)}>
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </span>
          <Skeleton className={cn("h-4 w-14", at.team)} />
          <span className={at.tpl}>
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="mt-1 h-3 w-24 max-w-full" />
          </span>
          <Skeleton className={cn("h-4 w-20", at.act)} />
          <Skeleton className={cn("h-4 w-4/5", at.det)} />
        </div>
      ))}
    </div>
  );
}

/** The page before anything has streamed: what its static shell shows. */
export function AuditPageSkeleton() {
  return (
    <AuditFrame eyebrow={<EyebrowSkeleton />} action={<ExportSkeleton />}>
      <AuditSkeleton />
    </AuditFrame>
  );
}
