import { ReviewQueueView } from "@/components/review-queue/review-queue-view";

export default function ReviewPage({ params }: PageProps<"/[team]/review">) {
  return <ReviewQueueView params={params} />;
}
