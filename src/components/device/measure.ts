"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { FieldFit } from "./types";

// Truncation is read from the rendered phone, not estimated from a character count: each clamped field
// (`data-field`, with `data-max-lines`) is a line-clamped box, and a DOM Range finds the last character
// that shows before the platform's ellipsis. What the author is warned about is what the phone draws.

/** A field the screen doesn't show. */
export const NOT_SHOWN: FieldFit = { shown: false, cut: false, visibleText: "", lines: 0, fullLines: 0, maxLines: 0 };

/** Where one character sits, in the phone's layout px from the field's top left: enough to tell whether it shows. */
export interface CharBox {
  top: number;
  bottom: number;
  right: number;
}

/** The visible part of a clamped box: its last line, and how far right a character may end on it. */
export interface Clip {
  /** The bottom edge of the last visible line. */
  bottom: number;
  /** The top edge of the last visible line. */
  lastLineTop: number;
  /** On the last line, the right edge a character must end before so the ellipsis fits after it. */
  lastLineRight: number;
}

/** Whether a character shows inside a clamped box. */
export function charShows(box: CharBox, clip: Clip): boolean {
  const middle = (box.top + box.bottom) / 2;
  if (middle > clip.bottom) return false;
  if (middle > clip.lastLineTop) return box.right <= clip.lastLineRight + 0.5;
  return true;
}

/**
 * The length of the text that shows. `candidates` are the indexes worth testing (no spaces, no second half
 * of a surrogate pair), in order; `boxOf` gives a candidate's box, or null when it has none (a zero-width
 * character), in which case the nearest earlier candidate with a box answers for it. Characters show as a
 * prefix, so this is a binary search for the last candidate that shows.
 */
export function visibleLength(
  candidates: readonly number[],
  boxOf: (index: number) => CharBox | null,
  clip: Clip,
  charLength: (index: number) => number,
): number {
  let lo = 0;
  let hi = candidates.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let box: CharBox | null = null;
    for (let probe = mid; !box && probe >= 0; probe--) box = boxOf(candidates[probe]!);
    if (box && charShows(box, clip)) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (last === -1) return 0;
  const index = candidates[last]!;
  return index + charLength(index);
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

let canvas: HTMLCanvasElement | null = null;

/** The ellipsis's width in the element's font. */
function ellipsisWidth(style: CSSStyleDeclaration): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if ("letterSpacing" in context) context.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return context.measureText("…").width;
}

/**
 * How many screen px one px of the phone's layout covers: the frame's scale, and any scale round it. The
 * frame's layout width is a whole number of px, so `offsetWidth` is exact.
 */
function screenScale(element: HTMLElement): number {
  const frame = element.closest<HTMLElement>('[data-slot="device-frame"]');
  const scale = frame && frame.offsetWidth > 0 ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
  return scale > 0 ? scale : 1;
}

/** How a line-clamped element's text fits: whether it is cut, where, and on how many lines. */
export function measureField(element: HTMLElement, maxLines: number): FieldFit {
  const text = element.textContent ?? "";
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const fullLines = text.trim() === "" ? 0 : Math.max(1, Math.round(element.scrollHeight / lineHeight));
  const cut = element.scrollHeight - element.clientHeight > lineHeight / 2;
  const lines = Math.min(fullLines, maxLines);
  if (!cut) return { shown: true, cut: false, visibleText: text.trimEnd(), lines, fullLines, maxLines };

  // Positions are in the phone's own layout px, from the element's top left corner: the clip from its
  // layout, each character's box from the screen, unscaled. So the phone's scale (and any round it) changes
  // nothing: the answer is the one at 1:1.
  const rect = element.getBoundingClientRect();
  const scale = screenScale(element);
  const bottom = element.clientTop + element.clientHeight - parseFloat(style.paddingBottom);
  const right = element.clientLeft + element.clientWidth - parseFloat(style.paddingRight);
  const clip: Clip = { bottom, lastLineTop: bottom - lineHeight, lastLineRight: right - ellipsisWidth(style) };

  // The element's text nodes, with where each starts in `text`.
  const nodes: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let offset = 0, node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: offset });
    offset += node.nodeValue?.length ?? 0;
  }
  const charLength = (index: number) => (isHighSurrogate(text.charCodeAt(index)) ? 2 : 1);
  const range = document.createRange();
  const boxOf = (index: number): CharBox | null => {
    let at = nodes[0];
    for (const n of nodes) if (n.start <= index) at = n;
    if (!at) return null;
    const offset = index - at.start;
    range.setStart(at.node, offset);
    range.setEnd(at.node, Math.min(offset + charLength(index), at.node.length));
    const box = range.getClientRects()[0];
    if (!box || (box.width === 0 && box.height === 0)) return null;
    return { top: (box.top - rect.top) / scale, bottom: (box.bottom - rect.top) / scale, right: (box.right - rect.left) / scale };
  };
  const candidates: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!isLowSurrogate(code) && !/\s/.test(text[i]!)) candidates.push(i);
  }
  const visible = visibleLength(candidates, boxOf, clip, charLength);
  return { shown: true, cut: true, visibleText: text.slice(0, visible).trimEnd(), lines, fullLines, maxLines };
}

/** How each `[data-field]` inside `root` fits, by field name. */
export function measureFields(root: HTMLElement): Record<string, FieldFit> {
  const fits: Record<string, FieldFit> = {};
  for (const element of root.querySelectorAll<HTMLElement>("[data-field]")) {
    const name = element.dataset.field;
    if (name) fits[name] = measureField(element, Number(element.dataset.maxLines) || 1);
  }
  return fits;
}

/**
 * Runs `measure` after every render whose `key` changed, when the root resizes and when a web font
 * finishes loading (the text reflows), and reports the result through `onResult` only when it differs from
 * the last one.
 */
export function useMeasure<T>(
  root: RefObject<HTMLElement | null>,
  key: string,
  measure: (root: HTMLElement) => T,
  onResult: ((result: T) => void) | undefined,
) {
  const latest = useRef({ measure, onResult });
  const last = useRef<string | null>(null);
  // Measures now and reports a changed result. Reads the latest props, so the effects below needn't re-run.
  const report = useRef(() => {});
  useLayoutEffect(() => {
    latest.current = { measure, onResult };
    report.current = () => {
      const element = root.current;
      if (!element || !latest.current.onResult) return;
      const result = latest.current.measure(element);
      const json = JSON.stringify(result);
      if (json === last.current) return;
      last.current = json;
      latest.current.onResult(result);
    };
  });

  const enabled = onResult !== undefined;
  useLayoutEffect(() => {
    if (enabled) report.current();
  }, [key, enabled]);

  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    const run = () => report.current();
    const observer = new ResizeObserver(run);
    observer.observe(element);
    document.fonts?.addEventListener("loadingdone", run);
    void document.fonts?.ready.then(run);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", run);
    };
  }, [root, enabled]);
}
