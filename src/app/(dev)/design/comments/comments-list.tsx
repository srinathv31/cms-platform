"use client";

import { useEffect, useRef } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { m } from "motion/react";
import { spring } from "@/components/motion/presets";
import { cn } from "@/lib/utils";
import { orderKey } from "./fixtures";
import { useStore } from "./store";
import { ComposeCard, ResolvedGroup, ThreadCard } from "./thread-card";

/*
 * Threads as a list, in document order: the author's rail (A) and the approver's decision panel.
 * Clicking a card focuses its block in the document (and the document's marker does the reverse,
 * scrolling the list to the card). The new-thread composer takes its place in the same order.
 */

export function CommentsList({
  resolvedOpen,
  onResolvedOpen,
  className,
}: {
  resolvedOpen: boolean;
  onResolvedOpen: (open: boolean) => void;
  className?: string;
}) {
  const store = useStore();
  const root = useRef<HTMLDivElement>(null);

  // The document asked for a thread (a marker was clicked, a quote was clicked): bring its card into view.
  const focus = store.focus;
  useEffect(() => {
    if (!focus || focus.source !== "doc") return;
    const el = root.current?.querySelector<HTMLElement>(focus.id === "pending" ? "[data-compose]" : `[data-thread="${focus.id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const pendingKey = store.pending ? orderKey(store.pending) : null;
  const rows: React.ReactNode[] = [];
  let composerPlaced = false;
  const placeComposer = () => {
    if (!store.pending || composerPlaced) return;
    composerPlaced = true;
    rows.push(<ComposeCard key="compose" anchor={store.pending} />);
  };
  for (const thread of store.open) {
    if (pendingKey !== null && orderKey(thread) > pendingKey) placeComposer();
    rows.push(
      <ThreadCard key={thread.id} thread={thread} active={thread.id === store.activeId} onSelect={() => store.activate(thread.id, "list")} />,
    );
  }
  placeComposer();

  return (
    <div ref={root} className={cn("flex flex-col gap-3", className)}>
      {rows.length ? rows : <p className="text-[14px] leading-6 text-text-muted">No open comments.</p>}
      <ResolvedGroup threads={store.resolved} open={resolvedOpen} onToggle={() => onResolvedOpen(!resolvedOpen)} className="mt-1" />
    </div>
  );
}

// ── The rail's own switch ────────────────────────────────────────

export type RailView = "comments" | "variables";

// The tab idiom of the workspace tab bar and of the preview's rail header (rail-header.tsx): text
// only, muted until chosen, then dark and medium with a 2px dark underline on the row's hairline.
const TAB =
  "group/tab relative flex h-full items-center text-[14px] text-text-muted outline-none hover:text-text data-active:text-text";
const LABEL = "-mx-1.5 grid rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

export function RailTabs({
  value,
  onChange,
  count,
  end,
}: {
  value: RailView;
  onChange: (view: RailView) => void;
  count: number;
  /** At the right of the row: the overlay rail's Close button. */
  end?: React.ReactNode;
}) {
  const views: { value: RailView; label: string; count?: number }[] = [
    { value: "comments", label: "Comments", count },
    { value: "variables", label: "Variables" },
  ];
  return (
    <div data-slot="rail-header" className="flex h-11 shrink-0 items-start border-b border-hairline">
      <TabsPrimitive.Root
        value={value}
        onValueChange={(next) => {
          if (next === "comments" || next === "variables") onChange(next);
        }}
      >
        <TabsPrimitive.List aria-label="Rail" className="-mb-px flex h-11 gap-6">
          {views.map((view) => {
            const active = view.value === value;
            return (
              <TabsPrimitive.Tab key={view.value} value={view.value} className={TAB}>
                <span className={LABEL}>
                  <span className={cn("col-start-1 row-start-1 flex items-baseline gap-1.5", active && "font-medium")}>
                    {view.label}
                    {view.count ? <span className="text-[13px] font-normal text-text-subtle tabular-nums">{view.count}</span> : null}
                  </span>
                  <span aria-hidden className="invisible col-start-1 row-start-1 flex items-baseline gap-1.5 font-medium">
                    {view.label}
                    {view.count ? <span className="text-[13px] tabular-nums">{view.count}</span> : null}
                  </span>
                </span>
                {active ? (
                  <m.span
                    layoutId="comments-rail-underline"
                    transition={spring.soft}
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text"
                  />
                ) : null}
              </TabsPrimitive.Tab>
            );
          })}
        </TabsPrimitive.List>
      </TabsPrimitive.Root>
      {end ? <div className="ml-auto pt-1.5">{end}</div> : null}
    </div>
  );
}
