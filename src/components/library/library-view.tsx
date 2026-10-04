import Link from "next/link";
import type { Route } from "next";
import { FilePlus2 } from "lucide-react";
import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { can } from "@/domain/permissions";
import { getLibraryRows, type LibraryRow } from "@/server/queries/library";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { cn } from "@/lib/utils";

type TeamParams = Promise<{ team: string }>;

// Column geometry is shared by the header row, the rows and the skeleton, so they always line up.
// The fixed columns are sized to their content (widest badge is "Changes requested", 148px) so the
// name column keeps at least ~250px at 1280 wide, even with the Team column in "All teams".
const COLUMNS_TEAM = "grid-cols-[minmax(0,1fr)_7rem_9.5rem_3.5rem_6.5rem_8.5rem]";
const COLUMNS = "grid-cols-[minmax(0,1fr)_9.5rem_3.5rem_6.5rem_8.5rem]";
const ROW = "-mx-4 grid items-center gap-x-5 px-4";

async function SpaceEyebrow({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}

async function NewTemplateAction({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  if (!can(space.viewer, "template.create", { teamId: space.teamId }).ok) return null;
  // Phase 2 wires this to the starter gallery.
  return (
    <Button size="lg" className="h-10 rounded-full px-5 text-[14px]">
      New template
    </Button>
  );
}

function ListHeader({ showTeam }: { showTeam: boolean }) {
  return (
    <div aria-hidden className="border-b border-hairline">
      <div className={cn(ROW, "h-10", showTeam ? COLUMNS_TEAM : COLUMNS)}>
        <span className="caps-label">Template</span>
        {showTeam ? <span className="caps-label">Team</span> : null}
        <span className="caps-label">Status</span>
        <span className="caps-label">Active</span>
        <span className="caps-label">Last edited</span>
        <span className="caps-label">Owner</span>
      </div>
    </div>
  );
}

function TemplateRow({ row, space, showTeam }: { row: LibraryRow; space: string; showTeam: boolean }) {
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={`/${space}/templates/${row.id}` as Route}
        className={cn(
          ROW,
          "min-h-[4.25rem] rounded-xl py-3 text-[14px] outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          showTeam ? COLUMNS_TEAM : COLUMNS,
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-5 font-medium">{row.name}</span>
          <span className="mt-0.5 block font-mono text-xs leading-4 text-text-subtle">{row.id}</span>
        </span>
        {showTeam ? (
          <span className="truncate text-text-muted">{row.teamName}</span>
        ) : null}
        <span>
          <StatusBadge state={row.status} sunsetAt={row.sunsetAt} />
        </span>
        <span className="text-text tabular-nums">
          {row.activeNumber !== null ? `v${row.activeNumber}` : <span className="text-text-subtle">—</span>}
        </span>
        <span className="text-text-muted">{row.lastEdited}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          <UserAvatar initials={row.owner.initials} hue={row.owner.hue} size="sm" />
          <span className="truncate">{row.owner.name}</span>
        </span>
      </Link>
    </li>
  );
}

async function LibraryList({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  const rows = await getLibraryRows(space.slug);
  const showTeam = space.isAll;
  const canCreate = can(space.viewer, "template.create", { teamId: space.teamId }).ok;

  if (rows.length === 0) {
    return (
      <Empty className="min-h-80 rounded-2xl border border-dashed border-hairline-strong bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-xl bg-surface-tinted text-text-muted">
            <FilePlus2 aria-hidden strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle className="font-normal text-text-muted">No templates yet</EmptyTitle>
        </EmptyHeader>
        {canCreate ? (
          <Button variant="outline" size="lg" className="rounded-full bg-surface px-4">
            New template
          </Button>
        ) : null}
      </Empty>
    );
  }

  return (
    <div>
      <ListHeader showTeam={showTeam} />
      <ul>
        {rows.map((row) => (
          <TemplateRow key={row.id} row={row} space={space.slug} showTeam={showTeam} />
        ))}
      </ul>
    </div>
  );
}

function LibraryListSkeleton() {
  return (
    <div aria-hidden>
      <div className="border-b border-hairline">
        <div className={cn(ROW, "h-10", COLUMNS)}>
          <span className="caps-label">Template</span>
          <span className="caps-label">Status</span>
          <span className="caps-label">Active</span>
          <span className="caps-label">Last edited</span>
          <span className="caps-label">Owner</span>
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-b border-hairline last:border-b-0">
          <div className={cn(ROW, "min-h-[4.25rem] py-3", COLUMNS)}>
            <span>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </span>
            <Skeleton className="h-[22px] w-24 rounded-md" />
            <Skeleton className="h-4 w-7" />
            <Skeleton className="h-4 w-20" />
            <span className="flex items-center gap-2.5">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The library page body. Rendered by the library route and under the hard-navigation settings fallback. */
export function LibraryView({ params }: { params: TeamParams }) {
  return (
    <div>
      <PageHeader
        title="Library"
        eyebrow={
          <Stream fallback={<Skeleton className="h-4 w-24" />}>
            <SpaceEyebrow params={params} />
          </Stream>
        }
        action={
          <Stream fallback={null}>
            <NewTemplateAction params={params} />
          </Stream>
        }
      />
      <Stream fallback={<LibraryListSkeleton />}>
        <LibraryList params={params} />
      </Stream>
    </div>
  );
}
