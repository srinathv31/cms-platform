import { Bell, CircleHelp, Info, Search, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW } from "@/components/app-shell/nav";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Shortcut } from "@/components/primitives/keycap";

/* The (dev) route group has no app shell, so ShellFrame approximates it with the real measurements. */

export function ShellFrame({ active = "usage", children }: { active?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-app">
      <aside className="flex w-(--sidebar-w) shrink-0 flex-col pb-3">
        <div className="px-3 pt-4 pb-2">
          <div className="flex h-12 items-center gap-3 rounded-xl px-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-surface">
              <TeamIcon name="credit-card" className="size-[18px] text-text" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">Coral Offers</span>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3 pt-2">
          {NAV_ITEMS.filter((i) => i.key !== "audit").map((item) => (
            <div key={item.key} className={cn(NAV_ROW, "flex items-center", item.key === active && "bg-selected font-medium")}>
              <item.icon aria-hidden strokeWidth={NAV_ICON_STROKE} />
              {item.label}
            </div>
          ))}
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
          <UserAvatar initials="MC" hue={28} size="lg" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--canvas-pad-x) pb-14">
          <div className="mx-auto w-full max-w-[96rem]">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** The one card: a shadcn Card in the house look (tinted fill, hairline, no ring, 24px padding). */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("min-w-0 gap-0 rounded-xl border border-hairline bg-surface-tinted p-6 ring-0", className)}>{children}</Card>
  );
}

/** Title at left, tracked-caps aside at right, like "Desktop usage … TOTAL APPS USED | 17". */
export function PanelHead({ title, aside, size = "lg" }: { title: React.ReactNode; aside?: React.ReactNode; size?: "lg" | "md" }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className={cn("m-0 font-normal tracking-tight text-text", size === "lg" ? "text-[28px] leading-9" : "text-[18px] leading-6")}>{title}</h2>
      {aside ? <span className="caps-label shrink-0 text-right">{aside}</span> : null}
    </div>
  );
}

export function InfoDot({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} aria-label={tip} className="inline-grid size-4 cursor-default place-items-center rounded-full align-[-3px] text-text-subtle outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
        <Info aria-hidden strokeWidth={1.75} className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function TrendPill({ children, tone = "positive" }: { children: React.ReactNode; tone?: "positive" | "negative" }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium whitespace-nowrap", tone === "positive" ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger-text")}>
      <TrendingUp aria-hidden strokeWidth={1.75} className="size-3.5" />
      {children}
    </span>
  );
}

/** The tab idiom: text with a 2px dark underline on a hairline. */
export function TabRow<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-7 border-b border-hairline", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn("relative -mb-px flex h-11 cursor-pointer items-center text-[15px] outline-none", t.id === value ? "font-medium text-text" : "text-text-muted hover:text-text")}
        >
          <span className="-mx-1.5 rounded-md px-1.5 py-0.5 focus-visible:ring-2 focus-visible:ring-ring">{t.label}</span>
          {t.id === value ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text" /> : null}
        </button>
      ))}
    </div>
  );
}
