import { notFound } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/domain/permissions";
import { requireSpaceFromParams } from "@/server/queries/spaces";

type TeamParams = Promise<{ team: string }>;

async function SpaceEyebrow({
  params,
  requireAudit,
}: {
  params: TeamParams;
  requireAudit?: boolean;
}) {
  const space = await requireSpaceFromParams(params);
  if (requireAudit && !can(space.viewer, "audit.view", { teamId: space.teamId }).ok) notFound();
  return <>{space.name}</>;
}

/** A page that exists in the shell but is built in a later phase: serif title and a calm, empty canvas. */
export function PagePlaceholder({
  title,
  params,
  requireAudit,
}: {
  title: string;
  params: TeamParams;
  requireAudit?: boolean;
}) {
  return (
    <div>
      <PageHeader
        title={title}
        eyebrow={
          <Stream fallback={<Skeleton className="h-4 w-24" />}>
            <SpaceEyebrow params={params} requireAudit={requireAudit} />
          </Stream>
        }
      />
      <div className="min-h-[24rem] rounded-2xl border border-hairline bg-surface-tinted/60" />
    </div>
  );
}
