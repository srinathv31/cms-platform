import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import type { AuditRow } from "@/domain/access-types";
import { SYSTEM_ACTOR } from "@/domain/activity";
import { formatStamp } from "@/domain/dates";
import { AUDIT_CELL as at, AUDIT_ROW, AUDIT_TABLE, auditGrid, auditHeads } from "./columns";

/** Newest first. The header sticks to the top of the canvas while the rows scroll under it. */
export function AuditTable({ rows, showTeam }: { rows: AuditRow[]; showTeam: boolean }) {
  const grid = auditGrid(showTeam);
  return (
    <div role="table" aria-label="Audit events" className={AUDIT_TABLE}>
      <div role="row" className={cn("sticky top-0 z-10 min-h-9 items-center border-b border-hairline bg-canvas py-1.5", grid)}>
        {auditHeads(showTeam).map((h) => (
          <span key={h.label} role="columnheader" className={cn("caps-label", h.area)}>
            {h.label}
          </span>
        ))}
      </div>
      {rows.map((e) => (
        <div
          key={e.id}
          role="row"
          className={cn("items-center border-b border-hairline py-2 text-[14px] text-text", grid, AUDIT_ROW)}
        >
          <span role="cell" className={cn("min-w-0", at.when)}>
            <time dateTime={e.at} title={formatStamp(e.at)} className="block truncate tabular-nums">
              {e.when}
            </time>
            <span className="block truncate text-[12px] text-text-muted">{e.ago}</span>
          </span>
          <span role="cell" className={cn("flex min-w-0 items-center gap-2", at.who)}>
            <UserAvatar
              initials={e.actor?.initials ?? "UC"}
              hue={e.actor?.hue ?? 0}
              size="sm"
            />
            <span className="truncate">{e.actor?.name ?? SYSTEM_ACTOR}</span>
          </span>
          {showTeam ? (
            <span role="cell" className={cn("truncate text-text-muted", at.team)}>
              {e.team?.name ?? "Platform"}
            </span>
          ) : null}
          <span role="cell" className={cn("min-w-0", at.tpl)}>
            {e.template ? (
              <>
                <span className="block truncate">{e.template.name}</span>
                <span className="block truncate text-[12px] text-text-muted">
                  {e.versionNumber !== null ? `v${e.versionNumber} · ` : null}
                  <span className="font-mono">{e.template.id}</span>
                </span>
              </>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </span>
          <span role="cell" className={cn("truncate font-medium", at.act)} title={e.actionLabel}>
            {e.actionLabel}
          </span>
          <span role="cell" className={cn("line-clamp-2 text-[13px] leading-snug text-text-muted", at.det)} title={e.summary}>
            {e.summary}
          </span>
        </div>
      ))}
    </div>
  );
}
