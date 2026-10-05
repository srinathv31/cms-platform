"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Geometry } from "./anchors";
import { orderKey } from "./fixtures";
import { useStore } from "./store";
import { ComposeCard, ResolvedGroup, ThreadCard } from "./thread-card";

/*
 * C · Margin cards. Thread cards float in a column beside the text, each level with the text it is
 * about, and stack so they never overlap: the active card stays where its text is and the others
 * give way around it (as in Google Docs). The column's room comes from the rail, which collapses to
 * a 56px strip while the margin is open.
 */

export const MARGIN = {
  /** The rail, folded to a strip. */
  strip: 56,
  /** Between the text and the cards: the same 40px gutter the other variants use. */
  gap: 40,
  card: 272,
  /** Right edge of the cards to the window's panel edge. */
  pad: 16,
} as const;

/** What the margin needs beside the text, in px (gap, cards, right pad). */
export const MARGIN_NEED = MARGIN.gap + MARGIN.card + MARGIN.pad;

interface Item {
  id: string;
  /** Where the card would like to start (its anchor's y); -Infinity = just below the one before. */
  desired: number;
  node: ReactNode;
  active: boolean;
}

const GAP = 12;

/**
 * Positions the cards top to bottom, in document order, none overlapping. With no active card each
 * sits at its anchor or just below the card before it. The active card is held at its anchor (or as
 * high as the cards above, packed tight, allow), the cards above it move up to make room, and the
 * cards below it give way.
 */
export function stack(items: { desired: number; h: number; active: boolean }[]): number[] {
  const n = items.length;
  const greedy: number[] = [];
  for (let i = 0; i < n; i++) {
    const floor = i === 0 ? 0 : greedy[i - 1] + items[i - 1].h + GAP;
    greedy[i] = Math.max(items[i].desired, floor);
  }
  const pinned = items.findIndex((i) => i.active);
  if (pinned < 0) return greedy;

  let packed = 0;
  for (let i = 0; i < pinned; i++) packed += items[i].h + GAP;
  const tops = [...greedy];
  tops[pinned] = Math.max(items[pinned].desired, packed);
  for (let i = pinned - 1; i >= 0; i--) tops[i] = Math.min(greedy[i], tops[i + 1] - GAP - items[i].h);
  for (let i = pinned + 1; i < n; i++) tops[i] = Math.max(items[i].desired, tops[i - 1] + items[i - 1].h + GAP);
  return tops;
}

function Measured({ id, onHeight, top, children }: { id: string; onHeight: (id: string, h: number) => void; top: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(id, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, onHeight]);
  return (
    <div
      ref={ref}
      className="absolute left-0 w-full transition-[top] duration-(--dur-base) ease-(--ease-out-soft)"
      style={{ top }}
    >
      {children}
    </div>
  );
}

export function MarginColumn({
  geo,
  resolvedOpen,
  onResolvedOpen,
}: {
  geo: Geometry;
  resolvedOpen: boolean;
  onResolvedOpen: (open: boolean) => void;
}) {
  const store = useStore();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useMemo(
    () => (id: string, h: number) => setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h })),
    [],
  );

  const items = useMemo(() => {
    const list: Item[] = [];
    const lineOf = (blockId: string, id: string) => {
      const q = geo.quotes[id];
      if (q !== undefined) return q;
      const b = geo.blocks[blockId];
      return b ? b.lineTop + b.lineHeight / 2 : 0;
    };
    // A card's first line (avatar, name) sits about level with its text.
    const at = (y: number) => y - 22;

    if (store.docThread) {
      const doc = store.docThread;
      list.push({
        id: doc.id,
        desired: 0,
        active: false,
        node: <ThreadCard thread={doc} floating />,
      });
    }
    const rows = store.anchored.map((thread) => ({ id: thread.id, y: at(lineOf(thread.blockId, thread.id)), thread }));
    const pendingY = store.pending ? at(lineOf(store.pending.blockId, "pending")) : null;
    const pendingKey = store.pending ? orderKey(store.pending) : null;
    let composerPlaced = false;
    const placeComposer = () => {
      if (!store.pending || composerPlaced || pendingY === null) return;
      composerPlaced = true;
      list.push({ id: "pending", desired: pendingY, active: true, node: <ComposeCard anchor={store.pending} floating /> });
    };
    for (const row of rows) {
      if (pendingKey !== null && orderKey(row.thread) > pendingKey) placeComposer();
      list.push({
        id: row.id,
        desired: row.y,
        active: row.id === store.activeId,
        node: (
          <ThreadCard
            thread={row.thread}
            floating
            active={row.id === store.activeId}
            onSelect={() => store.activate(row.id, "list")}
          />
        ),
      });
    }
    placeComposer();
    if (store.resolved.length > 0) {
      list.push({
        id: "resolved",
        desired: -Infinity,
        active: false,
        node: <ResolvedGroup threads={store.resolved} open={resolvedOpen} onToggle={() => onResolvedOpen(!resolvedOpen)} />,
      });
    }
    return list;
  }, [geo, store, resolvedOpen, onResolvedOpen]);

  const tops = stack(items.map((i) => ({ desired: i.desired, h: heights[i.id] ?? 0, active: i.active })));

  return (
    <div
      data-margin=""
      aria-label="Comments"
      role="region"
      className="absolute top-0 left-full"
      style={{ marginLeft: MARGIN.gap, width: MARGIN.card }}
    >
      {items.map((item, i) => (
        <Measured key={item.id} id={item.id} top={tops[i]} onHeight={onHeight}>
          {item.node}
        </Measured>
      ))}
      {items.length === 0 ? <p className="text-[14px] leading-6 text-text-muted">No open comments.</p> : null}
    </div>
  );
}

// ── The rail while the margin is open ────────────────────────────

/** The rail folded to a strip: one button that opens it over the margin. */
export function RailStrip({ onOpen }: { onOpen: () => void }) {
  return (
    <aside
      aria-label="Channels and variables"
      data-rail=""
      className="flex h-full shrink-0 flex-col items-center border-l border-hairline bg-canvas pt-3"
      style={{ width: MARGIN.strip }}
    >
      <Button variant="ghost" size="icon-lg" aria-label="Channels and variables" title="Channels and variables" onClick={onOpen}>
        <PanelRight strokeWidth={1.75} />
      </Button>
    </aside>
  );
}

export function CloseRail({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-1.5" onClick={onClose}>
      <X strokeWidth={1.75} />
    </Button>
  );
}
