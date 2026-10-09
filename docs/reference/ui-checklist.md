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
  - Measure the y of the content area across states and report it.
- **Insets are shared constants.** One inset per surface kind, the same for every variant of that surface. Rails pad 20px horizontally.
- **Wide panels keep comfortable measures.** Lists and forms cap at about 22rem and align to the panel's left content edge; they don't stretch or center in dead space.
- **Scroll containers** that sit inside the canvas use `overscroll-contain`, and leave about 40px of bottom room so content can scroll clear of the fixed Demo pill.
- **No horizontal overflow at any width from 800px.** Test 1280×800 and 1440×900 always, and 1000×700 for anything in the rail or tab bar.

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
