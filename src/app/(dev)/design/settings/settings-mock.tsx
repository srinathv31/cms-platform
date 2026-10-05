"use client";

import { useState } from "react";
import { Bell, ChartColumn, ClipboardCheck, Library, ScrollText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { dayLabel } from "./data";
import type { Variant } from "./items";
import { SettingsNav, visibleFor, type NavVariant, type Viewer } from "./nav";
import { SectionBody } from "./sections";
import { StoreProvider, useStore } from "./store";

export interface SettingsInitial {
  variant: Variant;
  nav: NavVariant;
  section: string;
  viewer: Viewer;
  day: number;
  chrome: boolean;
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-[12px] text-text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-hairline bg-surface">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className="h-6 px-2.5 text-[12px] text-text outline-none aria-pressed:bg-text aria-pressed:text-surface"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const LAYOUTS = [
  { value: "a", label: "A · Rows" },
  { value: "b", label: "B · List + detail" },
  { value: "c", label: "C · Cards" },
] as const;
const NAVS = [
  { value: "a", label: "A · Caps groups" },
  { value: "b", label: "B · Scope switch" },
  { value: "c", label: "C · Scoped groups" },
] as const;
const VIEWERS = [
  { value: "both", label: "Both groups" },
  { value: "alex", label: "Alex" },
  { value: "riley", label: "Riley" },
] as const;

function Inner({ initial }: { initial: SettingsInitial }) {
  const s = useStore();
  const [variant, setVariant] = useState(initial.variant);
  const [nav, setNav] = useState(initial.nav);
  const [navTouched, setNavTouched] = useState(initial.nav !== initial.variant);
  const [viewer, setViewer] = useState(initial.viewer);
  const [section, setSection] = useState(() => {
    const groups = visibleFor(initial.viewer);
    return groups.some((g) => g.sections.some((x) => x.key === initial.section)) ? initial.section : groups[0]!.sections[0]!.key;
  });

  const sync = (patch: Record<string, string>) => {
    try {
      const u = new URL(window.location.href);
      for (const [k, val] of Object.entries(patch)) u.searchParams.set(k, val);
      window.history.replaceState(null, "", u);
    } catch {
      /* the URL is a convenience */
    }
  };

  const pickSection = (key: string) => {
    setSection(key);
    sync({ section: key });
  };
  const pickVariant = (v: Variant) => {
    setVariant(v);
    sync({ v });
    if (!navTouched) setNav(v);
  };
  const pickViewer = (v: Viewer) => {
    setViewer(v);
    sync({ viewer: v });
    const groups = visibleFor(v);
    if (!groups.some((g) => g.sections.some((x) => x.key === section))) pickSection(groups[0]!.sections[0]!.key);
  };

  return (
    <div className="flex h-svh flex-col bg-app">
      {initial.chrome ? (
        <div className="flex h-10 shrink-0 items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4">
          <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
          <Choice label="Sections" value={variant} onChange={pickVariant} options={LAYOUTS} />
          <Choice
            label="Grouping"
            value={nav}
            onChange={(v) => {
              setNav(v);
              setNavTouched(true);
              sync({ nav: v });
            }}
            options={NAVS}
          />
          <Choice label="Viewer" value={viewer} onChange={pickViewer} options={VIEWERS} />
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-text-muted">Demo clock</span>
            <span className="text-[12px] text-text">{dayLabel(s.clock, true)}</span>
            <Button variant="outline" size="xs" onClick={() => s.setClock(s.clock + 15)}>+15 days</Button>
            <Button variant="outline" size="xs" onClick={s.reset}>Reset</Button>
          </div>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* The page under the modal, as dimmed as the flat scrim makes it. */}
        <div aria-hidden className="flex h-full">
          <aside className="flex w-(--sidebar-w) shrink-0 flex-col gap-1 px-3 pt-20">
            {[Library, ClipboardCheck, ChartColumn, ScrollText].map((I, i) => (
              <div key={i} className="flex h-9 items-center gap-3 rounded-lg px-3 text-text-muted">
                <I strokeWidth={NAV_ICON_STROKE} className="size-5" />
                <span className="h-2.5 w-20 rounded-full bg-hairline" />
              </div>
            ))}
          </aside>
          <div className="m-3 ml-0 flex-1 rounded-4xl border border-hairline bg-canvas">
            <div className="flex h-16 items-center justify-end px-12 text-text-muted"><Bell strokeWidth={1.75} className="size-[18px]" /></div>
          </div>
        </div>
        <div className="absolute inset-0 bg-scrim" />
        <div
          role="dialog"
          aria-label="Settings"
          className="absolute top-1/2 left-1/2 flex h-[min(46rem,84%)] w-[min(72vw,70rem)] min-w-[56rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl bg-surface shadow-modal"
        >
          <div className="flex w-[15rem] shrink-0 flex-col bg-surface-tinted">
            <SettingsNav variant={nav} viewer={viewer} section={section} onSelect={pickSection} />
          </div>
          <div className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain px-10 pt-12 pb-10">
            <SectionBody key={`${section}-${variant}`} section={section} v={variant} />
            <Button variant="ghost" size="icon" aria-label="Close settings" className={cn("absolute top-5 right-5 size-9 rounded-full text-text-muted hover:bg-hover hover:text-text")}>
              <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsMock({ initial }: { initial: SettingsInitial }) {
  return (
    <StoreProvider initialClock={initial.day}>
      <Inner initial={initial} />
    </StoreProvider>
  );
}
