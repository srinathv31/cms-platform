"use client";

import { useState } from "react";
import { Bell, CircleHelp, Clapperboard, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW } from "@/components/app-shell/nav";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Shortcut } from "@/components/primitives/keycap";
import { PageHeader } from "@/components/primitives/page-header";
import { EVENTS, TODAY } from "./data";
import { AuditTable } from "./audit-table";
import { activeCount, applyFilters, downloadCsv, type Filters } from "./filters";
import { FilterBar } from "./variant-a";
import { FacetRail } from "./variant-b";
import { QueryField } from "./variant-c";

export type Variant = "a" | "b" | "c";

export interface AuditInitial {
  variant: Variant;
  filters: Filters;
  chrome: boolean;
}

const VARIANTS = [
  { value: "a", label: "A · Filter bar" },
  { value: "b", label: "B · Facet rail" },
  { value: "c", label: "C · Query tokens" },
] as const;

/* The (dev) group has no app shell, so this draws Taylor's (the Auditor's) with the real measurements. */
function Frame({ chrome, children }: { chrome: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex overflow-hidden bg-app", chrome ? "h-[calc(100svh-2.5rem)]" : "h-svh")}>
      <aside className="flex w-(--sidebar-w) shrink-0 flex-col pb-3">
        <div className="px-3 pt-4 pb-2">
          <div className="flex h-12 items-center gap-3 rounded-xl px-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-surface">
              <TeamIcon name="layers" className="size-[18px] text-text" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">All teams</span>
          </div>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1 px-3 pt-2">
          {NAV_ITEMS.map((item) => (
            <div key={item.key} className={cn(NAV_ROW, "flex items-center", item.key === "audit" && "bg-selected font-medium")}>
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
          <UserAvatar initials="TN" hue={190} size="lg" />
        </header>
        {children}
      </div>
      <span aria-hidden className="pointer-events-none fixed right-5 bottom-5 z-40 inline-flex h-8 items-center gap-2 rounded-full border border-dashed border-hairline-strong bg-surface px-3.5 text-xs font-medium text-text-muted">
        <Clapperboard strokeWidth={1.75} className="size-3.5" />
        Demo
      </span>
    </div>
  );
}

export function AuditMock({ initial }: { initial: AuditInitial }) {
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [f, setF] = useState<Filters>(initial.filters);
  const rows = applyFilters(f);
  const filtered = activeCount(f) > 0;

  const pickVariant = (v: Variant) => {
    setVariant(v);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("v", v);
      window.history.replaceState(null, "", u);
    } catch {
      /* the URL is a convenience */
    }
  };

  const count = (
    <p className="text-[14px] text-text-muted tabular-nums">
      {filtered ? `${rows.length} of ${EVENTS.length} events` : `${EVENTS.length} events`}
    </p>
  );

  return (
    <div className="bg-app">
      {initial.chrome ? (
        <div className="flex h-10 items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4">
          <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-text-muted">Filters</span>
            <div role="group" aria-label="Filters" className="flex overflow-hidden rounded-lg border border-hairline bg-surface">
              {VARIANTS.map((o) => (
                <button key={o.value} type="button" aria-pressed={o.value === variant} onClick={() => pickVariant(o.value)} className="h-6 px-2.5 text-[12px] text-text outline-none aria-pressed:bg-text aria-pressed:text-surface">
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-text-muted">Demo clock</span>
            <span className="text-[12px] text-text">{new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
          </div>
          <span className="shrink-0 text-[12px] text-text-muted">Viewing as Taylor Nguyen, Auditor</span>
        </div>
      ) : null}
      <Frame chrome={initial.chrome}>
        <div className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col px-(--canvas-pad-x)">
          <PageHeader
            eyebrow="All teams"
            title="Audit"
            className="shrink-0 pb-5"
            action={
              <Button variant="outline" disabled={rows.length === 0} onClick={() => downloadCsv(rows, "ucomp-audit-2026-10-05.csv")}>
                <Download aria-hidden strokeWidth={1.75} data-icon="inline-start" />
                Export {rows.length} {rows.length === 1 ? "event" : "events"}
              </Button>
            }
          />
          {variant === "b" ? (
            <div className="flex min-h-0 flex-1 gap-8">
              <FacetRail f={f} set={setF} />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex h-8 shrink-0 items-center">{count}</div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10">
                  <AuditTable rows={rows} narrow />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0">{variant === "a" ? <FilterBar f={f} set={setF} /> : <QueryField f={f} set={setF} />}</div>
              <div className="mt-4 flex h-6 shrink-0 items-center">{count}</div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10">
                <AuditTable rows={rows} />
              </div>
            </div>
          )}
        </div>
      </Frame>
    </div>
  );
}
