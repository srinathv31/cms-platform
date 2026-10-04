import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getWorkspaceHeader } from "@/server/queries/workspace";
import { TemplateId } from "@/components/primitives/template-id";
import { WorkspaceShare } from "./workspace-share";

// Height is fixed at 6.5rem (the 5rem SHARE ring plus the 1.5rem gap below), so Active and
// non-Active templates, and the skeleton, are all the same height.
const HEADER = "flex min-h-26 items-start justify-between gap-8 pb-6";

export async function WorkspaceHeader({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const t = await getWorkspaceHeader(team, templateId);

  return (
    <header className={HEADER}>
      <div className="min-w-0">
        <h1 className="display-lg truncate text-text">{t.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusBadge state={t.status} sunsetAt={t.sunsetAt} />
          <span className="text-[14px] text-text-muted">{t.versionLabel}</span>
          {!t.canEdit ? (
            <Badge variant="outline" className="h-[22px] gap-1.5 border-hairline px-2 text-[12px] font-medium text-text-muted">
              <Eye aria-hidden strokeWidth={1.75} />
              View only
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-8">
        <TemplateId id={t.id} />
        {t.activeNumber !== null ? (
          // The SHARE signature: Active versions only.
          <div data-slot="share" className="flex size-20 shrink-0 items-center justify-center">
            <WorkspaceShare templateId={t.id} templateName={t.name} activeVersion={t.activeNumber} />
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Title bar, then the ID / status / version row. Same rhythm as the header. */
export function WorkspaceHeaderSkeleton() {
  return (
    <div aria-hidden className={HEADER}>
      <div className="min-w-0">
        <Skeleton className="my-[3px] h-7 w-72" />
        <div className="mt-2 flex min-h-6 items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[22px] w-20 rounded-md" />
          <Skeleton className="h-4 w-10" />
        </div>
      </div>
    </div>
  );
}
