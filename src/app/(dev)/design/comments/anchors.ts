"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import type { Anchor } from "./types";

/*
 * Where things are in the document, in the document wrapper's own coordinates (0,0 = the text
 * column's top left corner), so markers, highlight tints and margin cards can be absolutely
 * positioned in the same box and scroll with the page.
 *
 * Highlights use the CSS Custom Highlight API (Chrome), which paints ranges without touching the
 * DOM. The real editor draws them as ProseMirror decorations; what it must provide is listed in the
 * mock's report.
 */

export interface BlockGeom {
  id: string;
  top: number;
  height: number;
  /** The first line of the block (a table's first row, a list's first item). */
  lineTop: number;
  lineHeight: number;
}

export interface Geometry {
  /** Width of the text column. */
  width: number;
  height: number;
  blocks: Record<string, BlockGeom>;
  /** Centre of a quote's first line, by thread id (only for threads with a quote that is found). */
  quotes: Record<string, number>;
}

export const EMPTY_GEOMETRY: Geometry = { width: 0, height: 0, blocks: {}, quotes: {} };

export function topLevelBlocks(wrap: HTMLElement): HTMLElement[] {
  const doc = wrap.querySelector(".ucomp-doc");
  return doc ? (Array.from(doc.children) as HTMLElement[]) : [];
}

export function blockIdOf(el: Element): string | null {
  const own = el.getAttribute("data-id");
  if (own) return own;
  return el.querySelector("[data-id]")?.getAttribute("data-id") ?? null;
}

export function blockElement(wrap: HTMLElement, id: string): HTMLElement | null {
  return topLevelBlocks(wrap).find((el) => blockIdOf(el) === id) ?? null;
}

/** The top-level block a node sits in. */
export function blockOfNode(wrap: HTMLElement, node: Node | null): HTMLElement | null {
  const doc = wrap.querySelector(".ucomp-doc");
  let el: Node | null = node;
  while (el && el.parentNode !== doc) el = el.parentNode;
  return el instanceof HTMLElement ? el : null;
}

/** A Range over `quote` in a block, or null when the text is not there. */
export function rangeForQuote(block: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  const at = text.indexOf(quote);
  if (at < 0) return null;
  const end = at + quote.length;
  const locate = (offset: number, preferEnd: boolean) => {
    for (const { node, start } of nodes) {
      const len = node.data.length;
      if (offset < start + len || (preferEnd && offset === start + len)) return { node, offset: offset - start };
    }
    return null;
  };
  const from = locate(at, false);
  const to = locate(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function firstLine(block: HTMLElement): HTMLElement {
  return block.matches("p, h1, h2, h3") ? block : (block.querySelector<HTMLElement>("p, h1, h2, h3") ?? block);
}

export function measure(wrap: HTMLElement, quotes: { id: string; blockId: string; quote: string }[]): Geometry {
  const base = wrap.getBoundingClientRect();
  const blocks: Record<string, BlockGeom> = {};
  for (const el of topLevelBlocks(wrap)) {
    const id = blockIdOf(el);
    if (!id) continue;
    const rect = el.getBoundingClientRect();
    const line = firstLine(el);
    const lineRect = line.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight) || 27;
    blocks[id] = { id, top: rect.top - base.top, height: rect.height, lineTop: lineRect.top - base.top, lineHeight };
  }
  const quoteY: Record<string, number> = {};
  for (const q of quotes) {
    const el = blockElement(wrap, q.blockId);
    const range = el ? rangeForQuote(el, q.quote) : null;
    const rect = range?.getClientRects()[0];
    if (rect) quoteY[q.id] = rect.top - base.top + rect.height / 2;
  }
  return { width: base.width, height: base.height, blocks, quotes: quoteY };
}

/** Measures the document wrapper now and whenever it, its fonts or the window change. `quotes` must be memoized. */
export function useGeometry(
  wrapRef: RefObject<HTMLElement | null>,
  quotes: { id: string; blockId: string; quote: string }[],
): Geometry {
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY);

  const run = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const next = measure(wrap, quotes);
    setGeometry((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [wrapRef, quotes]);

  useLayoutEffect(() => {
    run();
  }, [run]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(run);
    observer.observe(wrap);
    const doc = wrap.querySelector(".ucomp-doc");
    if (doc) observer.observe(doc);
    document.fonts?.ready.then(run);
    return () => observer.disconnect();
  }, [run, wrapRef]);

  return geometry;
}

// ── Highlights ───────────────────────────────────────────────────

type HighlightName = "cm-open" | "cm-active" | "cm-pending";

function setHighlight(name: HighlightName, ranges: Range[]) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  if (ranges.length === 0) CSS.highlights.delete(name);
  else CSS.highlights.set(name, new Highlight(...ranges));
}

export function paintHighlights(
  wrap: HTMLElement,
  items: { quote: string; blockId: string; kind: "open" | "active" | "pending" }[],
) {
  const groups: Record<HighlightName, Range[]> = { "cm-open": [], "cm-active": [], "cm-pending": [] };
  for (const item of items) {
    const el = blockElement(wrap, item.blockId);
    const range = el ? rangeForQuote(el, item.quote) : null;
    if (range) groups[`cm-${item.kind}`].push(range);
  }
  (Object.keys(groups) as HighlightName[]).forEach((name) => setHighlight(name, groups[name]));
}

export function clearHighlights() {
  (["cm-open", "cm-active", "cm-pending"] as HighlightName[]).forEach((name) => setHighlight(name, []));
}

// ── Selection ────────────────────────────────────────────────────

export interface SelectionInfo extends Anchor {
  rect: { top: number; bottom: number; left: number; width: number };
}

/** The selection, if it is inside the document: the block it starts in, its text there, and where it is on screen. */
export function readSelection(wrap: HTMLElement): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const doc = wrap.querySelector(".ucomp-doc");
  if (!doc || !doc.contains(range.startContainer) || !doc.contains(range.endContainer)) return null;
  const block = blockOfNode(wrap, range.startContainer);
  const blockId = block ? blockIdOf(block) : null;
  if (!block || !blockId) return null;
  // A selection that runs on into the next block is anchored to the block it starts in, and quotes what is in that block.
  const inBlock = range.cloneRange();
  if (!block.contains(range.endContainer)) inBlock.setEnd(block, block.childNodes.length);
  const quote = inBlock.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;
  const rect = inBlock.getBoundingClientRect();
  return { blockId, quote: quote.length > 180 ? `${quote.slice(0, 177)}…` : quote, rect };
}
