import { Bell, CircleHelp, Clapperboard, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW } from "@/components/app-shell/nav";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Shortcut } from "@/components/primitives/keycap";

/*
 * The (dev) route group has no app shell, so this approximates it with the real measurements, as the
 * workspace study's frame does (stone window, a --sidebar-w sidebar, the canvas panel inset 0.75rem
 * with rounded-4xl and a 4rem top bar). Differences from that frame: Review is the active row and
 * carries its count, the panel is `relative` so the go-live overlay can cover just the canvas, and the
 * Demo pill is drawn.
 */

export interface ShellPerson {
  initials: string;
  hue: number;
}

export function ReviewShell({
  person,
  badge,
  overlay,
  children,
}: {
  person: ShellPerson;
  /** The Review row's count (the viewer's "Waiting on me"). */
  badge: number;
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-rv-shell="" className="flex h-[calc(100svh-var(--rv-dev-h))] overflow-hidden bg-app">
      <aside className="flex w-(--sidebar-w) shrink-0 flex-col pb-3">
        <div className="px-3 pt-4 pb-2">
          <div className="flex h-12 items-center gap-3 rounded-xl px-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-surface">
              <TeamIcon name="gift" className="size-[18px] text-text" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">Coral Offers</span>
          </div>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1 px-3 pt-2">
          {NAV_ITEMS.filter((i) => i.key !== "audit").map((item) => {
            const active = item.key === "review";
            return (
              <div key={item.key} className={cn(NAV_ROW, "flex items-center", active && "bg-selected font-medium")}>
                <item.icon aria-hidden strokeWidth={NAV_ICON_STROKE} />
                {item.label}
                {item.key === "review" && badge > 0 ? (
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-text px-1.5 text-[11px] font-medium text-surface">
                    {badge}
                  </span>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="mt-auto px-3">
          <div className={cn(NAV_ROW, "flex items-center")}>
            <CircleHelp aria-hidden strokeWidth={NAV_ICON_STROKE} />
            Help
          </div>
        </div>
      </aside>

      <div className="relative m-3 ml-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-4xl border border-hairline bg-canvas">
        <header className="flex h-16 shrink-0 items-center justify-end gap-2 px-(--canvas-pad-x)">
          <div className="flex h-9 w-40 items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-[13px] text-text-muted">
            <Search aria-hidden strokeWidth={1.75} className="size-4" />
            <span className="flex-1">Search</span>
            <Shortcut keys={["⌘", "K"]} />
          </div>
          <div className="grid size-9 place-items-center rounded-full text-text-muted">
            <Bell aria-hidden strokeWidth={1.75} className="size-[18px]" />
          </div>
          <UserAvatar initials={person.initials} hue={person.hue} size="lg" />
        </header>
        {children}
        {overlay}
      </div>
      {/* The real Demo pill (components/demo/demo-pill.tsx), fixed at the window's bottom right, drawn here
          so the mock shows what covers the rail's bottom corner. */}
      <span
        aria-hidden
        className="pointer-events-none fixed right-5 bottom-5 z-40 inline-flex h-8 items-center gap-2 rounded-full border border-dashed border-hairline-strong bg-surface px-3.5 text-xs font-medium text-text-muted"
      >
        <Clapperboard strokeWidth={1.75} className="size-3.5" />
        Demo
      </span>
    </div>
  );
}
