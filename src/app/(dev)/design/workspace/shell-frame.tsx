import { Bell, CircleHelp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW } from "@/components/app-shell/nav";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Shortcut } from "@/components/primitives/keycap";

/*
 * The (dev) route group has no app shell, so this approximates it with the real measurements:
 * stone window, a --sidebar-w sidebar, and the canvas panel inset 0.75rem from the top, right and
 * bottom with rounded-4xl, a hairline border, a 4rem top bar and --canvas-pad-x side padding
 * (see src/components/app-shell/app-frame.tsx). Content is capped at 96rem like the real canvas.
 */

export interface Persona {
  team: { name: string; icon: string };
  initials: string;
  hue: number;
}

export function ShellFrame({
  persona,
  children,
}: {
  persona: Persona;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[calc(100svh-var(--wm-dev-h))] overflow-hidden bg-app">
      <aside className="flex w-(--sidebar-w) shrink-0 flex-col pb-3">
        <div className="px-3 pt-4 pb-2">
          <div className="flex h-12 items-center gap-3 rounded-xl px-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-surface">
              <TeamIcon name={persona.team.icon} className="size-[18px] text-text" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{persona.team.name}</span>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3 pt-2">
          {NAV_ITEMS.filter((i) => i.key !== "audit").map((item) => {
            const active = item.key === "library";
            return (
              <div
                key={item.key}
                className={cn(NAV_ROW, "flex items-center", active && "bg-selected font-medium")}
              >
                <item.icon aria-hidden strokeWidth={NAV_ICON_STROKE} />
                {item.label}
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

      <div className="m-3 ml-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-4xl border border-hairline bg-canvas">
        <header className="flex h-16 shrink-0 items-center justify-end gap-2 px-(--canvas-pad-x)">
          <div className="flex h-9 w-40 items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-[13px] text-text-muted">
            <Search aria-hidden strokeWidth={1.75} className="size-4" />
            <span className="flex-1">Search</span>
            <Shortcut keys={["⌘", "K"]} />
          </div>
          <div className="grid size-9 place-items-center rounded-full text-text-muted">
            <Bell aria-hidden strokeWidth={1.75} className="size-[18px]" />
          </div>
          <UserAvatar initials={persona.initials} hue={persona.hue} size="lg" />
        </header>
        {children}
      </div>
    </div>
  );
}

/** The canvas's scroll area, with the real side padding and the 96rem cap. */
export function CanvasScroll({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-(--canvas-pad-x) pb-14", className)}>
      <div className="mx-auto w-full max-w-[96rem]">{children}</div>
    </div>
  );
}
