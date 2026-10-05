// The grid of the review screen: the template workspace's grid (components/workspace/workspace-grid.ts),
// with the decision rail where the workspace has its own.
//
//             col 1 (main pane)                         col 2 (the decision rail)
//   row 1     header                                    ┐
//   row 2     view tabs (sticky)                        │ the rail: stepper, Approve / Request changes,
//   row 3     the tab's document or output              │ then the note, the contract and the comments
//   row 4     (stacked layout only: the rail)           ┘
//
// The header, the tabs and the document sit in the workspace's own cells, so the title, the tabs and
// the text share one left edge with the workspace's, and the rail is the same flush strip: sticky, as
// tall as the canvas's scroll area, a hairline at its left, its own scroll. Its first label ("Approval")
// sits on the line of the header's eyebrow ("Review": both are 6px and 8px below the top, centered on
// a 24px and a 20px row). The review rail is 22rem against the
// workspace's 20rem: it holds sentences, not controls.
//
// Below 53rem of grid width (a container query on the grid, the named container `ws`) the rail
// stacks under the main pane, full width with a hairline above it. Approve has to stay reachable, so
// the rail never turns into an overlay here, and a decision bar sticks to the bottom of the main pane
// (decision-bar.tsx) so the two decisions are never a long scroll away.
//
// The tab bar always fits its box (it never wraps: a wrapped bar would slide under the document):
// "vs v2" and the change count give way first, in the bar's own container.

import { WS } from "@/components/workspace/workspace-grid";

/** Matches `@min-[53rem]/ws` in the classes below. */
export const RAIL_BREAKPOINT_REM = 53;

/**
 * Stacked, the grid bleeds out to the panel's right edge (as the workspace's does) and the rail has
 * its own padding there; the main pane's cells give the canvas padding back so text and tables don't
 * touch the edge. Beside the rail the cells end at the 2.5rem gap instead.
 */
const STACKED_PR = "@max-[53rem]/ws:pr-(--canvas-pad-x)";

export const RV = {
  /** The workspace's grid, unchanged: container `ws`, the bleed through the canvas padding, the --ws-h height. */
  grid: WS.grid,

  /** The eyebrow link, the name, the status row and the SHARE ring slot. */
  header: `${WS.header} ${STACKED_PR}`,

  /** Tabs and the view's own tools. Sticky, one 44px line over a hairline. */
  tabs: `${STACKED_PR} @container/bar sticky top-0 z-20 col-start-1 row-start-2 row-end-4 flex h-11 w-full max-w-(--doc-width) items-start justify-between gap-6 self-start justify-self-center border-b border-hairline bg-canvas`,

  /** The document or the output: the workspace's cell (text on the column's left edge, the gutter hanging left). */
  doc: `${WS.doc} ${STACKED_PR}`,

  /**
   * The output: the document's cell, with a height of its own (the well scrolls inside it). Stacked, the
   * decision bar covers the bottom of the cell, so the well ends above it (the bar's 57px and 15px of air).
   */
  output: `col-start-1 row-start-3 flex h-[max(30rem,calc(var(--ws-h)-10.5rem))] w-full min-w-0 max-w-(--doc-width) flex-col justify-self-center pt-2 pb-3 @max-[53rem]/ws:pb-[4.3rem] ${STACKED_PR}`,

  /**
   * The rail. Wide: a sticky strip beside the whole main pane. Stacked: the grid's fourth row, flush to
   * the panel's left and right edges (it bleeds left through the grid's 1.25rem and the canvas padding)
   * with the text edge's 68px of padding, so what it holds lines up with the document above.
   * `--rail-pl` and `--rail-pr` are what its two sections pad their sides with.
   */
  rail: [
    "relative z-30 col-start-1 row-start-4 flex flex-col border-t border-hairline bg-canvas",
    "-ml-[calc(var(--canvas-pad-x)+1.25rem)] [--rail-pl:calc(var(--canvas-pad-x)+1.25rem)] [--rail-pr:var(--canvas-pad-x)]",
    "@min-[53rem]/ws:sticky @min-[53rem]/ws:top-0 @min-[53rem]/ws:col-start-2 @min-[53rem]/ws:row-start-1 @min-[53rem]/ws:row-end-5",
    "@min-[53rem]/ws:ml-10 @min-[53rem]/ws:h-(--ws-h) @min-[53rem]/ws:w-88 @min-[53rem]/ws:self-start",
    "@min-[53rem]/ws:border-t-0 @min-[53rem]/ws:border-l @min-[53rem]/ws:[--rail-pl:1.25rem] @min-[53rem]/ws:[--rail-pr:1.25rem]",
  ].join(" "),

  /**
   * Stacked only: the decision bar, stuck to the bottom of the main pane (it spans the document's row and
   * sits at its end), flush to the panel's left, right and bottom edges, with its content on the text
   * edge. A sticky box rests above the scroll area's own bottom padding (3.5rem), so its `bottom` takes
   * that back. The right 7rem stays clear of the Demo pill (fixed, bottom right).
   */
  bar: "sticky bottom-[-3.5rem] z-20 col-start-1 row-start-3 -mr-(--canvas-pad-x) -ml-[calc(var(--canvas-pad-x)+1.25rem)] flex items-center gap-2 self-end h-[3.5625rem] border-t border-hairline bg-canvas pr-28 pl-[calc(var(--canvas-pad-x)+1.25rem)] @min-[53rem]/ws:hidden",

  /** The rail's top section (the stepper and the decision), pinned above the scroll. */
  railHead: "shrink-0 border-b border-hairline pt-1.5 pb-4 pl-(--rail-pl) pr-(--rail-pr)",

  /** The rail's scrolling section. Stacked, it simply flows: the canvas scrolls. */
  railBody:
    "pt-5 pb-14 pl-(--rail-pl) pr-(--rail-pr) @min-[53rem]/ws:min-h-0 @min-[53rem]/ws:flex-1 @min-[53rem]/ws:overflow-y-auto @min-[53rem]/ws:overscroll-contain",
} as const;
