import { notFound } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { parseRoundParam } from "@/domain/rounds";
import { getReviewScreen } from "@/server/queries/review";
import { RV } from "./review-grid";
import { ReviewSkeleton } from "./review-skeleton";
import { ReviewWorkspace } from "./review-workspace";

type Params = Promise<{ team: string; templateId: string; version: string }>;
type SearchParams = Promise<{ round?: string | string[] }>;

async function ReviewData({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { team, templateId, version } = await params;
  // `?round=N` is that round; without it, the number's head (its released row, else its latest round).
  const round = parseRoundParam((await searchParams).round);
  if (round === "invalid") notFound();
  // 404 for a template, a version or a round that doesn't exist or that the viewer can't see.
  const data = await getReviewScreen(team, templateId, Number(version), round);
  // A different version or round is a different screen: its own document, threads and dialogs. Its relative
  // times count from the instant the backend decided the screen at (`data.now`); `data.viewer` is who is
  // looking, for the comments they write (shown with their name at once, before the server confirms them).
  return (
    <ReviewWorkspace
      key={data.version.id}
      data={data}
      team={team}
      nowIso={data.now}
      viewer={data.viewer}
    />
  );
}

/**
 * /{team}/review/{templateId}/{version}?round=N: one round of a version under review, read-only, with
 * the decision rail beside it. The grid is static; everything that depends on who is looking (and the
 * search params) streams in under a skeleton with the same cells.
 */
export function ReviewScreen({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <div data-slot="review" className={RV.grid}>
      <Stream fallback={<ReviewSkeleton />}>
        <ReviewData params={params} searchParams={searchParams} />
      </Stream>
    </div>
  );
}
