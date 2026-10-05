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
// The bleed is for the rail. Below the rail's breakpoint there is none beside the main pane, so the
// pane must not run flush to the panel's right edge: the grid gives the canvas's padding back
// (`pr-(--canvas-pad-x)`, 48px, the same inset as the left, less the 20px that `pl-5` adds), and the
// rail, which opens as an overlay there, takes the bleed on itself (`-mr`) so it is still flush with the
// panel. The grid cannot ask about its own width (a container query matches an ancestor), so that
// padding is keyed to the canvas: the grid is 28px wider than the canvas's content box (its 48px bleed
// less its 20px `pl-5`), so 53rem of grid is 820px = 51.25rem of canvas. Keep the two in step.
//
// The block handle (+ and the grip, about 55px) hangs left of the document's text edge. The canvas
// pad alone (3rem) would put it against the panel's border, so the whole main pane starts 1.25rem
// further in (`pl-5` on the grid; the title, the tabs and the text still share one left edge) and the
// editor's gutter is widened by the same amount, so the handle's hover area ends at the panel edge
// and clears it by about 13px.
//
// The rail column keeps its width on every tab (`railSpace`, rendered by the layout), so the header
// and tab bar stay put when you switch from Content to a tab without a rail.

// Preview (Sri's pick: "the rail widens into the preview"). While the preview is open the rail column
// grows to --rail-preview-w, about 52% of the workspace (the canvas panel's inside: the grid's content
// width plus the 68px left of it), but never so wide that the document keeps less than a 400px text
// column; the gap between the text and the rail closes from 2.5rem to 1.5rem. Header, tab bar and
// document are in column 1, so they narrow with it. Everything is CSS: `data-preview` on the rail
// switches the width, `--rail-preview-w` is defined here on the grid, and the width and margin
// transition (the global reduced-motion rule shortens that to nothing). The sizes are measured, so
// the rail has no JS size and nothing shifts on load: 1440px window 604px rail / 466px text column,
// 1280px window 510px / 400px.
//
//   --rail-preview-w = min( 52% of (100cqw + 68px),  100cqw - 424px,  60rem )
//                                                    ^ 424 = 400 text column + 24 gap
//
// The rail's contents sit in an inner box of fixed width, pinned to the rail's right edge, so the
// widening reveals them instead of re-wrapping them frame by frame. The tab bar is its own container
// (`@container/bar`): in the narrower column its buttons compact (see workspace-actions.tsx).
//
// Below the breakpoint the rail is an overlay, and the preview opens it across the whole canvas.
//
// The rail turns into an overlay below 53rem of grid width (a container query on the grid, about a
// 56rem canvas); the number appears as `@min-[53rem]/ws` in `rail` and in the toggle. The grid is the named container
// `ws` and every query against it says so: an unnamed query matches the NEAREST container of any name,
// which inside the tab bar (`@container/bar`) would be the bar.
//
// The tab bar always fits its box, which is what keeps the canvas from scrolling sideways. It is
// `@container/bar` and its buttons compact in three steps (workspace-actions.tsx): the Preview label gives
// way to the icon, then "Submit for review" to "Submit", and last, below the breakpoint only, the tabs
// and the button tighten (14px labels, 12px between them, 12px padding in the button). A bar narrower
// than what it holds spills its right end out of the grid, and the canvas, which has overflow-y: auto and
// so scrolls sideways too, grows by the same amount. What the bar needs (tabs, the gap, buttons) depends
// on the rail toggle, which shows only below the breakpoint, and the gap, which is 24px beside the rail
// and 12px below it:
//
//                      full   step 1   step 2   step 3     steps start at (bar width)
//   beside the rail    566    470      403      -          34rem, 28rem
//   with the toggle    598    502      435      402        39rem, 33rem, 28rem   (`@max-[53rem]/ws:@max-[39rem]/bar:`)
//
// Beside the rail the steps stay where they were, so the wide layouts do not move (there the bar can
// still run a few pixels over its right end, into the gap before the rail, and never as far as the
// canvas). Below the breakpoint the bar is the grid less its 48px right inset (a window's width minus
// about 394px), which is what these steps are measured against: 800px fits at step 3 with 4px to spare
// (draft, "Submit") and a bar under 402px, a window under about 796px, cannot fit its tabs and buttons.
// The figures are for the draft's Submit button; the Active template's Edit button is 2px narrower.

export const WS = {
  grid: "@container/ws relative pl-5 mr-[calc(-1*(var(--canvas-pad-x)+max(0px,(100cqw-96rem)/2)))] @max-[51.25rem]/canvas:pr-(--canvas-pad-x) -mb-14 grid min-h-(--ws-h) grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_2.75rem_1fr] [--ws-h:calc(100svh-5.5rem-2px)] [--rail-preview-w:min(calc((100cqw+68px)*0.52),calc(100cqw-424px),60rem)]",

  /** Holds the rail column's width on tabs without a rail (same size and breakpoint as `rail`). */
  railSpace: "pointer-events-none invisible col-start-2 row-start-1 hidden h-px w-80 @min-[53rem]/ws:ml-10 @min-[53rem]/ws:block",

  /** Name, status row, ID and SHARE ring. */
  header: "col-start-1 row-start-1 w-full max-w-(--doc-width) justify-self-center pt-2 pb-6",

  /** Tabs and the template's actions. Spans rows 2 and 3 so it can stay stuck to the top while the document scrolls. */
  tabs: "@container/bar sticky top-0 z-20 col-start-1 row-start-2 row-end-4 flex h-11 w-full max-w-(--doc-width) items-start justify-between gap-6 @max-[53rem]/ws:gap-3 self-start justify-self-center border-b border-hairline bg-canvas @max-[34rem]/bar:[&_nav]:gap-4 @max-[53rem]/ws:@max-[39rem]/bar:[&_nav]:gap-4 @max-[53rem]/ws:@max-[28rem]/bar:[&_nav]:gap-3 @max-[53rem]/ws:@max-[28rem]/bar:[&_nav_a]:text-[14px]",

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
   *
   * `data-preview` (the preview is open) widens it: to --rail-preview-w beside the document; as an
   * overlay, to the whole canvas (it bleeds left through the grid's 1.25rem and the canvas's own
   * padding, to the panel's edge, and drops its border there). `rail` is also the group name its contents key on (`group/rail`).
   * Widened, it pads its sides 20px (`data-[preview]:px-5`), the normal rail's content edge: 12px of padding and the 8px inside it.
   */
  rail: "group/rail sticky top-0 z-30 col-start-1 col-end-3 row-start-1 row-end-4 hidden h-(--ws-h) w-80 self-start justify-self-end overflow-x-hidden overflow-y-auto border-l border-hairline bg-canvas px-3 pt-[17px] pb-14 shadow-pop -mr-(--canvas-pad-x) transition-[width,margin-left] duration-(--dur-base) ease-(--ease-out-soft) data-[open]:block data-[preview]:w-[calc(100%+1.25rem+2*var(--canvas-pad-x))] data-[preview]:border-l-0 data-[preview]:px-5 data-[preview]:pb-3 @min-[53rem]/ws:col-start-2 @min-[53rem]/ws:col-end-auto @min-[53rem]/ws:mr-0 @min-[53rem]/ws:ml-10 @min-[53rem]/ws:block @min-[53rem]/ws:z-auto @min-[53rem]/ws:shadow-none @min-[53rem]/ws:data-[preview]:ml-6 @min-[53rem]/ws:data-[preview]:w-(--rail-preview-w) @min-[53rem]/ws:data-[preview]:border-l",

  /**
   * The box inside the rail that holds everything. Its width is the rail's final width in each state
   * (296px beside the document, the preview width when widened, the canvas overlay's), pinned to the
   * right edge, so a widening or narrowing rail reveals or hides it without reflowing it. On the
   * preview view it is exactly as tall as the rail's content area, so the output scrolls on its own.
   * Beside the document the widened rail's content box is the preview width less the 20px side padding and the 1px border (`2.5rem+1px`).
   */
  railInner:
    "ml-auto flex w-74 flex-col group-data-[preview]/rail:w-full group-data-[view=preview]/rail:h-full group-data-[preview]/rail:@min-[53rem]/ws:w-[calc(var(--rail-preview-w)-2.5rem-1px)]",
} as const;
