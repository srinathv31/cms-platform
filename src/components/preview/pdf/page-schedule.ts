// The PDF controller's decisions as pure functions of numbers and flags: which pages of a new document
// would be on screen, which queued page is drawn next, and when a page on screen is out of date. No DOM,
// no pdf.js. `pdf-controller.ts` measures the page, asks here, and acts on the answer.

import type { PageSize } from "./page-layers";

/** At most this many pages are drawn before a swap; the rest render as they come into view. */
export const MAX_PREPARED_PAGES = 4;

/** Rounds of the idle text fill that find only pages with a render of their own before it gives up. */
export const MAX_BUSY_ROUNDS = 20;

/** The part of the window where pages can be seen, as top and bottom edges in the same coordinates as the pages. */
export interface Band {
  top: number;
  bottom: number;
}

/**
 * The pages of a document with these sizes that would be on screen if it replaced the current one:
 * pages laid one under the other, each `width` wide, `gap` apart, the first starting at `firstTop`.
 * A page counts when any of it is in `band`; at most `limit` are returned, the first ones.
 */
export function pagesInBand(
  sizes: readonly PageSize[],
  width: number,
  { firstTop, gap }: { firstTop: number; gap: number },
  band: Band,
  limit = MAX_PREPARED_PAGES,
): number[] {
  const indices: number[] = [];
  let top = firstTop;
  for (let index = 0; index < sizes.length && top < band.bottom; index++) {
    const height = (width * sizes[index].height) / sizes[index].width;
    if (top + height > band.top) indices.push(index);
    if (indices.length === limit) break;
    top += height + gap;
  }
  return indices;
}

/** A queued page and where it is on screen. */
export interface Placed<T> {
  item: T;
  top: number;
  bottom: number;
}

/**
 * The queued page nearest the middle of the band, by the middle of the page. The first one wins a tie,
 * so pages queued earlier go first. Null for an empty queue.
 */
export function nearestToMiddle<T>(
  queued: readonly Placed<T>[],
  band: Band,
): T | null {
  const middle = (band.top + band.bottom) / 2;
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const { item, top, bottom } of queued) {
    const distance = Math.abs((top + bottom) / 2 - middle);
    if (distance < bestDistance) [best, bestDistance] = [item, distance];
  }
  return best;
}

/** The pixel width a page's canvas is drawn at: its CSS width times the device pixel ratio, at least 1. */
export function canvasPixelWidth(renderWidth: number, pixelRatio: number) {
  return Math.max(1, Math.round(renderWidth * pixelRatio));
}

/**
 * What a canvas on screen was drawn for: the document (`generation`) and its pixel width. A canvas
 * with another key is out of date, and a slot's render job with this key is already drawing it.
 */
export function canvasKey(generation: number, pixelWidth: number): string {
  return `${generation}:${pixelWidth}`;
}

/** What a slot (a page's box) holds and is doing. */
export interface SlotFacts {
  index: number;
  /** The key of the canvas on screen, "" for none. */
  canvasKey: string;
  /** The generation of the text layer on screen, -1 for none. */
  textGeneration: number;
  /** The key of the render in flight for it, null for none. */
  jobKey: string | null;
}

/** What a slot still lacks for a document: the canvas at this key, and the text layer of this generation. */
export function lacks(
  slot: Pick<SlotFacts, "canvasKey" | "textGeneration">,
  key: string,
  generation: number,
): { canvas: boolean; text: boolean } {
  return {
    canvas: slot.canvasKey !== key,
    text: slot.textGeneration !== generation,
  };
}

/**
 * Whether a slot needs a render for the document on screen: it is a page of it, near the viewport, the
 * pages have a width, something it holds is out of date, and no render for this very key is in flight.
 * A render for another key (another width, another document) is replaced.
 */
export function needsRender(
  slot: SlotFacts,
  doc: { generation: number; numPages: number },
  view: { near: boolean; renderWidth: number; key: string },
): boolean {
  if (slot.index >= doc.numPages || view.renderWidth < 1) return false;
  if (!view.near) return false;
  const missing = lacks(slot, view.key, doc.generation);
  if (!missing.canvas && !missing.text) return false;
  return slot.jobKey !== view.key;
}

/**
 * The slots, in the order given, whose text layer isn't built for `generation` yet and that the fill
 * hasn't tried: the pages nobody has scrolled to.
 */
export function slotsMissingText<
  T extends Pick<SlotFacts, "index" | "textGeneration">,
>(
  slots: Iterable<T>,
  doc: { generation: number; numPages: number },
  tried: ReadonlySet<T>,
): T[] {
  return [...slots].filter(
    (slot) =>
      slot.index < doc.numPages &&
      slot.textGeneration !== doc.generation &&
      !tried.has(slot),
  );
}

/**
 * The first of `missing` whose text nobody else is building: no render in flight for it and none
 * queued, and still lacking its text (a render may have built it since `missing` was made).
 */
export function firstFreeForText<T extends Pick<SlotFacts, "textGeneration">>(
  missing: readonly T[],
  generation: number,
  hasRender: (slot: T) => boolean,
): T | undefined {
  return missing.find(
    (slot) => !hasRender(slot) && slot.textGeneration !== generation,
  );
}
