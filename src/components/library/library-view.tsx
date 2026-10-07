import { Stream } from "@/components/primitives/stream";
import { EyebrowSkeleton } from "@/components/primitives/page-header";
import { can } from "@/domain/permissions";
import { now } from "@/server/clock";
import { getLibraryRows } from "@/server/queries/library";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { LibraryBrowser } from "./library-browser";
import { LibraryFrame, LibraryListSkeleton } from "./library-skeleton";
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
  const nowIso = (await now()).toISOString();
  return <LibraryBrowser rows={rows} spaceSlug={space.slug} showTeam={space.isAll} canCreate={ok} nowIso={nowIso} />;
}

/** The library page body. Rendered by the library route and under the hard-navigation settings fallback. */
export function LibraryView({ params }: { params: TeamParams }) {
  return (
    <LibraryFrame
      eyebrow={
        <Stream fallback={<EyebrowSkeleton />}>
          <SpaceEyebrow params={params} />
        </Stream>
      }
      action={
        <Stream fallback={null}>
          <NewTemplateAction params={params} />
        </Stream>
      }
    >
      <Stream fallback={<LibraryListSkeleton />}>
        <LibraryList params={params} />
      </Stream>
    </LibraryFrame>
  );
}
