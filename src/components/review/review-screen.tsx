import { Stream } from "@/components/primitives/stream";
import { now } from "@/server/clock";
import { getReviewScreen } from "@/server/queries/review";
import { getPeople, personOf } from "@/server/queries/review-shared";
import { getViewer } from "@/server/viewer";
import { RV } from "./review-grid";
import { ReviewSkeleton } from "./review-skeleton";
import { ReviewWorkspace } from "./review-workspace";

type Params = Promise<{ team: string; templateId: string; version: string }>;

async function ReviewData({ params }: { params: Params }) {
  const { team, templateId, version } = await params;
  // 404 for a template or a version that doesn't exist or that the viewer can't see.
  const data = await getReviewScreen(team, templateId, Number(version));
  const nowDate = await now();
  // Who is looking, for the comments they write (shown with their name at once, before the server confirms them).
  const viewer = await getViewer();
  const me = personOf(await getPeople(), viewer.userId);
  // A different version is a different screen: its own document, threads and dialogs.
  return <ReviewWorkspace key={data.version.id} data={data} team={team} nowIso={nowDate.toISOString()} viewer={me} />;
}

/**
 * /{team}/review/{templateId}/{version}: one version under review, read-only, with the decision rail
 * beside it. The grid is static; everything that depends on who is looking streams in under a
 * skeleton with the same cells.
 */
export function ReviewScreen({ params }: { params: Params }) {
  return (
    <div data-slot="review" className={RV.grid}>
      <Stream fallback={<ReviewSkeleton />}>
        <ReviewData params={params} />
      </Stream>
    </div>
  );
}
