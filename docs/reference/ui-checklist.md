# UI checklist — check every screen against this before reporting

Distilled from the Phase 3 visual QA. Build it this way the first time; QA will hold you to it.

## Controls and states
- **One selected-state idiom per kind.**
  - View switches (tabs) are text with the 2px dark underline on a hairline, like the workspace tab bar: `Tabs` from `src/components/primitives/tabs.tsx`.
  - Option pickers (channel, device, and the like) are the one segmented control, `Segmented` from `src/components/primitives/segmented.tsx` (`SegmentedRadio` in a form): a white 32px track with a hairline and `bg-selected` segments.
  - Never invent a third style.
- **Sizes.**
  - Every control in a rail or panel is 32px tall with `rounded-lg` (8px): buttons, selects, segmented tracks, inputs.
  - Primary actions in the tab bar are the shadcn `lg` size.
  - Chips are `rounded-md`.
- **One black primary button per screen.** Secondary actions are outline. Tertiary actions are ghost.
- **Disabled means unusable.** A control that would act on stale or missing data is disabled (e.g. Download while an error shows), not silently acting on old data.
- **Disabled, not hidden.** A control that's unavailable right now stays in place, visibly greyed, with a tooltip saying why ("Nothing to undo"). Don't hide one of a pair (undo and redo). Base UI's `focusableWhenDisabled` sets `data-disabled`, not the native `disabled` attribute, so style it with `data-disabled:` variants; shadcn's `disabled:` classes won't match. Never the native `disabled` on a blocked action: Tab skips it, and its reason with it. `BlockedButton` (`src/components/primitives/blocked-button.tsx`) does all of this. Check the greyed state in a screenshot.
- **Buttons don't scroll the page.** An action started from a button doesn't scroll to its effect (the undo and redo buttons use `undoNoScroll` and `redoNoScroll`). Keyboard shortcuts may.

## Layout
- **Nothing jumps.**
  - The same structure appears for every state, value and option: no row that wraps for one value and not another.
  - Skeletons have the real geometry.
  - A meta row that can wrap ("Draft · Based on v1 · Saved") never leaves a "·" at either end of a line: the separator sits in its item's left padding, and the row pulls its items back by that padding inside a horizontal clip (`src/components/versions/version-entry.tsx`, `src/components/workspace/workspace-header.tsx`).
  - Measure the y of the content area across states and report it.
- **Insets are shared constants.** One inset per surface kind, the same for every variant of that surface. Rails pad 20px horizontally.
- **Wide panels keep comfortable measures.** Lists and forms cap at about 22rem and align to the panel's left content edge; they don't stretch or center in dead space.
- **Scroll containers** that sit inside the canvas use `overscroll-contain`, and leave about 40px of bottom room so content can scroll clear of the fixed Demo pill.
- **Reflow: nothing needs a horizontal scroll down to 320 CSS px wide** (WCAG 2.1 SC 1.4.10). A laptop at 400% browser zoom is a 320px window, so this is the width to check, with a 256px-tall window for anything sticky. The page, and the canvas (`main[data-slot="sidebar-inset"]`'s scroll area), never scroll sideways. What needs a two-dimensional layout scrolls inside its own box instead: data tables (wrap them in `ScrollRegion`, `src/components/primitives/scroll-region.tsx`, which gives a scrolling box its Tab stop), the document canvas's tables, a chart's plot area, a phone preview, and a tab strip wider than the screen. Everything else wraps, stacks or gives up room: a flex row gets `flex-wrap`, a fixed width gets a `min()` or a `max-w-full`, and a toolbar that cannot fit goes to two lines. Keep the page's own states (a skeleton, an overlay, a sheet) inside the same rule. Below 800px the sidebar is a drawer behind a top-bar button (`narrow:`, `wide:` and [decision 0045](../decisions/0045-stencil-targets-desktop-chrome-and-reflows-for-zoom.md)); key a layout's narrow rules to the canvas (`@max-[26rem]/canvas:`), so nothing from 800px up changes. A dialog is portaled out of the canvas, so it keys to the window instead: under 26rem (`max-[26rem]:`) it pads 1.25rem and scrolls as a whole with its footer sticky and wrapping (`NARROW_*` in `src/components/app-shell/scrim-dialog.tsx`), and a dialog's popover (the sunset calendar) must open inside the window. Test 320×720 for every screen and dialog, 320×256 for a dialog's footer, 1280×800 and 1440×900 always, and 1000×700 for anything in the rail or tab bar. [e2e/reflow.spec.ts](../../e2e/reflow.spec.ts) holds the 320px check for the Library, a template's Usage tab and the review screen; [e2e/reflow-dialogs.spec.ts](../../e2e/reflow-dialogs.spec.ts) the one for Submit for review, Approve, Request changes, Compare versions and Change sunset; [e2e/reflow-editor-review.spec.ts](../../e2e/reflow-editor-review.spec.ts) the editor's block handle and block menu, and the review header's wrapping name and byline. A title or byline that ends in an ellipsis at 800px and wider wraps below it (`narrow:`). [e2e/reflow-coral-settings.spec.ts](../../e2e/reflow-coral-settings.spec.ts) holds the 320px check, and axe at 320 and 1280, for Coral's screens and every Settings section.

## Copy
- **No hint text and no instructions.** Explain only when blocked, in a few words, at the control.
- **Authors see labels, not keys.** Messages built from route or domain errors map keys to variable labels ("First name needs a value."). Keys appear only in Geist Mono where a key is the point.
- **Exact sentences.** Use singular and plural correctly, Oxford "and" lists, and no jargon ("render_failed", "422").

## Focus and keyboard
- **Return focus.** When an overlay, panel or mode closes, return focus to the control that opened it.
- **Esc closes the topmost thing only** (menu, then popover, then dialog, then mode).
- **Initial focus.** Base UI dialogs and popovers set initial focus a frame after opening. Choose the initial focus deliberately: the first field, or the safe action in a destructive dialog.
- Every control is reachable by Tab and has a visible focus ring.
- **No chart value is hover-only.** A chart's marks are one Tab stop with arrow keys between them, each showing its tooltip on focus; a chart whose values aren't printed is followed by an sr-only table of them; series differ by hue, not lightness (`src/components/usage/charts.tsx`).

## Network and console
- **Zero console errors in normal use.** Chrome logs every 4xx/5xx fetch as a console error, and the e2e console fixture fails on it. Validate on the client with the same domain function the server uses before sending, and don't send requests you know will be refused.
- **Sandboxed iframes** (rendered output): Playwright's trace and init scripts inject into frames and Chrome logs "Blocked script execution". Specs that open preview frames set `test.use({ trace: "off" })` and inject helpers into the main page only.

## Verify before reporting
- Take screenshots at 1440×900 and 1280×800 of every state you built. View them at scale 0.5 and iterate.
- Check one keyboard pass and the console.
- Clean up temp scripts. Restore any seeded row you edited, or work on rows you created.
