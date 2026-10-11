# 0045. Stencil targets desktop Chrome and reflows for zoom

Status: Accepted
Amended 2026-10-11: the editor's block handle fits the document gutter at 320px (its two buttons stack there), and the review header's name and byline wrap below 800px instead of truncating (N27).
Date: 2026-10-11

## Context

Stencil is an internal tool, used on work laptops in Chrome. Nobody opens it on a phone. But accessibility still
applies, and one rule reaches a laptop user: a person who zooms Chrome to 400% on a 1280px-wide screen has a 320 CSS px
window. WCAG 2.1 SC 1.4.10 (Reflow) asks that content work at that width without scrolling in two directions, apart
from parts that need a two-dimensional layout (data tables, charts, the document canvas).

The shell did not do that. The sidebar was `collapsible="none"`, 16.5rem wide at every width, so at 390px the canvas
was 112px, a template's Usage tab was 0px wide, and every screen clipped without scrolling the page
([handoff review N27](../handoff-review.md#n27--low-below-about-800px-wide-the-always-open-sidebar-leaves-a-screen-no-room-the-usage-tab-included)).
The UI checklist promised no horizontal overflow only from 800px.

## Decision

- **Supported: desktop Chrome on work laptops.** There is no separate mobile design, no touch-specific controls, no
  mobile browsers in the test matrix. Narrow windows are supported as zoom, not as a device class.
- **The UI reflows down to 320 CSS px (WCAG 1.4.10).** At 320px wide, nothing the page shows needs a horizontal
  scroll of the page or of the canvas (`main[data-slot="sidebar-inset"]`'s scroll area).
- **Exceptions, each scrolling inside its own box and never the page**: data tables (the Usage tabs' tables, in a
  [`ScrollRegion`](../../src/components/primitives/scroll-region.tsx) that takes a Tab stop once it scrolls; the variable
  contract; Coral's tables), the document canvas's own tables, the charts' plot areas, the phone previews (scaled to
  fit, true proportions), and a tab strip wider than the screen. The Library, the review queue and the workspace
  header stack or wrap instead.
- **The shell has one breakpoint, 800px.** From 800px up the sidebar is the fixed column it was, and nothing at 800px or
  wider changes. Below it the sidebar is a drawer: the shadcn sidebar's sheet (`collapsible="offcanvas"`, which
  [ui/sidebar.tsx](../../src/components/ui/sidebar.tsx) renders below its `useIsMobile` breakpoint), opened by a button
  in the top bar (`NavDrawerTrigger`, "Open navigation"), and the canvas takes the width. 800px is where the checklist
  already stopped promising ("no overflow from 800px"), where a canvas with the sidebar drops under about 520px, and
  where the Usage tab's 374px at 768px starts to be a cramp. shadcn's default is 768px, so
  [use-mobile.ts](../../src/hooks/use-mobile.ts) says 800 and `globals.css` has the same number in its `narrow:` and
  `wide:` variants. [use-mobile.test.ts](../../src/hooks/use-mobile.test.ts) checks that they agree.
- **A layout that cannot fit gives up room, in this order**, always keyed to the canvas, not the window: the canvas
  padding (3rem to 1rem below 800px), then rows stack, then a toolbar wraps, then a data region scrolls. The stacking
  breakpoint is 26rem of canvas (about 470px of window in drawer mode): one step under the narrowest canvas the shell
  already served with its sidebar (426px, a window of 800px), so no screen from 800px up changes.

## Alternatives considered

- **Say narrow windows are out of scope and keep 800px as the floor.** Cheapest, and true to who uses the app, but a
  laptop user at 250% zoom or more would get clipped screens with no way to read them, and 1.4.10 is a requirement
  regardless of who the users are.
- **A mobile layout of its own.** There is no user for it, and it would be a second design to keep in step.
- **shadcn's default breakpoint (768px).** One less edit to a generated file, but between 768 and 800px the canvas
  stays under 520px with the sidebar open, which the checklist never promised.
- **Collapse the sidebar with `collapsible="offcanvas"` at every width.** Its desktop mode puts the column in a fixed
  box with its own gap and padding, which would move the laptop layout by a few pixels. The wrapper in
  [app-sidebar.tsx](../../src/components/app-shell/app-sidebar.tsx) picks `"none"` above the breakpoint, so the laptop
  layout is the one it always had.

## Consequences

- A new screen is checked at 320px wide before it ships ([ui-checklist](../reference/ui-checklist.md#layout)).
  [e2e/reflow.spec.ts](../../e2e/reflow.spec.ts) fails the Library, a template's Usage tab and the review screen if
  the canvas scrolls sideways at 320px, and checks that the drawer opens from its button.
- The comment markers have to fit the narrow canvas: below 800px the document pads its right side 2.5rem for them.
  The editor's block handle hangs left of the text and was not checked at 320px.
- Layout classes for a narrow canvas use `@max-[26rem]/canvas:`, and for the shell `narrow:` and `wide:`. Don't add a
  third breakpoint for the window without a reason.
- Truncated single lines (a title ending in an ellipsis, with its full text in `title`) are left as they were: they
  need no scroll, so this decision doesn't ask for them to wrap.
