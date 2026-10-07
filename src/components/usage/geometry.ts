import { cn } from "@/lib/utils";
import { WS } from "@/components/workspace/workspace-grid";

// Sizes the Usage screens and their skeletons share, so the skeleton has the real geometry and
// nothing moves when the data lands.

/** Chart heights, in px. */
export const BARS_HEIGHT = 220;
/** The legend row under the bars; the failure line adds it to its own height so both cards end together. */
export const LEGEND_ROW = "mt-3 h-5";
/** The legend row's height with its top margin, in px (mt-3 + h-5). */
export const LEGEND_HEIGHT = 32;
/** The failure card's chart and its caption row together are as tall as the bars and their legend. */
export const RATE_HEIGHT = BARS_HEIGHT + LEGEND_HEIGHT;
/** A stat card's floor, so the three read as one row whatever they hold. */
export const STAT_CARD = "min-h-[18.5rem] lg:col-span-2";
/** Bars in "Top templates". */
export const TOP_TEMPLATES = 5;
/** A labelled bar row in "Top templates" (label 18px, gap 6px, bar 36px) and the gap between rows. */
const HBAR_ROW = 60;
const HBAR_GAP = 16;
/** The least height a list of `rows` labelled bars may have, so a card with fewer rows keeps its size. */
export function hbarsMinHeight(rows: number): number {
  return rows * HBAR_ROW + Math.max(0, rows - 1) * HBAR_GAP;
}

/** The heatmap's squares and the gap between them, in the units it is drawn at. */
export const HEAT_CELL = 18;
const HEAT_GAP = 4;
export const HEAT_PITCH = HEAT_CELL + HEAT_GAP;
/** The heatmap's height for a given column count, as the width the squares are drawn at: used by the skeleton too. */
export function heatmapBox(weeks: number) {
  return { width: weeks * HEAT_PITCH - HEAT_GAP, height: 7 * HEAT_PITCH - HEAT_GAP };
}

// The template's Usage tab (template-usage.tsx): its cell's layout is described there.

export const TEMPLATE_BARS_HEIGHT = 210;
/** Classes of the tab's cell, shared with the skeleton. */
export const USAGE_CELL = cn(
  WS.doc,
  "col-end-3 w-[min(calc(100%-var(--canvas-pad-x)),calc(var(--doc-width)+22.5rem-var(--canvas-pad-x)))] max-w-none justify-self-start ml-[max(0px,calc((100%-var(--doc-width)-22.5rem)/2))] @max-[51.25rem]/canvas:w-full",
);
export const USAGE_COLUMNS = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]";
