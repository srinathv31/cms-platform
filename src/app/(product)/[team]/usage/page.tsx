import { PageHeader } from "@/components/primitives/page-header";
import { Stream } from "@/components/primitives/stream";
import { Skeleton } from "@/components/ui/skeleton";
import { UsageDashboardContent } from "@/components/usage/usage-dashboard";
import { UsageEyebrow } from "@/components/usage/usage-eyebrow";
import { UsageSkeleton } from "@/components/usage/usage-skeleton";

// Usage: how the team's templates are rendered by the systems that use them. Overview and Consumers.
export default function UsagePage({ params, searchParams }: PageProps<"/[team]/usage">) {
  return (
    <div>
      <PageHeader
        title="Usage"
        eyebrow={
          <Stream fallback={<Skeleton className="h-4 w-24" />}>
            <UsageEyebrow params={params} />
          </Stream>
        }
      />
      <Stream fallback={<UsageSkeleton />}>
        <UsageDashboardContent params={params} searchParams={searchParams} />
      </Stream>
    </div>
  );
}
