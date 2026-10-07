"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import { DOCUMENT_THREAD, type ThreadView } from "@/domain/review-types";
import type { DocumentEditorHandle } from "@/editor/types";
import { cn } from "@/lib/utils";

/*
 * Comment markers in the document's right gutter: a speech bubble with the number of comments on the
 * block, at the height of the block's first commented line. Amber, the colour the highlight is
 * painted in, so a marker and its text read as one thing.
 *
 * Where they go. The layer is absolutely positioned against its parent (the cell the document sits
 * in, which must be `position: relative`) and hangs off the parent's right edge: `left-full`, 40px
 * wide, which is the gap between the text and the rail. The editor reports boxes in viewport
 * coordinates (`getThreadRect`); a marker's y is that box minus the layer's own box, measured in the
 * same call, so it needs no scroll listener (the document and the layer scroll together). It is
 * measured again whenever the editor says blocks may have moved (`subscribeBlockRects`: typing that
 * wraps, width changes, fonts, blocks added or moved) and whenever the threads change.
 *
 * The gutter has to exist: the host leaves 24px (`compact`) or 40px beside the text. The workspace has
 * none below the rail's breakpoint (53rem of workspace: the rail is an overlay there) and hides the
 * layer with `className`.
 */

/** A glyph's box (px). The compact one fits the 24px gap of the widened (preview) rail. */
const SIZE = { normal: 24, compact: 20 } as const;
/**
 * Where the marker's left edge sits from the text: 8px of the 40px gutter, 4px of the 24px one. A block's wash
 * (its highlight rings the block by 4px) reaches 4px past the text, so the compact marker starts there, with
 * the same hair of room between the wash and the marker as between the marker and the rail's divider.
 */
const OFFSET = { normal: 8, compact: 4 } as const;
/** The first line of a block, for centering a marker on it (the document's 1rem at 1.7). */
const LINE = 27;

export interface GutterMarkersProps {
  editor: RefObject<DocumentEditorHandle | null>;
  /** Open, non-orphaned threads on blocks get markers (one per block; the number is its comments). */
  threads: ThreadView[];
  activeThreadId: string | null;
  onActivate: (threadId: string) => void;
  /** Turns on the hover marker that starts a comment on a whole block. */
  onRequestBlockComment?: (blockId: string) => void;
  /**
   * Marker keys (a block id, or the key of a line the redline collapses blocks into) that stand for
   * blocks the screen isn't showing: their label says "in unchanged blocks" rather than "on this block".
   */
  collapsedKeys?: ReadonlySet<string>;
  /** The widened rail leaves a 24px gutter instead of 40px: smaller markers, closer to the text. */
  compact?: boolean;
  /** For the layer (the workspace hides it where there is no gutter). */
  className?: string;
}

interface Marker {
  blockId: string;
  /** The block's open threads, topmost first. */
  threadIds: string[];
  count: number;
  y: number;
}

interface Ghost {
  blockId: string;
  top: number;
  height: number;
  y: number;
}

/** The threads that get a marker, by block, in the order the blocks first appear in `threads`. */
export function markerThreads(threads: readonly ThreadView[]): { blockId: string; threads: ThreadView[] }[] {
  const byBlock = new Map<string, ThreadView[]>();
  for (const thread of threads) {
    if (thread.status !== "open" || thread.orphaned || thread.blockId === DOCUMENT_THREAD) continue;
    const list = byBlock.get(thread.blockId);
    if (list) list.push(thread);
    else byBlock.set(thread.blockId, [thread]);
  }
  return [...byBlock].map(([blockId, list]) => ({ blockId, threads: list }));
}

/** The marker the arrow key moves to (null: stay). */
export function nextMarkerIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  let next: number;
  if (key === "ArrowDown" || key === "ArrowRight") next = current + 1;
  else if (key === "ArrowUp" || key === "ArrowLeft") next = current - 1;
  else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else return null;
  return Math.min(Math.max(next, 0), count - 1);
}

const sameMarkers = (a: Marker[], b: Marker[]) =>
  a.length === b.length &&
  a.every(
    (m, i) =>
      m.blockId === b[i].blockId &&
      m.y === b[i].y &&
      m.count === b[i].count &&
      m.threadIds.join() === b[i].threadIds.join(),
  );

/** Where each block's marker goes, and the hover marker's strip, from the editor's boxes (viewport coordinates) and the layer's top. */
function measureLayer(
  handle: DocumentEditorHandle,
  origin: number,
  groups: readonly { blockId: string; threads: ThreadView[] }[],
  hover: string | null,
): { markers: Marker[]; ghost: Ghost | null } {
  const center = (rect: DOMRect) => Math.round(rect.top - origin + Math.min(rect.height, LINE) / 2);

  const markers: Marker[] = [];
  for (const group of groups) {
    const placed: { id: string; y: number }[] = [];
    for (const thread of group.threads) {
      const rect = handle.getThreadRect(thread.id) ?? handle.getBlockRect(thread.blockId);
      if (rect) placed.push({ id: thread.id, y: center(rect) });
    }
    if (placed.length === 0) continue;
    placed.sort((a, b) => a.y - b.y);
    markers.push({
      blockId: group.blockId,
      threadIds: placed.map((p) => p.id),
      count: group.threads.reduce((n, t) => n + t.comments.length, 0),
      y: placed[0].y,
    });
  }
  markers.sort((a, b) => a.y - b.y);

  const block = hover ? handle.getBlockRect(hover) : null;
  const ghost =
    hover && block
      ? { blockId: hover, top: Math.round(block.top - origin), height: Math.round(block.height), y: center(block) }
      : null;
  return { markers, ghost };
}

const sameGhost = (a: Ghost | null, b: Ghost | null) =>
  a === b || (a !== null && b !== null && a.blockId === b.blockId && a.top === b.top && a.height === b.height && a.y === b.y);

export function MarkerGlyph({ count, active, compact = false }: { count: number; active: boolean; compact?: boolean }) {
  return (
    <span className={cn("relative grid place-items-center", compact ? "size-5" : "size-6")}>
      <MessageSquare
        aria-hidden
        strokeWidth={1.5}
        className={cn(
          "text-warning transition-colors duration-(--dur-fast)",
          compact ? "size-5" : "size-6",
          active ? "fill-warning-border" : "fill-warning-soft group-hover/marker:fill-warning-border",
        )}
      />
      <span
        className={cn(
          "absolute inset-0 grid place-items-center pb-0.5 leading-none font-medium text-warning-text tabular-nums",
          compact ? "text-[10px]" : "text-[11px]",
        )}
      >
        {count > 9 ? "9+" : count}
      </span>
    </span>
  );
}

export function GutterMarkers({
  editor,
  threads,
  activeThreadId,
  onActivate,
  onRequestBlockComment,
  collapsedKeys,
  compact = false,
  className,
}: GutterMarkersProps) {
  const layer = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const groups = useMemo(() => markerThreads(threads), [threads]);
  const size = compact ? SIZE.compact : SIZE.normal;
  const offset = compact ? OFFSET.compact : OFFSET.normal;

  // Measure now, a frame later (the editor has painted its highlights by then), and whenever the editor
  // says blocks may have moved. The handle may not be there on the first try.
  useLayoutEffect(() => {
    const run = () => {
      const handle = editor.current;
      const box = layer.current;
      if (!handle || !box) return;
      const next = measureLayer(handle, box.getBoundingClientRect().top, groups, hover);
      setMarkers((prev) => (sameMarkers(prev, next.markers) ? prev : next.markers));
      setGhost((prev) => (sameGhost(prev, next.ghost) ? prev : next.ghost));
    };
    run();
    let off: (() => void) | undefined;
    let frame = requestAnimationFrame(run);
    let tries = 0;
    const connect = () => {
      const handle = editor.current;
      if (handle) {
        off = handle.subscribeBlockRects(run);
        run();
      } else if (tries++ < 30) {
        frame = requestAnimationFrame(connect);
      }
    };
    connect();
    return () => {
      off?.();
      cancelAnimationFrame(frame);
    };
  }, [editor, groups, hover]);

  // The block under the pointer, for the hover marker. The pointer is followed on the cell the layer hangs from.
  const canRequest = onRequestBlockComment !== undefined;
  useEffect(() => {
    const host = layer.current?.parentElement;
    if (!host || !canRequest) return;
    const onMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.buttons !== 0) return setHover(null); // a drag is selecting text
      if (!target || layer.current?.contains(target)) return;
      setHover(target.closest(".ucomp-doc > [data-id]")?.getAttribute("data-id") ?? null);
    };
    const onLeave = () => setHover(null);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      setHover(null);
    };
  }, [canRequest]);

  // One tab stop for the whole group: the marker of the active thread, else the one last focused, else the first.
  const activeBlock = markers.find((m) => activeThreadId !== null && m.threadIds.includes(activeThreadId))?.blockId;
  const stop =
    activeBlock ?? (markers.some((m) => m.blockId === focused) ? focused : (markers[0]?.blockId ?? null));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-marker]")?.dataset.marker;
    const current = markers.findIndex((m) => m.blockId === from);
    if (current < 0) return;
    const next = nextMarkerIndex(event.key, current, markers.length);
    if (next === null) return;
    event.preventDefault();
    if (next !== current) buttons.current.get(markers[next].blockId)?.focus();
  };

  // Choosing a marker can move it (the redline reveals a hidden block and the marker is re-keyed onto
  // it, so the focused button is replaced): the thread is remembered and its marker is focused again.
  const refocus = useRef<{ threadId: string; timer: number } | null>(null);
  const forget = () => {
    if (refocus.current) window.clearTimeout(refocus.current.timer);
    refocus.current = null;
  };
  useEffect(() => forget, []);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const marker = markers.find((m) => m.threadIds.includes(want.threadId));
    const button = marker ? buttons.current.get(marker.blockId) : undefined;
    if (!button) return;
    const at = document.activeElement;
    // Focus was lost with the replaced button: take it back. While a marker (the old one, still there
    // for this render) holds it, wait; focus elsewhere was a choice, so leave it. The timer ends the wait.
    if (!at || at === document.body) {
      button.focus();
      forget();
    } else if (!layer.current?.contains(at)) {
      forget();
    }
  }, [markers, activeThreadId]);

  const choose = (marker: Marker) => {
    // A block with several threads: each press goes on to the next.
    const at = activeThreadId === null ? -1 : marker.threadIds.indexOf(activeThreadId);
    const next = marker.threadIds[(at + 1) % marker.threadIds.length];
    forget();
    refocus.current = { threadId: next, timer: window.setTimeout(() => (refocus.current = null), 1000) };
    onActivate(next);
  };

  const hasMarker = ghost ? groups.some((g) => g.blockId === ghost.blockId) : false;

  return (
    <div
      ref={layer}
      data-slot="gutter-markers"
      className={cn(
        "pointer-events-none absolute top-0 bottom-0 left-full",
        compact ? "w-6" : "w-10",
        className,
      )}
    >
      {ghost && !hasMarker ? (
        // The strip is as tall as the block and reaches the text, so the pointer can travel from the text to the marker.
        <div data-slot="block-comment" className="pointer-events-auto absolute inset-x-0" style={{ top: ghost.top, height: ghost.height }}>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Comment on this block"
            onClick={() => onRequestBlockComment?.(ghost.blockId)}
            className="absolute grid place-items-center rounded-md text-text-subtle outline-none transition-colors duration-(--dur-fast) hover:bg-hover hover:text-text-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{ top: ghost.y - ghost.top - size / 2, left: offset, width: size, height: size }}
          >
            <MessageSquarePlus aria-hidden strokeWidth={1.75} className={compact ? "size-3.5" : "size-4"} />
          </button>
        </div>
      ) : null}

      {markers.length > 0 ? (
        <div role="toolbar" aria-label="Comments in the document" aria-orientation="vertical" onKeyDown={onKeyDown}>
          {markers.map((marker) => {
            const active = activeThreadId !== null && marker.threadIds.includes(activeThreadId);
            return (
              <button
                key={marker.blockId}
                ref={(el) => {
                  if (el) buttons.current.set(marker.blockId, el);
                  else buttons.current.delete(marker.blockId);
                }}
                type="button"
                data-marker={marker.blockId}
                aria-label={`${marker.count} ${marker.count === 1 ? "comment" : "comments"} ${collapsedKeys?.has(marker.blockId) ? "in unchanged blocks" : "on this block"}`}
                aria-pressed={active}
                tabIndex={marker.blockId === stop ? 0 : -1}
                onFocus={() => setFocused(marker.blockId)}
                onClick={() => choose(marker)}
                className="group/marker pointer-events-auto absolute grid place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{ top: marker.y - size / 2, left: offset, width: size, height: size }}
              >
                <MarkerGlyph count={marker.count} active={active} compact={compact} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
