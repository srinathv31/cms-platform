import type { Route } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/primitives/page-header";
import { Stream } from "@/components/primitives/stream";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { activeFilterCount, parseAuditFilters } from "@/domain/audit";
import { formatCount } from "@/domain/numbers";
import { plural } from "@/domain/plural";
import { getAuditPage } from "@/server/queries/audit";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { AuditFilterBar } from "./audit-filters";
import { AuditTable } from "./audit-table";
import { AUDIT_CELL as at, AUDIT_ROW, AUDIT_TABLE, CHIP_ROW, auditGrid } from "./columns";
import { cn } from "@/lib/utils";

type TeamParams = Promise<{ team: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(params: TeamParams, searchParams: SearchParams) {
  const { team } = await params;
  return getAuditPage(team, parseAuditFilters(await searchParams));
}

async function SpaceEyebrow({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}

/** The Export button and its skeleton are one width (10.75rem fits "Export 9,999 events"; wider only past that), so nothing shifts as it streams in. */
const EXPORT_WIDTH = "w-[10.75rem] min-w-fit";

/** The Export link follows the filters (same query, no page limit); a download, so a plain anchor. */
async function ExportAction({ params, searchParams }: { params: TeamParams; searchParams: SearchParams }) {
  const data = await load(params, searchParams);
  const label = `Export ${plural(data.total, "event")}`;
  if (data.total === 0) {
    return (
      <Button variant="outline" disabled className={EXPORT_WIDTH}>
        <Download aria-hidden strokeWidth={1.75} data-icon="inline-start" />
        {label}
      </Button>
    );
  }
  return (
    <Button variant="outline" render={<a href={data.csvHref} download />} nativeButton={false} className={EXPORT_WIDTH}>
      <Download aria-hidden strokeWidth={1.75} data-icon="inline-start" />
      {label}
    </Button>
  );
}

async function AuditBody({ params, searchParams }: { params: TeamParams; searchParams: SearchParams }) {
  const data = await load(params, searchParams);
  const basePath = `/${data.space.slug}/audit`;
  const filtered = activeFilterCount(data.applied) > 0;
  const count =
    data.total > data.rows.length
      ? `Newest ${formatCount(data.rows.length)} of ${plural(data.total, "event")}`
      : plural(data.total, "event");
  return (
    <div>
      <AuditFilterBar basePath={basePath} applied={data.applied} options={data.options} clearInEmpty={data.total === 0} />
      {data.rows.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline py-12">
          <p className="text-[15px] text-text-muted">{filtered ? "No events match these filters." : "No events yet."}</p>
          {filtered ? (
            <Button variant="ghost" render={<Link href={basePath as Route} scroll={false} />} nativeButton={false}>
              Clear all
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-4 flex h-6 items-center text-[14px] text-text-muted tabular-nums">{count}</p>
          <AuditTable rows={data.rows} showTeam={data.space.isAll} />
        </>
      )}
    </div>
  );
}

/** Same geometry as the loaded page (menus, count line, header row, rows), so nothing shifts. */
function AuditSkeleton() {
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

export function AuditView({ params, searchParams }: { params: TeamParams; searchParams: SearchParams }) {
  return (
    <div>
      <PageHeader
        title="Audit"
        eyebrow={
          <Stream fallback={<Skeleton className="h-4 w-24" />}>
            <SpaceEyebrow params={params} />
          </Stream>
        }
        action={
          <Stream fallback={<Skeleton className={cn("h-8 rounded-lg", EXPORT_WIDTH)} />}>
            <ExportAction params={params} searchParams={searchParams} />
          </Stream>
        }
        className="pb-5"
      />
      <Stream fallback={<AuditSkeleton />}>
        <AuditBody params={params} searchParams={searchParams} />
      </Stream>
    </div>
  );
}
