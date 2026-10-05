import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { ACTOR, KIND, TEAM, TMPL, whenLabel, type AuditEvent } from "./data";

const WIDE = "8.5rem 9.5rem 7.5rem minmax(0,1.3fr) 8.5rem minmax(0,1.5fr)";
const NARROW = "7.25rem 8rem 6.25rem minmax(0,1.7fr) 7.25rem minmax(0,1fr)";
const HEADS = ["When", "Who", "Team", "Template", "Action", "Details"];

/** Newest first. The header sticks; the rows scroll. `narrow` is for the layout that gives a rail 15rem. */
export function AuditTable({ rows, narrow, className }: { rows: AuditEvent[]; narrow?: boolean; className?: string }) {
  const cols = narrow ? NARROW : WIDE;
  return (
    <div role="table" aria-label="Audit events" className={className}>
      <div role="row" className="sticky top-0 z-10 grid gap-x-4 border-b border-hairline bg-canvas py-2" style={{ gridTemplateColumns: cols }}>
        {HEADS.map((h) => (
          <span key={h} role="columnheader" className="caps-label">{h}</span>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-12 text-[15px] text-text-muted">No events match.</p>
      ) : (
        rows.map((e) => {
          const who = ACTOR[e.actor]!;
          const t = e.template ? TMPL[e.template]! : null;
          return (
            <div key={e.id} role="row" className="grid min-h-12 items-center gap-x-4 border-b border-hairline py-2 text-[14px] text-text" style={{ gridTemplateColumns: cols }}>
              <span role="cell" className="tabular-nums text-text-muted">{whenLabel(e.at)}</span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                <UserAvatar initials={who.initials} hue={who.hue} size="sm" />
                <span className="truncate">{who.name}</span>
              </span>
              <span role="cell" className="truncate text-text-muted">{TEAM[e.team]}</span>
              <span role="cell" className="min-w-0">
                {t ? (
                  <>
                    <span className="block truncate">{t.name}</span>
                    <span className="text-[12px] text-text-muted">v{e.version} · <span className="font-mono">{t.code}</span></span>
                  </>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </span>
              <span role="cell" className={cn("truncate font-medium")}>{KIND[e.kind].label}</span>
              <span role="cell" className="line-clamp-2 text-[13px] leading-snug text-text-muted">{e.details}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
