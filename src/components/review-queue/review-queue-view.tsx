import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/server/clock";
import { getReviewQueue } from "@/server/queries/review";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { queueTabs } from "./format-row";
import { QueueSkeleton } from "./queue-skeleton";
import { ReviewQueueTabs } from "./review-queue-tabs";

type TeamParams = Promise<{ team: string }>;

async function SpaceEyebrow({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}

async function Queue({ params }: { params: TeamParams }) {
  const space = await requireSpaceFromParams(params);
  const queue = await getReviewQueue(space.slug);
  const nowDate = await now();
  return <ReviewQueueTabs tabs={queueTabs(queue, space.slug, nowDate)} showTeam={space.isAll} />;
}

/** The review queue page: /{team}/review. The title is static; the list streams in under its skeleton. */
export function ReviewQueueView({ params }: { params: TeamParams }) {
  return (
    <div>
      <PageHeader
        title="Review"
        eyebrow={
          <Stream fallback={<Skeleton className="h-4 w-24" />}>
            <SpaceEyebrow params={params} />
          </Stream>
        }
      />
      <Stream fallback={<QueueSkeleton />}>
        <Queue params={params} />
      </Stream>
    </div>
  );
}
