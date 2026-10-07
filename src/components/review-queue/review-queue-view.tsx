import { Stream } from "@/components/primitives/stream";
import { EyebrowSkeleton } from "@/components/primitives/page-header";
import { now } from "@/server/clock";
import { getReviewQueue } from "@/server/queries/review";
import { requireSpaceFromParams } from "@/server/queries/spaces";
import { queueTabs } from "./format-row";
import { QueueSkeleton, ReviewQueueFrame } from "./queue-skeleton";
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
    <ReviewQueueFrame
      eyebrow={
        <Stream fallback={<EyebrowSkeleton />}>
          <SpaceEyebrow params={params} />
        </Stream>
      }
    >
      <Stream fallback={<QueueSkeleton />}>
        <Queue params={params} />
      </Stream>
    </ReviewQueueFrame>
  );
}
