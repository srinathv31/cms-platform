import { ActivityContent } from "@/components/activity/activity-content";
import { ActivitySkeleton } from "@/components/activity/activity-skeleton";
import { Stream } from "@/components/primitives/stream";

// Activity tab: the template's history as plain sentences, newest first, grouped by day. The
// document cell of the workspace grid (see workspace-grid.ts); the rail column stays reserved.
export default function TemplateActivityPage({
  params,
}: PageProps<"/[team]/templates/[templateId]/activity">) {
  return (
    <Stream fallback={<ActivitySkeleton />}>
      <ActivityContent params={params} />
    </Stream>
  );
}
