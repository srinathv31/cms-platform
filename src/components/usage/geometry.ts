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
