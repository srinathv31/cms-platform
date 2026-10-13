import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getLibrary } from "@/server/queries/library";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { cn } from "@/lib/utils";
import {
  COLUMNS,
  FOLDS,
  NAME_CELL,
  ROW,
  STACKED_HIDDEN,
  statusColumn,
} from "./columns";
import { LibraryBrowser } from "./library-browser";
import { NewTemplate } from "./new-template";

type TeamParams = Promise<{ team: string }>;

async function SpaceEyebrow({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}

/**
 * The screen's one primary button. Whether the viewer may create here is the Library read's to say ("All teams"
 * has no team to create in); the read is cached, so the list below shares it.
 */
async function NewTemplateAction({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  const { canCreate } = await getLibrary(space.slug);
  return canCreate ? <NewTemplate teamSlug={space.slug} /> : null;
}

async function LibraryList({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  const { rows, canCreate, asOf } = await getLibrary(space.slug);
  return (
    <LibraryBrowser
      rows={rows}
      spaceSlug={space.slug}
      showTeam={space.isAll}
      canCreate={canCreate}
      nowIso={asOf}
    />
  );
}

/** Same geometry as the loaded list (toolbar, header row, six rows), so nothing shifts when it streams in. */
function LibraryListSkeleton() {
  return (
    <div aria-hidden style={statusColumn("default")}>
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 pb-4">
        <Skeleton className="h-9 w-72 rounded-full" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-14 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
      <div className={cn("border-b border-hairline", STACKED_HIDDEN)}>
        <div className={cn(ROW, "h-10", COLUMNS)}>
          <span className="caps-label">Template</span>
          <span className="caps-label">Status</span>
          <span className="caps-label">Active</span>
          <span className={cn("caps-label", FOLDS)}>Last edited</span>
          <span className={cn("caps-label", FOLDS)}>Owner</span>
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-b border-hairline last:border-b-0">
          <div className={cn(ROW, "min-h-[4.25rem] py-3", COLUMNS)}>
            <span className={NAME_CELL}>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-1.5 h-3 w-36" />
            </span>
            <Skeleton className="h-[22px] w-24 rounded-md" />
            <Skeleton className="h-4 w-7" />
            <Skeleton className={cn("h-4 w-20", FOLDS)} />
            <span className={cn("flex items-center gap-2.5", FOLDS)}>
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
