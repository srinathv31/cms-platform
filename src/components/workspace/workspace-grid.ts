// The grid of one template workspace (layout C, "Rail").
//
//             col 1 (main pane)                       col 2 (rail)
//   row 1     header                                  ┐
//   row 2     tab bar (sticky)                        │ the rail: Channels, then Variables
//   row 3     the tab's document                      ┘ (Content tab only)
//
// The layout renders the header and the tab bar; the page renders its own cells. They are all direct
// children of the grid element, each placed by explicit line numbers, so the rail (a sibling of the
// document inside the Content page) can sit beside the header although it is rendered by the page.
// Next adds no DOM between the layout's element and a page's nodes (Suspense and the hidden
// <Activity> of a previous route included), so these classes are the only coupling.
//
// Every page of the workspace renders cells from this file: `WS.doc` for its main node, and on the
// Content tab `WS.rail` for the rail. A fallback uses the same cell as what it stands in for.
//
// The canvas the grid sits in (AppFrame's scroll area) pads its content by --canvas-pad-x on the sides
// and 3.5rem below, and scrolls as one. The rail is flush with the panel's right edge and bottom, so
// the grid bleeds out through that padding (-mr, -mb) and the document cell puts the bottom padding
// back. AppFrame also caps its content at 96rem and centers it; on a wider canvas (a viewport over
// about 1900px) the grid bleeds through that gap too, measured against the canvas's size container
// (`@container/canvas` in app-frame.tsx): max(0, (100cqw - 96rem) / 2). The rail is as tall as the
// scroll area: 100svh minus the panel's chrome (the 4rem top bar, the panel's 0.75rem margins above
// and below, and its two 1px borders). Keep 5.5rem + 2px and 96rem in step with app-frame.tsx.
//
// The block handle (+ and the grip, about 55px) hangs left of the document's text edge. The canvas
// pad alone (3rem) would put it against the panel's border, so the whole main pane starts 1.25rem
// further in (`pl-5` on the grid; the title, the tabs and the text still share one left edge) and the
// editor's gutter is widened by the same amount, so the handle's hover area ends at the panel edge
// and clears it by about 13px.
//
// The rail column keeps its width on every tab (`railSpace`, rendered by the layout), so the header
// and tab bar stay put when you switch from Content to a tab without a rail.

// The rail turns into an overlay below 53rem of grid width (a container query on the grid, about a
// 56rem canvas); the number appears as `@min-[53rem]` in `rail` and `@max-[53rem]` in the toggle.

export const WS = {
  grid: "@container relative pl-5 mr-[calc(-1*(var(--canvas-pad-x)+max(0px,(100cqw-96rem)/2)))] -mb-14 grid min-h-(--ws-h) grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_2.75rem_1fr] [--ws-h:calc(100svh-5.5rem-2px)]",

  /** Holds the rail column's width on tabs without a rail (same size and breakpoint as `rail`). */
  railSpace: "pointer-events-none invisible col-start-2 row-start-1 hidden h-px w-80 @min-[53rem]:ml-10 @min-[53rem]:block",

  /** Name, status row, ID and SHARE ring. */
  header: "col-start-1 row-start-1 w-full max-w-(--doc-width) justify-self-center pt-2 pb-6",

  /** Tabs and the template's actions. Spans rows 2 and 3 so it can stay stuck to the top while the document scrolls. */
  tabs: "sticky top-0 z-20 col-start-1 row-start-2 row-end-4 flex h-11 w-full max-w-(--doc-width) items-start justify-between gap-6 self-start justify-self-center border-b border-hairline bg-canvas",

  /**
   * The tab's main node: the document, or another tab's placeholder. The deep bottom padding lets the
   * last section scroll up, so a menu opened at the end of the document has room below the caret.
   */
  doc: "col-start-1 row-start-3 w-full min-w-0 max-w-(--doc-width) justify-self-center pt-8 pb-[max(3.5rem,40svh)] [--ucomp-doc-gutter:calc(var(--canvas-pad-x)+1.25rem)]",

  /**
   * The rail: Channels above Variables. A flush strip beside the whole main pane, as tall as the scroll
   * area and sticky, with its own scroll. Below the breakpoint it is closed, and `data-open` lays it
   * over the right edge of the canvas. The 17px of top padding puts the first label ("Channels") on the
   * baseline of the name's first line (measured: both at y=109 on a 1440 canvas).
   */
  rail: "sticky top-0 z-30 col-start-1 col-end-3 row-start-1 row-end-4 hidden h-(--ws-h) w-80 self-start justify-self-end overflow-y-auto border-l border-hairline bg-canvas px-3 pt-[17px] pb-14 shadow-pop data-[open]:block @min-[53rem]:col-start-2 @min-[53rem]:col-end-auto @min-[53rem]:ml-10 @min-[53rem]:block @min-[53rem]:z-auto @min-[53rem]:shadow-none",
} as const;
