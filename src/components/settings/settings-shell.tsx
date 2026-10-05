import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSpaceFromParams, settingsAccessFor } from "@/server/queries/spaces";
import { SettingsDialog } from "./settings-dialog";
import { SettingsNavList } from "./settings-nav-list";
import { visibleGroups } from "./sections";
import { getTeamNavTrails } from "./team/nav-counts";

type TeamParams = Promise<{ team: string }>;

/** Which groups this viewer may use. Streams; bounces anyone with no settings access. */
async function SettingsNav({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  const access = settingsAccessFor(space.viewer, space.slug);
  if (visibleGroups(access).length === 0) redirect(`/${space.slug}/library`);
  const trails = access.team ? await getTeamNavTrails(space.slug) : {};
  return <SettingsNavList teamSlug={space.slug} access={access} trails={trails} />;
}

function SettingsNavSkeleton() {
  return (
    <div aria-hidden className="flex flex-1 flex-col px-4 pt-7 pb-5">
      <div className="px-3 pb-2.5">
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-3 px-3">
            <Skeleton className="size-5 rounded-md" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <p className="mt-auto px-3 pt-6 text-[13px] text-text-muted">UCOMP · v0.1 prototype</p>
    </div>
  );
}

/**
 * The dialog chrome for both settings routes. The frame itself is static (so the section page
 * renders into it); only the nav depends on the viewer, and it streams.
 */
export function SettingsShell({
  params,
  closeMode,
  children,
}: {
  params: TeamParams;
  closeMode: "back" | "library";
  children: React.ReactNode;
}) {
  return (
    <SettingsDialog
      closeMode={closeMode}
      nav={
        <Suspense fallback={<SettingsNavSkeleton />}>
          <SettingsNav params={params} />
        </Suspense>
      }
    >
      {children}
    </SettingsDialog>
  );
}
