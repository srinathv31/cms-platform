import type { Route } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { EyebrowSkeleton } from "@/components/primitives/page-header";
import { Stream } from "@/components/primitives/stream";
import { Button } from "@/components/ui/button";
import { activeFilterCount, parseAuditFilters } from "@/domain/audit";
import { getAuditPage } from "@/server/queries/audit";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { AuditFilterBar } from "./audit-filters";
import { AuditFrame, AuditSkeleton, EXPORT_WIDTH, ExportSkeleton } from "./audit-skeleton";
import { AuditTable } from "./audit-table";

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

/** The Export link follows the filters (same query, no page limit); a download, so a plain anchor. */
async function ExportAction({ params, searchParams }: { params: TeamParams; searchParams: SearchParams }) {
  const data = await load(params, searchParams);
  const label = `Export ${data.total} ${data.total === 1 ? "event" : "events"}`;
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
      ? `Newest ${data.rows.length} of ${data.total} events`
      : `${data.total} ${data.total === 1 ? "event" : "events"}`;
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

export function AuditView({ params, searchParams }: { params: TeamParams; searchParams: SearchParams }) {
  return (
    <AuditFrame
      eyebrow={
        <Stream fallback={<EyebrowSkeleton />}>
          <SpaceEyebrow params={params} />
        </Stream>
      }
      action={
        <Stream fallback={<ExportSkeleton />}>
          <ExportAction params={params} searchParams={searchParams} />
        </Stream>
      }
    >
      <Stream fallback={<AuditSkeleton />}>
        <AuditBody params={params} searchParams={searchParams} />
      </Stream>
    </AuditFrame>
  );
}
