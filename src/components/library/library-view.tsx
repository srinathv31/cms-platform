import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/domain/permissions";
import { getLibraryRows } from "@/server/queries/library";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { cn } from "@/lib/utils";
import { COLUMNS, ROW, statusColumn } from "./columns";
import { LibraryBrowser } from "./library-browser";
import { NewTemplate } from "./new-template";

type TeamParams = Promise<{ team: string }>;

async function SpaceEyebrow({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}

/** Whether the viewer may create templates here. "All teams" has no team to create in. */
async function canCreateIn(params: TeamParams) {
  const space = await requireSpaceFromParams(params);
  const ok = !space.isAll && space.teamId !== null && can(space.viewer, "template.create", { teamId: space.teamId }).ok;
  return { space, ok };
}

/** The screen's one primary button. */
async function NewTemplateAction({ params }: { params: TeamParams }) {
  const { space, ok } = await canCreateIn(params);
  return ok ? <NewTemplate teamSlug={space.slug} /> : null;
}

async function LibraryList({ params }: { params: TeamParams }) {
  const { space, ok } = await canCreateIn(params);
  const rows = await getLibraryRows(space.slug);
  return <LibraryBrowser rows={rows} spaceSlug={space.slug} showTeam={space.isAll} canCreate={ok} />;
}

/** Same geometry as the loaded list (toolbar, header row, six rows), so nothing shifts when it streams in. */
function LibraryListSkeleton() {
  return (
    <div aria-hidden style={statusColumn(false)}>
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 pb-4">
        <Skeleton className="h-9 w-72 rounded-full" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-14 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
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
