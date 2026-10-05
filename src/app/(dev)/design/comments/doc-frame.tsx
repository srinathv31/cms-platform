"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ThreadView } from "@/domain/review-types";
import { cn } from "@/lib/utils";
import {
  blockElement,
  clearHighlights,
  paintHighlights,
  rangeForQuote,
  readSelection,
  useGeometry,
  type Geometry,
  type SelectionInfo,
} from "./anchors";
import { COMPOSE_ANCHOR } from "./fixtures";
import { GUTTER_OFFSET, GhostMarker, MarkerButton, MarkerGlyph, SelectionBubble } from "./markers";
import { useStore } from "./store";

/*
 * The document with everything that attaches to it: the tint on the active thread's block, the
 * markers in the right gutter, the ghost marker that offers a block comment, and the selection
 * bubble. It is a positioned wrapper exactly as wide as the text column, so every x here is "from
 * the text's right edge" and every y is "from the top of the document", and it all scrolls with the
 * page. `markers` says what a marker is (A: a button that focuses the thread in the list; B: the
 * trigger of a popover; C: nothing, the margin cards are the markers).
 */

export interface DocFrameProps {
  doc: ReactNode;
  mode: "author" | "review";
  markers: "button" | "popover" | "none";
  /** B: the card inside a block's popover. */
  popover?: (threads: ThreadView[]) => ReactNode;
  /** B: the composer inside the new-comment popover. */
  composePopover?: ReactNode;
  /** In flow, above the first block. */
  above?: ReactNode;
  /** C: the margin cards, positioned from the document's geometry. */
  margin?: (geometry: Geometry) => ReactNode;
  /** The handle gutter the document hangs into on its left (the editor's, 4.25rem in the workspace). */
  gutter?: string;
  className?: string;
}

function anchorY(thread: ThreadView, geo: Geometry): number | null {
  const q = geo.quotes[thread.id];
  if (q !== undefined) return q;
  const b = geo.blocks[thread.blockId];
  return b ? b.lineTop + b.lineHeight / 2 : null;
}

/** Scrolls the page's scroller so `y` (in the wrapper's coordinates) sits comfortably in view. */
function comfort(wrap: HTMLElement, y: number) {
  const scroller = wrap.closest<HTMLElement>("[data-main]");
  if (!scroller) return;
  const s = scroller.getBoundingClientRect();
  const inView = wrap.getBoundingClientRect().top + y - s.top;
  if (inView > 150 && inView < s.height - 140) return;
  scroller.scrollTo({ top: scroller.scrollTop + inView - s.height * 0.38, behavior: "smooth" });
}

export function DocFrame({
  doc,
  mode,
  markers,
  popover,
  composePopover,
  above,
  margin,
  gutter = "4.25rem",
  className,
}: DocFrameProps) {
  const store = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);

  const quotes = useMemo(() => {
    const list = store.anchored.filter((t) => t.quote).map((t) => ({ id: t.id, blockId: t.blockId, quote: t.quote as string }));
    if (store.pending?.quote) list.push({ id: "pending", blockId: store.pending.blockId, quote: store.pending.quote });
    return list;
  }, [store.anchored, store.pending]);
  const geo = useGeometry(wrapRef, quotes);
  const geoRef = useRef(geo);
  useLayoutEffect(() => {
    geoRef.current = geo;
  }, [geo]);

  // ── Highlights: the quote of every open thread, the active one stronger, the pending one in the selection colour.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const items: Parameters<typeof paintHighlights>[1] = store.anchored
      .filter((t) => t.quote)
      .map((t) => ({ blockId: t.blockId, quote: t.quote as string, kind: t.id === store.activeId ? "active" : "open" }));
    if (store.pending?.quote) items.push({ blockId: store.pending.blockId, quote: store.pending.quote, kind: "pending" });
    paintHighlights(wrap, items);
  }, [store.anchored, store.activeId, store.pending]);
  useEffect(() => clearHighlights, []);

  // ── Block tint
  const activeThread = store.anchored.find((t) => t.id === store.activeId);
  const pendingBlock = store.pending && !store.pending.quote ? store.pending.blockId : null;
  const tintId = activeThread?.blockId ?? pendingBlock;
  const tint = tintId ? geo.blocks[tintId] : undefined;

  // ── Markers, by block
  const byBlock = useMemo(() => {
    const map = new Map<string, ThreadView[]>();
    for (const t of store.anchored) map.set(t.blockId, [...(map.get(t.blockId) ?? []), t]);
    return map;
  }, [store.anchored]);

  // ── Hover: the ghost marker for a block with nothing on it yet
  const [hover, setHover] = useState<string | null>(null);
  const onPointerMove = (event: React.PointerEvent) => {
    const wrap = wrapRef.current;
    const target = event.target as HTMLElement;
    if (!wrap || !wrap.contains(target) || target.closest("[data-margin]")) {
      setHover(null);
      return;
    }
    const y = event.clientY - wrap.getBoundingClientRect().top;
    const hit = Object.values(geoRef.current.blocks).find((b) => y >= b.top - 6 && y <= b.top + b.height + 6);
    setHover(hit?.id ?? null);
  };

  // ── Clicking text that has a comment on it focuses the thread
  const onClick = (event: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || !(event.target as HTMLElement).closest(".ucomp-doc")) return;
    if (!window.getSelection()?.isCollapsed) return;
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!caret) return;
    for (const t of store.anchored) {
      if (!t.quote) continue;
      const el = blockElement(wrap, t.blockId);
      const range = el ? rangeForQuote(el, t.quote) : null;
      if (range?.isPointInRange(caret.startContainer, caret.startOffset)) {
        store.activate(t.id, "doc");
        return;
      }
    }
    store.deactivate();
  };

  // ── Selection bubble
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const pointerDown = useRef(false);
  const refresh = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || pointerDown.current) return;
    setSel(readSelection(wrap));
  }, []);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-selection-bubble]")) return;
      pointerDown.current = true;
      setSel(null);
    };
    const up = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      window.setTimeout(refresh, 0);
    };
    const wrap = wrapRef.current;
    const scroller = wrap?.closest("[data-main]");
    wrap?.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("selectionchange", refresh);
    scroller?.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      wrap?.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("selectionchange", refresh);
      scroller?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [refresh]);

  // `compose=sel`: once, when the page first draws, select a phrase so the bubble shows.
  const { takeStartSelection } = store;
  useEffect(() => {
    if (!geo.width) return;
    const wrap = wrapRef.current;
    const el = wrap ? blockElement(wrap, COMPOSE_ANCHOR.blockId) : null;
    const range = el ? rangeForQuote(el, COMPOSE_ANCHOR.quote) : null;
    if (!range || !takeStartSelection()) return;
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, [geo.width, takeStartSelection]);

  const comment = () => {
    if (!sel) return;
    store.startCompose({ blockId: sel.blockId, quote: sel.quote });
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  // ── Esc puts away the topmost thing: the composer, then the active thread.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (store.pending) store.cancelCompose();
      else if (store.activeId) store.deactivate();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  // ── The list asked to show a thread: bring its anchor into view
  const focus = store.focus;
  useEffect(() => {
    if (!focus || focus.source !== "list") return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const thread = store.threads.find((t) => t.id === focus.id);
    if (!thread || thread.blockId === "doc") return;
    const y = anchorY(thread, geoRef.current);
    if (y !== null) comfort(wrap, y);
    // Only a new request, not every render of its thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const gutterStyle: CSSProperties = { top: 0, bottom: 0 };
  const bubbleTop = sel ? (sel.rect.top > 64 ? sel.rect.top - 48 : sel.rect.bottom + 8) : 0;
  const bubbleLeft = sel ? Math.min(Math.max(sel.rect.left + sel.rect.width / 2, 130), window.innerWidth - 130) : 0;

  const ghostBlock = hover && !byBlock.has(hover) && store.pending?.blockId !== hover ? geo.blocks[hover] : undefined;
  const pendingGeo = store.pending ? geo.blocks[store.pending.blockId] : undefined;
  const pendingY = store.pending
    ? (geo.quotes.pending ?? (pendingGeo ? pendingGeo.lineTop + pendingGeo.lineHeight / 2 : null))
    : null;

  return (
    <div
      ref={wrapRef}
      data-doc-frame=""
      className={cn("relative", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onClick={onClick}
    >
      <div
        aria-hidden
        data-tint=""
        className={cn(
          "pointer-events-none absolute -right-1.5 -left-2.5 rounded-lg border transition-[top,height,opacity] duration-(--dur-base) ease-(--ease-out-soft)",
          pendingBlock && !activeThread ? "border-brand-1 bg-brand-soft" : "border-warning-border bg-warning-soft",
          tint ? "opacity-100" : "opacity-0",
        )}
        style={{ top: (tint?.top ?? 0) - 6, height: (tint?.height ?? 0) + 12 }}
      />
      {above}
      <div className="wm-doc pt-8 pb-[max(3.5rem,40svh)]" data-heads="serif" style={{ "--wm-gutter": gutter } as CSSProperties}>
        {doc}
      </div>

      {/* The right gutter: 40px between the text and the rail. */}
      <div data-gutter="" className="pointer-events-none absolute left-full w-10" style={gutterStyle}>
        {markers !== "none"
          ? Array.from(byBlock.entries()).map(([blockId, threads]) => {
              const first = threads[0];
              const y = anchorY(first, geo);
              if (y === null) return null;
              const count = threads.reduce((n, t) => n + t.comments.length, 0);
              const active = threads.some((t) => t.id === store.activeId);
              const style = { top: y - 12, left: GUTTER_OFFSET };
              if (markers === "popover") {
                return (
                  <Popover
                    key={blockId}
                    open={active}
                    onOpenChange={(next) => {
                      if (next) store.activate(first.id, "doc");
                      else store.deactivate();
                    }}
                  >
                    <PopoverTrigger
                      data-marker={blockId}
                      aria-label={`${count} ${count === 1 ? "comment" : "comments"} on this block`}
                      className="group/marker pointer-events-auto absolute grid size-6 place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
                      style={style}
                    >
                      <MarkerGlyph count={count} active={active} />
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={8}
                      alignOffset={-10}
                      initialFocus={false}
                      className="w-[300px] gap-0 rounded-xl border border-hairline bg-surface p-3.5 shadow-pop ring-0"
                    >
                      {popover?.(threads)}
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <MarkerButton
                  key={blockId}
                  data-marker={blockId}
                  count={count}
                  active={active}
                  className="pointer-events-auto absolute"
                  style={style}
                  onClick={() => {
                    // A second click on a block with several threads moves to the next one.
                    const at = threads.findIndex((t) => t.id === store.activeId);
                    store.activate(threads[(at + 1) % threads.length].id, "doc");
                  }}
                />
              );
            })
          : null}

        {ghostBlock ? (
          <GhostMarker
            className="pointer-events-auto absolute"
            style={{ top: ghostBlock.lineTop + ghostBlock.lineHeight / 2 - 12, left: GUTTER_OFFSET }}
            onClick={() => store.startCompose({ blockId: ghostBlock.id, quote: null })}
          />
        ) : null}

        {markers === "popover" && store.pending && pendingY !== null ? (
          <Popover open onOpenChange={(next) => !next && store.cancelCompose()}>
            <PopoverTrigger
              render={<GhostMarker pending className="pointer-events-auto absolute" style={{ top: pendingY - 12, left: GUTTER_OFFSET }} />}
            />
            <PopoverContent
              side="right"
              align="start"
              sideOffset={8}
              alignOffset={-10}
              initialFocus={false}
              className="w-[300px] gap-0 rounded-xl border border-hairline bg-surface p-3.5 shadow-pop ring-0"
            >
              {composePopover}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {margin?.(geo)}

      {sel && !store.pending ? <SelectionBubble top={bubbleTop} left={bubbleLeft} formatting={mode === "author"} onComment={comment} /> : null}
    </div>
  );
}
