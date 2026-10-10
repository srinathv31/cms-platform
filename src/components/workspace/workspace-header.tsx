import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/server/clock";
import { getWorkspaceHeader } from "@/server/queries/workspace";
import { NameField } from "./name-field";
import { SaveStatus, SaveStopped } from "./save-status";
import { BindDraft } from "./session/workspace-session";
import { StatusRow } from "./status-row";
import { WS } from "./workspace-grid";
import { WorkspaceShare } from "./workspace-share";

// The header is a small grid, so the name can run under the Template ID's column:
//
//   name ......................................  ┐
//   status row .............   TEMPLATE ID       │ SHARE ring (Active only), 76px, spans both rows
//   why saving stopped, and Reload (only then) ..........
//
// The ID sits on the status row's line, as in the layout study, rather than beside the name, so a long
// name keeps nearly the whole width (the ring's column is the only thing it gives up) and wraps to a
// second line only when it must. Draft and Active are the same height: the ring is shorter than the
// two rows, and only a wrapped name, or saving stopping for good (its third line), makes the header grow.
const HEADER = "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-y-1.5";

/** One item of the status row: 16px of left padding, the room a separator takes (and the row pulls back). */
const META_ITEM = "flex shrink-0 items-center pl-4 whitespace-nowrap";

/**
 * Name, then the status row, with the Template ID and (on Active) the SHARE ring at the right.
 * The badge carries the state, so the label beside it never repeats it:
 *   Draft   [Draft] Based on v2 · Saved      Active  [Active] v2      Viewer  [Active] v3 [View only]
 * A draft with nothing earlier to be based on reads [Draft] Saved.
 *
 * It is in the layout, on every tab, so it binds the workspace's autosave session to the draft it
 * shows (`BindDraft`): the name field saves wherever the author renames, and the status says so.
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
      <BindDraft draft={t.draft} />
      <div className="col-span-2 col-start-1 row-start-1 min-w-0">
        <NameField name={t.name} editable={t.editable} />
      </div>
      {/* After a submit or a revert, focus lands here (workspace-actions.tsx, save-status.tsx), where the outcome reads. */}
      {/* The separator sits in its item's left padding, and the items are pulled left by that padding inside the
          row's horizontal clip (as in versions/version-entry.tsx): an item that starts a line has its "·" clipped,
          so a wrap never leaves one dangling at either end of a line. The row's own 6px inset keeps the
          controls' focus rings inside the clip. */}
      <StatusRow
        state={t.status}
        className="col-start-1 row-start-2 -mx-1.5 min-h-7 self-end justify-self-start overflow-x-clip rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="-ml-4 flex min-h-7 flex-wrap items-center gap-y-1.5">
          <span className={META_ITEM}>
            <StatusBadge state={t.status} sunsetDay={t.sunsetDay} now={nowDate} />
          </span>
          {t.versionLabel ? <span className={cn(META_ITEM, "text-[14px] leading-6 text-text-muted")}>{t.versionLabel}</span> : null}
          {t.editable ? (
            <span className={cn(META_ITEM, "relative")}>
              {t.versionLabel ? (
                <span aria-hidden className="absolute left-[5px] text-[14px] leading-6 text-text-subtle">
                  ·
                </span>
              ) : null}
              <SaveStatus templateId={t.id} basedOn={t.basedOn} />
            </span>
          ) : null}
          {!t.canEdit ? (
            <span className={META_ITEM}>
              <Badge variant="outline" className="h-[22px] gap-1.5 border-hairline px-2 text-[12px] font-medium text-text-muted">
                <Eye aria-hidden strokeWidth={1.75} />
                View only
              </Badge>
            </span>
          ) : null}
        </div>
      </StatusRow>
      {/* The value row sits on the status row's line. */}
      <TemplateId id={t.id} className="col-start-2 row-start-2 ml-8 -mb-0.5 self-end" />
      {/* Saving stopped for good: a line of its own, the header's full width. */}
      {t.editable ? <SaveStopped className="col-span-3 col-start-1 row-start-3" /> : null}
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
      <div className="col-start-1 row-start-2 flex min-h-[2.625rem] items-end gap-4 pb-[3px]">
        <Skeleton className="h-[22px] w-20 rounded-md" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}
