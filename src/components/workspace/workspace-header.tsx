import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/server/clock";
import { getWorkspaceHeader } from "@/server/queries/workspace";
import { NameField } from "./name-field";
import { SaveStatus } from "./save-status";
import { WS } from "./workspace-grid";
import { WorkspaceShare } from "./workspace-share";

// The header is a small grid, so the name can run under the Template ID's column:
//
//   name ......................................  ┐
//   status row .............   TEMPLATE ID       │ SHARE ring (Active only), 76px, spans both rows
//
// The ID sits on the status row's line, as in the layout study, rather than beside the name, so a long
// name keeps nearly the whole width (the ring's column is the only thing it gives up) and wraps to a
// second line only when it must. Draft and Active are the same height: the ring is shorter than the
// two rows, and a wrapped name is the only thing that makes the header grow.
const HEADER = "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-y-1.5";

/**
 * Name, then the status row, with the Template ID and (on Active) the SHARE ring at the right.
 * The badge carries the state, so the label beside it never repeats it:
 *   Draft   [Draft] Based on v2 · Saved      Active  [Active] v2      Viewer  [Active] v3 [View only]
 * A draft with nothing earlier to be based on reads [Draft] Saved.
 */
export async function WorkspaceHeader({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const t = await getWorkspaceHeader(team, templateId);
  const nowDate = await now();

  return (
    <header className={cn(WS.header, HEADER)}>
      <div className="col-span-2 col-start-1 row-start-1 min-w-0">
        <NameField name={t.name} editable={t.editable} />
      </div>
      {/* tabIndex -1: after a submit, focus lands here (workspace-actions.tsx), where the new state reads. */}
      <div
        data-slot="status-row"
        role="group"
        aria-label="Status"
        tabIndex={-1}
        className="col-start-1 row-start-2 -mx-1.5 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5 self-end justify-self-start rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StatusBadge state={t.status} sunsetAt={t.sunsetAt} now={nowDate} />
        {t.versionLabel ? <span className="text-[14px] leading-6 text-text-muted">{t.versionLabel}</span> : null}
        {t.editable ? (
          <>
            {t.versionLabel ? (
              <span aria-hidden className="-mx-1.5 text-text-subtle">
                ·
              </span>
            ) : null}
            <SaveStatus templateId={t.id} basedOn={t.basedOnNumber} activeNumber={t.activeNumber} />
          </>
        ) : null}
        {!t.canEdit ? (
          <Badge variant="outline" className="h-[22px] gap-1.5 border-hairline px-2 text-[12px] font-medium text-text-muted">
            <Eye aria-hidden strokeWidth={1.75} />
            View only
          </Badge>
        ) : null}
      </div>
      {/* The value row sits on the status row's line. */}
      <TemplateId id={t.id} className="col-start-2 row-start-2 ml-8 -mb-0.5 self-end" />
      {t.activeNumber !== null ? (
        // The SHARE signature: Active versions only. It shows what consumers get, so the Active version's name.
        <div data-slot="share" className="col-start-3 row-span-2 row-start-1 ml-6 flex size-19 shrink-0 items-center justify-center self-start">
          <WorkspaceShare templateId={t.id} templateName={t.activeName ?? t.name} activeVersion={t.activeNumber} />
        </div>
      ) : null}
    </header>
  );
}

/** Name line and status row, same rows as the header. */
export function WorkspaceHeaderSkeleton() {
  return (
    <div aria-hidden className={cn(WS.header, HEADER)}>
      <Skeleton className="col-span-2 col-start-1 row-start-1 my-[3px] h-7 w-72" />
      <div className="col-start-1 row-start-2 flex min-h-[2.625rem] items-end gap-3 pb-[3px]">
        <Skeleton className="h-[22px] w-20 rounded-md" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}
