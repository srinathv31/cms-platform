"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Overview | Consumers. The tab idiom: text with the 2px dark underline on a hairline, like the
// workspace tab bar. Both panels are rendered by the server and handed in; the inactive one is hidden,
// so the consumers filter keeps its state while you look at the overview.

type TabId = "overview" | "consumers";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "consumers", label: "Consumers" },
];

export function UsageTabs({
  overview,
  consumers,
  initial = "overview",
}: {
  overview: React.ReactNode;
  consumers: React.ReactNode;
  /** From `?tab=`, so a reload or a shared link keeps the tab. */
  initial?: TabId;
}) {
  const [value, setValue] = useState<TabId>(initial);
  const choose = (id: TabId) => {
    setValue(id);
    // The URL follows the tab without a navigation. Pass `null` as the state: Next patches
    // replaceState and syncs the router (useSearchParams, refresh()) only for calls without its own
    // internal marker, so handing back `window.history.state` would let the next refresh revert `?tab=`.
    const params = new URLSearchParams(window.location.search);
    if (id === "overview") params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  };
  const base = useId();
  const refs = useRef<Record<TabId, HTMLButtonElement | null>>({ overview: null, consumers: null });

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    choose(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Usage" className="flex gap-7 border-b border-hairline">
        {TABS.map((tab, i) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              id={`${base}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn("group/tab relative -mb-px flex h-11 cursor-pointer items-center text-[15px] outline-none", active ? "font-medium text-text" : "text-text-muted hover:text-text")}
            >
              <span className="-mx-1.5 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring">{tab.label}</span>
              {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text" /> : null}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== value}
          className="mt-9"
        >
          {tab.id === "overview" ? overview : consumers}
        </div>
      ))}
    </>
  );
}
