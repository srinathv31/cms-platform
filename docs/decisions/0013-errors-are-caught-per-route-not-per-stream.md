# 0013. Errors are caught per route, not per streamed section

Status: Accepted
Date: 2026-10-09

## Context

The app had no `error.tsx` and no `global-error.tsx`, so any throw inside a streamed section, or a backend outage,
replaced the whole app with Next's default "This page couldn't load" page: no sidebar, no way back but Reload.
Finding [I7](../handoff-review.md#i7--medium-no-error-boundaries-anywhere) of the October 2026 review.

Every request-bound part of a page renders inside `<Stream>` ([stream.tsx](../../src/components/primitives/stream.tsx)),
so the question was where to catch: at each `<Stream>`, so the rest of the page lives, or at the route.

## Decision

Three route-level boundaries, sharing one look ([route-error.tsx](../../src/components/app-shell/route-error.tsx)):

| Boundary | Catches | Keeps |
| --- | --- | --- |
| [(product)/error.tsx](../../src/app/(product)/error.tsx) | Any page inside the app frame, the team guard, the settings dialog, the workspace's own layout. | The sidebar and the top bar. |
| [templates/[templateId]/error.tsx](../../src/app/(product)/[team]/templates/[templateId]/error.tsx) | A workspace tab (Content, Versions, Usage, Activity). | The workspace header and the tab bar, with the frame. |
| [global-error.tsx](../../src/app/global-error.tsx) | The app frame's streamed parts, the root layout, and the simulator. | Nothing: it renders its own document with the app's styles and fonts, and no providers. |

Each says what happened in one plain sentence ("This page didn't load", "This tab didn't load."), offers Try
again (Next 16's `retry`, which re-fetches the route from the server) and Back to library, and shows the digest
Next gives a server error, in small muted text. It never shows the error's message and logs nothing beyond what
Next logs.

Try again is the black button on the page and global errors. On a tab error it is outline, because the tab bar
above it keeps the workspace's one black button (Edit or Submit for review).

`<Stream>` gets no error boundary of its own.

## Alternatives considered

- **A boundary in every `<Stream>`** (`catchError` from `next/error` around its children). Rejected:
  - Many streams are slivers: the team switcher, the top bar, the tab bar's buttons (whose fallback is an empty
    span), the Review badge, the demo clock. None has room for a sentence and two buttons, and an empty fallback
    hides the failure. Each stream would need its own error view at its skeleton's geometry, so it isn't cheap.
  - An outage fails every stream at once, and a page shows the same message and Try again several times. That
    breaks the one-black-button rule, or with outline buttons gives several identical controls.
  - It buys no cheaper recovery: `retry` refreshes the whole route either way.
  - A page that lost one section and kept the rest can read as complete. In regulated content, a review screen
    without its contract changes, or a Usage page without its consumers, is worse than a page that says it
    didn't load.
- **A root `app/error.tsx`** as well, so a frame failure keeps the root layout's providers. It shows the same page
  as `global-error.tsx` (the frame is gone either way), so it would be a second copy of the same screen.

## Consequences

- One message and one Try again per screen. A partial failure (one broken query) costs the person the page or
  the tab, not the app.
- A failure in the workspace header or the tab bar is in the workspace layout, so it takes the whole workspace
  to the page error, not the tab error.
- The error replaces the section's skeleton, so the zero-layout-shift rule doesn't hold on an error, which no
  normal render reaches.
- `e2e/error-boundaries.spec.ts` reaches each boundary in the production build by breaking a stored JSON value
  for the length of a test. Nothing in the app exists only for it.
- Revisit if one section can fail on its own for a known reason (an optional, slow integration). That section can
  catch its own error with `catchError`, with an error view sized like its skeleton.
