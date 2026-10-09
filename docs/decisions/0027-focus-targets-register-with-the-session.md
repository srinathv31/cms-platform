# 0027. Focus targets register with the workspace session

Status: Accepted
Date: 2026-10-09

## Context

Several workspace flows put focus somewhere on purpose: Esc puts the preview away and gives focus back to the Preview
toggle, the rail's Original tab hands focus between its two header rows, a submit lands on the header's status row,
and Esc in the template name decides whether the preview closes. The controls involved live in separate React
subtrees (the header and tab bar in the template layout, the rail in the Content page), so no caller could hold a ref
to them. Each caller found its control in the DOM instead
([I15](../handoff-review.md#i15--low-focus-and-esc-handling-is-wired-through-dom-queries)):
`textarea[aria-label="Template name"]`, a tab whose text starts with "Original", `[data-preview-toggle]`, and a
`requestAnimationFrame` loop that polled for up to 3 seconds for a status row holding `[data-status="in_review"]`.
Renaming a label broke Esc: in a field labelled anything but "Template name", Esc never closed the preview. A route
kept mounted but hidden (`<Activity>`) could also answer a page-wide query first.

## Decision

- **The session has a small registry** of the controls code sends focus to (`session.focusTargets`,
  [focus-targets.ts](../../src/components/workspace/session/focus-targets.ts)): `name`, `statusRow`, `previewToggle`
  and `originalTab`. The component that owns a control registers it while it is mounted, with the ref from
  `useFocusTarget(name, state?)` (or, for the name field, in an effect beside its own ref), and unregisters on unmount.
  A later registration under the same name replaces the earlier one; taking out a replaced one does nothing.
- **Callers ask the registry, never the DOM.** `get(name)` for a control that is there now; `waitFor(name, { accept,
  timeout })` for one that is about to mount. It resolves at once when the registered one is accepted, when an
  accepted one registers, or with null at the timeout. The timeout is the bounded fallback: focus stays where it is.
- **A target can register with what it shows.** The status row registers with its version state, so a submit waits
  for the row that reads In review (3 seconds at most, as before) instead of polling for a badge inside it. The
  Original tab's two rows are told apart by element: focus waits for an Original tab other than the one going.
- **Registering notifies no subscriber.** Nothing renders from the registry, so it isn't part of the store's
  snapshots.

Where focus lands is unchanged. What still reads the DOM does so for what a control is doing, not to find it: whether
a menu or the editor's `/` menu is open when Esc is pressed, whether a target is on screen (`getClientRects`), and
what had focus when the rail opened.

## Alternatives considered

- **Stable `data-*` hooks instead of labels.** Copy-proof, but still a page-wide query that a hidden route can
  answer, and still a poll for anything that mounts later.
- **A React context per target, or refs passed through props.** The header is a server component in the layout and
  the rail is in the page: there is no common client parent to pass them through except the session's provider,
  which is what the registry uses.
- **Keep the rAF loops and only replace the selectors.** A loop guesses how many frames a mount takes (one or two for
  the Original tab, up to 3 seconds of frames for the status row). Waiting for the registration is exact, and does
  no work while it waits.

## Consequences

- A new control that code sends focus to adds a name to `FocusTargetElements` and registers itself with
  `useFocusTarget`. Labels and markup can change freely.
- The header's status row is a small client component (`StatusRow`) so it can hold a ref.
- A wait that never resolves is bounded (3 seconds for the status row, 1 second for the Original tab), so a flow
  whose target doesn't come back leaves focus alone rather than taking it late.
- The Versions tab's `focusWhenPresent` (`src/components/versions/version-actions.tsx`) still polls by element id.
  It looks for a version's heading after a refresh, outside the workspace session's targets, and is left as it is.
