import { PagePlaceholder } from "@/components/app-shell/page-placeholder";

export default function UsagePage({ params }: PageProps<"/[team]/usage">) {
  return <PagePlaceholder title="Usage" params={params} />;
}
