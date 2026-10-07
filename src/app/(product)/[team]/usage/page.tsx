import { EyebrowSkeleton } from "@/components/primitives/page-header";
import { Stream } from "@/components/primitives/stream";
import { UsageDashboardContent } from "@/components/usage/usage-dashboard";
import { UsageEyebrow } from "@/components/usage/usage-eyebrow";
import { UsageFrame, UsageSkeleton } from "@/components/usage/usage-skeleton";

// Usage: how the team's templates are rendered by the systems that use them. Overview and Consumers.
export default function UsagePage({ params, searchParams }: PageProps<"/[team]/usage">) {
  return (
    <UsageFrame
      eyebrow={
        <Stream fallback={<EyebrowSkeleton />}>
          <UsageEyebrow params={params} />
        </Stream>
      }
    >
      <Stream fallback={<UsageSkeleton />}>
        <UsageDashboardContent params={params} searchParams={searchParams} />
      </Stream>
    </UsageFrame>
  );
}
