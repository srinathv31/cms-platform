import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { RequestAccess } from "@/components/access/request-access";
import { Skeleton } from "@/components/ui/skeleton";
import { REASONS, can } from "@/domain/permissions";
import { getRequestAccessData } from "@/server/queries/access";
import { getViewer } from "@/server/viewer";

const CARD = "rounded-2xl border border-hairline bg-surface-tinted p-6";

async function Teams() {
  // The Auditor holds no team role, so there is nothing to ask for: say so instead of offering forms.
  if (!can(await getViewer(), "access.request").ok) {
    return <p className="max-w-[40rem] text-[14px] text-text-muted">{REASONS.auditorReadOnly}</p>;
  }
  return <RequestAccess data={await getRequestAccessData()} />;
}

function TeamsSkeleton() {
  return (
    <div className="flex max-w-[40rem] flex-col gap-4" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={`${CARD} flex items-start gap-4`}>
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2.5 h-3.5 w-full" />
            <Skeleton className="mt-3 h-3 w-40" />
          </div>
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export default function RequestAccessPage() {
  return (
    <div>
      <PageHeader title="Request access" />
      <Stream fallback={<TeamsSkeleton />}>
        <Teams />
      </Stream>
    </div>
  );
}
