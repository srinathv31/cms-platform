import { ReviewScreen } from "@/components/review/review-screen";

export default function ReviewVersionPage({ params, searchParams }: PageProps<"/[team]/review/[templateId]/[version]">) {
  return <ReviewScreen params={params} searchParams={searchParams} />;
}
