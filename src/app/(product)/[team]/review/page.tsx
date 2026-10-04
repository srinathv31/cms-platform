import { PagePlaceholder } from "@/components/app-shell/page-placeholder";

export default function ReviewPage({ params }: PageProps<"/[team]/review">) {
  return <PagePlaceholder title="Review" params={params} />;
}
