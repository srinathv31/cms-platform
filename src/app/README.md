# `src/app`: routes, layouts, and route handlers

The Next.js App Router tree for Stencil, the Coral simulator, and two dev labs. Files here are thin: a page
renders static chrome and a `<Stream>` around a server component from `src/components/` that reads the request;
a route handler parses HTTP and calls `src/server/`. No server actions live here (lint allows `"use server"` only
in `src/server/actions/`), and outside `(dev)` the only client components are the four error boundaries, which
Next requires to be client components. Business rules belong in `src/domain/` and `src/server/`.

## Rules

**Import boundaries** (lint-enforced in [eslint.config.mjs](../../eslint.config.mjs)):

- `(product)/**` and `api/**` may not import simulator data: `@/simulator`, `@/simulator/*`, or any `schema/sim`.
- `(simulator)/**` may not import `@/server/*` (except `@/server/db/schema/sim`), `@/domain/*` or `@/editor/*`.
  The simulator reaches Stencil only over HTTP `/api/v1`, through [ucomp-api.ts](../simulator/ucomp-api.ts),
  like an outside consumer. It may use `@/components/*` and `@/simulator/*`.
- `(dev)/**`, the root layout and `globals.css` have no boundary rule.

**Cache Components.** [next.config.ts](../../next.config.ts) sets `cacheComponents: true`: the shell is static
and every request-bound part streams. Reading request data outside `<Suspense>` is a build error.

1. There is no `loading.tsx` anywhere. The one streaming boundary is `<Stream fallback>` from
   [stream.tsx](../components/primitives/stream.tsx): a `Suspense` plus a `ViewTransition`. The fallback must
   have the final geometry; the principles spec requires a CLS of 0. A throw inside a `<Stream>` goes to the
   route's error boundary (see [Errors](#errors)); `<Stream>` doesn't catch it.
2. Request data is read only inside a `<Stream>`. That means the request context (the `ucomp_persona` cookie
   through `cookies()`, [server/context/request.ts](../server/context/request.ts)), awaited `params` and
   `searchParams`, database reads, and `now()`. The page's default export stays synchronous.
3. `params` and `searchParams` go down as promises. Type the page with `PageProps<"/route">` (or
   `LayoutProps<"/route">`) and `await` inside the streamed component.
4. Time comes from the backend: a read model that has moved behind the services hands the screen the service's
   `asOf`; one that hasn't reads `now()` in [server/clock.ts](../server/clock.ts) (real time plus the demo clock's
   offset). Never `new Date()` or `Date.now()` in server code. `now()` awaits `connection()` and reads the
   database, so it is request data too.
5. A database read that runs before any request API needs `await connection()` first. libSQL resolves in
   microtasks, so without it the read can land in the prerender. See `getSimCustomers` in
   [ui/lists.ts](../simulator/ui/lists.ts) and the simulator's
   [delivery file route](<./(simulator)/sim/deliveries/[deliveryId]/file/route.ts>). The `/api/v1` GET handlers
   get the same effect by reading their headers before touching the database.
6. `export const instant = false` appears only on the two settings pages. It opts them out of Next's
   instant-navigation validation, because the dialog renders through a client-only portal.

**Typed routes.** `typedRoutes: true` checks every `<Link href>` and `router.push`/`replace`/`prefetch`. A
literal or template literal must match a real route; a computed string needs `as Route`
(`import type { Route } from "next"`). `npm run typecheck` runs `next typegen && tsc --noEmit`. `next typegen`
writes the route types and the global `PageProps`, `LayoutProps` and `RouteContext` helpers into `.next/types`
(or `.next/dev/types`) without a build, so run it after adding or renaming a route.

## Route map

`[team]` is a team slug (`coral-offers`, `deposits`, `card-statements`) or `all`, the cross-team space.

### `(product)`: the Stencil app, inside `AppFrame`

| URL                                     | Page                                                                                                                                                                                                                      | What it is                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                     | [page.tsx](<./(product)/page.tsx>)                                                                                                                                                                                        | Redirects to the viewer's default space's Library, or to `/request-access`.                                                                                                               |
| `/request-access`                       | [request-access/page.tsx](<./(product)/request-access/page.tsx>)                                                                                                                                                          | Ask a team for a role.                                                                                                                                                                    |
| `/[team]`                               | [[team]/page.tsx](<./(product)/[team]/page.tsx>)                                                                                                                                                                          | Redirects to `/[team]/library`.                                                                                                                                                           |
| `/[team]/library`                       | [library/page.tsx](<./(product)/[team]/library/page.tsx>)                                                                                                                                                                 | The Library.                                                                                                                                                                              |
| `/[team]/review`                        | [review/page.tsx](<./(product)/[team]/review/page.tsx>)                                                                                                                                                                   | The review queue.                                                                                                                                                                         |
| `/[team]/review/[templateId]/[version]` | [review/…/page.tsx](<./(product)/[team]/review/[templateId]/[version]/page.tsx>)                                                                                                                                          | The review screen for one round of a version: `?round=N`, or without it the number's released row, else its latest round. A round that doesn't exist (or a malformed `?round=`) is a 404. |
| `/[team]/templates/[templateId]`        | [templates/[templateId]/page.tsx](<./(product)/[team]/templates/[templateId]/page.tsx>)                                                                                                                                   | Workspace, Content tab: the document and the rail.                                                                                                                                        |
| `…/versions`, `…/usage`, `…/activity`   | [versions](<./(product)/[team]/templates/[templateId]/versions/page.tsx>), [usage](<./(product)/[team]/templates/[templateId]/usage/page.tsx>), [activity](<./(product)/[team]/templates/[templateId]/activity/page.tsx>) | The other workspace tabs.                                                                                                                                                                 |
| `/[team]/usage`                         | [usage/page.tsx](<./(product)/[team]/usage/page.tsx>)                                                                                                                                                                     | Usage dashboard (`?tab=consumers`).                                                                                                                                                       |
| `/[team]/audit`                         | [audit/page.tsx](<./(product)/[team]/audit/page.tsx>)                                                                                                                                                                     | Audit log; filters live in the search params.                                                                                                                                             |
| `/[team]/settings/[section]`            | [settings/[section]/page.tsx](<./(product)/[team]/settings/[section]/page.tsx>)                                                                                                                                           | The settings dialog. Team sections: `members`, `access-requests`, `recertification`, `inactivity`. Platform sections: `teams`, `content-types`, `channel-rules`, `approval-chains`.       |

### `sign-in`: where a signed-out person lands

[sign-in/page.tsx](./sign-in/page.tsx), outside `AppFrame` and static: `signInRequired()`
([server/context/sign-in.ts](../server/context/sign-in.ts)) sends a page here when nobody is signed in (no persona
cookie with the demo tools off). Real sign-in (Better Auth, decision 0054) replaces it.

### `(simulator)`: Coral, the simulated consumer

| URL                                                 | Page                                                                                                                                                        | What it is                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `/sim`                                              | [sim/page.tsx](<./(simulator)/sim/page.tsx>)                                                                                                                | Offers and the latest notices.                       |
| `/sim/offers/[offerId]`                             | [offers/[offerId]/page.tsx](<./(simulator)/sim/offers/[offerId]/page.tsx>)                                                                                  | One offer: Template, Values and Send tabs (`?tab=`). |
| `/sim/offers/[offerId]/link`                        | [link/page.tsx](<./(simulator)/sim/offers/[offerId]/link/page.tsx>)                                                                                         | Link or relink a template (`?template=`).            |
| `/sim/customers`, `/sim/deliveries`, `/sim/notices` | [customers](<./(simulator)/sim/customers/page.tsx>), [deliveries](<./(simulator)/sim/deliveries/page.tsx>), [notices](<./(simulator)/sim/notices/page.tsx>) | Coral's customers, sends, and notices from Stencil.  |

### `(dev)`: labs

Two labs for working on the editor and the PDF viewer. Each page calls `notFound()` when
`process.env.NODE_ENV === "production"`, so they answer in `next dev` and 404 in a production build. There is no
`(dev)` layout or proxy, nothing in the app links to them, and they use fixtures only, never the database or the
persona. The `/design/*` variant mocks (and the second stand-in renderer they carried) were removed once their
decisions were in the product; they are recoverable from the `archive/design-mocks` tag.

| URL           | What it is                                                              |
| ------------- | ----------------------------------------------------------------------- |
| `/editor-lab` | The live editor on fixtures, beside a server-rendered `StaticDocument`. |
| `/pdf-lab`    | The PDF viewer, fed from a file input or `?src=`.                       |

### Route handlers

| Method and path                                                        | File                                                                                           | Called by                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/drafts/[versionId]`                                          | [route.ts](./api/drafts/[versionId]/route.ts)                                                  | Browser: autosave ([save-transport.ts](../components/workspace/autosave/save-transport.ts)).                                                                                                                                                                                            |
| `POST /api/imports?team=`                                              | [route.ts](./api/imports/route.ts)                                                             | Browser: Library import ([upload-import.ts](../components/library/upload-import.ts)).                                                                                                                                                                                                   |
| `GET /api/imports/[uploadId]/file`, `…/view`                           | [file](./api/imports/[uploadId]/file/route.ts), [view](./api/imports/[uploadId]/view/route.ts) | Browser: the rail's Original tab ([original-view.tsx](../components/import/original-view.tsx)).                                                                                                                                                                                         |
| `GET /api/palette/[space]?q=&template=`                                | [route.ts](./api/palette/[space]/route.ts)                                                     | Browser: the command palette, when it opens and as the viewer types ([use-palette-results.ts](../components/palette/use-palette-results.ts)).                                                                                                                                           |
| `GET /api/templates/[templateId]/compare?from=&to=`                    | [route.ts](./api/templates/[templateId]/compare/route.ts)                                      | Browser: the Compare dialog, per pair ([compare-panel.tsx](../components/versions/compare-panel.tsx)).                                                                                                                                                                                  |
| `GET /api/templates/[templateId]/base-version?draft=`                  | [route.ts](./api/templates/[templateId]/base-version/route.ts)                                 | Browser: "Revert to v3" ([save-status.tsx](../components/workspace/save-status.tsx)).                                                                                                                                                                                                   |
| `GET /api/templates/[templateId]/submit-summary`                       | [route.ts](./api/templates/[templateId]/submit-summary/route.ts)                               | Browser: the submit dialog and its Refresh summary ([workspace-actions.tsx](../components/workspace/workspace-actions.tsx)).                                                                                                                                                            |
| `GET /api/templates/[templateId]/copilot-prompt`                       | [route.ts](./api/templates/[templateId]/copilot-prompt/route.ts)                               | Browser: the Copilot prompt dialog ([copilot-prompt.tsx](../components/workspace/copilot/copilot-prompt.tsx)).                                                                                                                                                                          |
| `GET /api/templates/[templateId]/integration`                          | [route.ts](./api/templates/[templateId]/integration/route.ts)                                  | Browser: the SHARE panel, on open and as a prefetch ([workspace-share.tsx](../components/workspace/workspace-share.tsx)).                                                                                                                                                               |
| `POST /api/templates/[templateId]/preview`                             | [route.ts](./api/templates/[templateId]/preview/route.ts)                                      | Browser: the Preview (editor, workspace, review screen), per render ([render-preview.ts](../components/preview/render-preview.ts)). The session's person, any state ([decision 0047](../../docs/decisions/0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)). |
| `GET /[team]/audit/export`                                             | [route.ts](<./(product)/[team]/audit/export/route.ts>)                                         | Browser: the Audit page's Export link (CSV; [export-link.tsx](../components/audit/export-link.tsx) shows a refusal).                                                                                                                                                                    |
| `GET /api/v1/templates?q=&limit=&after=`                               | [route.ts](./api/v1/templates/route.ts)                                                        | Simulator and outside consumers.                                                                                                                                                                                                                                                        |
| `GET /api/v1/templates/[templateId]?version=&since=`                   | [route.ts](./api/v1/templates/[templateId]/route.ts)                                           | Simulator and outside consumers.                                                                                                                                                                                                                                                        |
| `GET /api/v1/consumers/[consumerId]/notices?after=&templateId=&limit=` | [route.ts](./api/v1/consumers/[consumerId]/notices/route.ts)                                   | Simulator and outside consumers.                                                                                                                                                                                                                                                        |
| `POST /api/v1/templates/[templateId]/render`                           | [route.ts](./api/v1/templates/[templateId]/render/route.ts)                                    | Simulator and outside consumers with `X-Consumer-Id`. Consumers only: never a draft or a version in review, and no session or cookie.                                                                                                                                                   |
| `GET /sim/deliveries/[deliveryId]/file`                                | [route.ts](<./(simulator)/sim/deliveries/[deliveryId]/file/route.ts>)                          | Simulator: the customer views' iframes and PDF.                                                                                                                                                                                                                                         |
| `GET /sim/deliveries/[deliveryId]/view`                                | [route.ts](<./(simulator)/sim/deliveries/[deliveryId]/view/route.ts>)                          | Simulator: the customer drawer, when it opens on a delivery ([offer-view.tsx](../simulator/ui/offer-view.tsx)).                                                                                                                                                                         |
| `GET /sim/templates/search?q=`                                         | [route.ts](<./(simulator)/sim/templates/search/route.ts>)                                      | Simulator: the link flow's template search, debounced ([link-flow.tsx](../simulator/ui/link-flow.tsx)).                                                                                                                                                                                 |

## Layouts and providers

- [layout.tsx](layout.tsx) (root): fonts, `globals.css`, the `"%s · Stencil"` title template, and the client
  `<Providers>` ([providers.tsx](../components/motion/providers.tsx)): `MotionConfig` (reduced motion follows the
  OS), `LazyMotion` with `domMax`, `TooltipProvider`, the sonner `Toaster`, and a filter for the browser's
  "Transition was aborted" rejection.
- [(product)/layout.tsx](<./(product)/layout.tsx>) wraps everything in `AppFrame`
  ([app-frame.tsx](../components/app-shell/app-frame.tsx)): sidebar, top bar and canvas, with the
  viewer-dependent parts streamed as holes, and the Demo pill (only in demo mode, decision 0051).
- [[team]/layout.tsx](<./(product)/[team]/layout.tsx>) runs `TeamGuard` (`requireSpaceFromParams` in
  [queries/spaces.ts](../server/queries/spaces.ts)): an unknown slug and a team the viewer can't see both call
  `notFound()` ([not-found.tsx](<./(product)/not-found.tsx>), whose Back to library goes to `/`, the viewer's own
  space or `/request-access`; [decision 0052](../../docs/decisions/0052-a-page-you-may-not-read-is-not-found.md)).
  It renders `children` and the `modal` slot. Pages guard themselves too, through their
  queries.
- **The `@modal` slot.** A soft navigation to `/[team]/settings/[section]` is intercepted by
  [@modal/(.)settings](<./(product)/[team]/@modal/(.)settings/layout.tsx>), which opens `SettingsShell`
  (`closeMode="back"`) over the current page. The shell lives in a layout so it stays mounted across sections.
  [@modal/[...catchAll]](<./(product)/[team]/@modal/[...catchAll]/page.tsx>) returns `null`, so any other URL
  closes the dialog (soft navigations otherwise keep slot state); [default.tsx](<./(product)/[team]/@modal/default.tsx>)
  covers hard loads. A hard load of a settings URL renders
  [settings/layout.tsx](<./(product)/[team]/settings/layout.tsx>): the Library with the dialog over it
  (`closeMode="library"`).
- [templates/[templateId]/layout.tsx](<./(product)/[team]/templates/[templateId]/layout.tsx>): the workspace
  grid, the header, the tab bar and `WorkspaceSessionProvider`. Each tab is a page whose output fills cells of
  that grid.
- [(simulator)/layout.tsx](<./(simulator)/layout.tsx>): a dashed Stencil-styled bar with the "Back to Stencil"
  pill, then Coral's own nav and theme (`src/simulator/theme.css`), and the Demo pill (only in demo mode). No `AppFrame`. `(dev)`
  has no layout of its own.

**Prefetching.** Default link prefetching is on and `partialPrefetching` is not enabled; the comment in
`next.config.ts` records that in 16.3.8 it re-requests every link's route tree in a loop in this app. The
"router prefetch" tests in [phase-1.spec.ts](../../e2e/phase-1.spec.ts) are the canary: fewer than 60 RSC
requests in about 3 seconds on the Library and on a workspace.

## Errors

Four error boundaries catch a throw by route, not by `<Stream>`
([decision 0013](../../docs/decisions/0013-errors-are-caught-per-route-not-per-stream.md)). An error boundary
doesn't cover the layout beside it, so each keeps what its segment's layouts render:

| File                                                                                      | Catches                                                                         | Shows                                                                                                                                       | Keeps                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [(product)/error.tsx](<./(product)/error.tsx>)                                            | Pages inside `AppFrame`, `TeamGuard`, the `@modal` slot, the workspace layout.  | `PageError`: "This page didn't load" as the page title.                                                                                     | Sidebar and top bar.                                                                     |
| [templates/[templateId]/error.tsx](<./(product)/[team]/templates/[templateId]/error.tsx>) | A workspace tab's page.                                                         | `TabError` in the document's grid cell.                                                                                                     | Workspace header and tab bar.                                                            |
| [(simulator)/error.tsx](<./(simulator)/error.tsx>)                                        | A page under `/sim`.                                                            | `SimError` ([simulator/ui/error-view.tsx](../simulator/ui/error-view.tsx)): "This page didn't load" as Coral's page title, in Coral's look. | Coral's layout: the Back to Stencil strip, its nav and the Demo pill.                    |
| [global-error.tsx](global-error.tsx)                                                      | `AppFrame`'s streamed parts, the root layout, and the layouts of `(simulator)`. | `GlobalErrorView`: the canvas panel with `PageError`.                                                                                       | Nothing. It renders its own `<html>` with `globals.css` and the fonts, and no providers. |

The views live in [route-error.tsx](../components/app-shell/route-error.tsx),
[tab-error.tsx](../components/workspace/tab-error.tsx) and, for Coral, [error-view.tsx](../simulator/ui/error-view.tsx)
(built from Coral's own pieces, because the simulator imports nothing from Stencil's server, domain or editor and draws
in its own palette). Each offers Try again, which calls Next's `retry` (a refetch of the route), and a way back:
Back to library (the URL's space, or `/`), or, in Coral, Back to offers (`/sim`). Each shows the error's `digest` when
Next gives one. None shows the error's message or logs it; Next logs it already. Try again is the black button, except
on `TabError`, where the tab bar keeps the workspace's black button: greyed, with the reason at the control, while the
error is on screen, because the tab it acts on didn't load.

A `notFound()` or `redirect()` passes through these boundaries to Next's own handling.

## How route handlers answer

Every handler is request-time. A POST always is; a GET is made so by reading the request context (the persona
cookie), the request headers, or `connection()` before the database. A handler that needs a person answers 401
`signed_out` without one (`requestContextOrRefusal()`, `signedOutResponse()`), in its own response shape.

**`/api/v1`** answers through [server/api/http.ts](../server/api/http.ts). Its wire shapes are in
[contracts/api-v1.ts](../contracts/api-v1.ts) (a file with no imports, lint-enforced); the render contract is
[domain/render/types.ts](../domain/render/types.ts).

- Wrap the handler in `withDemoDate` ([server/services/local/consumer-api.ts](../server/services/local/consumer-api.ts)), which sets the HTTP `Date` header to the demo clock. Coral stamps what it
  receives with that header.
- `correlationIdOf(request)` echoes `X-Correlation-Id` when it is 1 to 128 visible ASCII characters, else makes
  a `req_…` id. Every response carries it, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Errors are `{ error: { code, message, details? } }` from `errorResponse`, with the status that
  `API_ERROR_STATUS` in [golive-types.ts](../domain/golive-types.ts) gives the code. Query parsers and error
  builders live in [golive/api-errors.ts](../domain/golive/api-errors.ts).
- `X-Consumer-Id` must name a registered consumer. The GET routes check it first with `requireConsumer` in
  [consumer-api.ts](../server/services/local/consumer-api.ts); the notices route also requires it to match the path.
  Render requires it too, and checks it in [render-template.ts](../server/services/local/render/render-template.ts). `/api/v1`
  reads no cookie and no session: Stencil's own previews are `POST /api/templates/[templateId]/preview`.
- Search and notices page with an opaque `after` cursor and answer `nextCursor` and `hasMore`. The routes read
  `after` with `readSearchCursor` and `readNoticeCursor` in [golive/cursor.ts](../domain/golive/cursor.ts), which
  refuse a cursor from another list, or a notices cursor from before a demo reset (`noticeEpoch`), with
  `bad_request`.
- Render takes every value in `values` as a JSON string: a JSON number is refused with 422 `invalid_values` and a
  sentence that says to send `"21.90"` (`validateValues` in `src/domain/render/validate.ts`, [decision
  0058](../../docs/decisions/0058-render-values-are-strings.md)).
- Render adds `X-Stencil-Template-Id`, `X-Stencil-Version`, `X-Stencil-Newer-Version` and `X-Stencil-Preview`,
  and a strict CSP on web HTML.

**Internal routes** (the browser's, under `/api` but `/api/v1`, and the audit export) refuse in one shape, the
`ActionResult` a server action answers: `{ ok: false, code, reason }`, the code from a refusal table in
`src/domain` and the status that suits it ([decision 0041](../../docs/decisions/0041-routes-refuse-in-the-actions-shape.md)).
Autosave's status comes from `statusOf` ([drafts/http.ts](../server/drafts/http.ts); `draft_changed` also carries the
current `rev`), import's from `importStatus` ([import/create.ts](../server/import/create.ts)), and the reads', the
palette's and the audit export's from the `ReadRefusal` their query returns (`readResponse`,
[server/api/reads.ts](../server/api/reads.ts)). The import file and view reads answer `upload_unavailable` with 404,
and the audit export `generic` with 403 or `space_unavailable` with 404, never a file. Coral's delivery file route
answers plain text; it is the simulator's. Every answer sends `Cache-Control: no-store` (`private, no-store` on the
reads, the audit export's refusals, the palette and a successful import read).

**Coral's reads** (`/sim/templates/search`, `/sim/deliveries/[deliveryId]/view`) are the simulator's own, in the
simulator's shape rather than Stencil's: `{ ok: true, … }` or `{ ok: false, reason }` (its `SimResult`) with a 400,
404 or 502 and `Cache-Control: private, no-store` ([read-response.ts](../simulator/read-response.ts)). Coral's
server actions are its writes only.

**Template reads** (`/api/templates/[templateId]/…`) are what a screen loads on demand, when a dialog or a menu
opens. They are GET route handlers rather than server actions because an action is a public POST endpoint that runs
one at a time with the page's mutations: a read would hold up Edit or Submit, or wait behind them. Each reads the
request context (401 without a viewer), hands the viewer and the raw path and query values to its query in
`src/server/queries/` (which parses them with zod and checks `can()`), and answers with `readResponse()` from
[server/api/reads.ts](../server/api/reads.ts): 400 for values that don't parse, 401 for nobody signed in, 403 for a
viewer the permission refuses, 404 for an unknown template or version, 409 when there is nothing to read (no draft,
no Active version).
The browser calls them through `readTemplate()` in [lib/template-reads.ts](../lib/template-reads.ts). A request
without a persona cookie is signed out unless the demo tools are on, where it acts as the default persona
([S2](../../docs/handoff-review.md#s2--high-identity-fails-open-to-the-default-persona)).

**The preview** (`POST /api/templates/[templateId]/preview`) is the one POST among them, because it carries the sample
values. It reads the person from the request context (nobody signed in is refused `preview_forbidden` without asking
the backend), checks the body, and asks the backend to render (`services().render.preview`, under the request's
correlation id), and answers with the same bodies, headers (plus `X-Stencil-Preview: true`) and `{ error: { code, message, details? } }`
errors as the consumer render route, through [server/api/render-http.ts](../server/api/render-http.ts) and
`errorResponse`. It takes `version` as `"draft"` or a number, an optional `round`, and any state previews
([decision 0047](../../docs/decisions/0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)).

**The palette's search** (`/api/palette/[space]?q=&template=`) is a read of the same kind: the route passes the
request context and the raw values to `searchPalette` in [queries/palette.ts](../server/queries/palette.ts) and answers with
`readResponse()`, 400 for a `q` or `template` that doesn't parse and 404 for a space the viewer can't see. No page
carries templates; the palette asks this route when it opens and as the viewer types
([decision 0024](../../docs/decisions/0024-the-palette-searches-on-the-server.md)).

**Body caps.** Drafts: 2,000,000 bytes (`MAX_BODY_SIZE` in `src/server/drafts/parse-patch.ts`), 413 with the
`draft_too_large`. Render: 1,000,000 bytes (`MAX_BODY_BYTES` in `src/domain/render/types.ts`), 413
`body_too_large`. Imports: `IMPORT_LIMITS.maxBytes` (10 MiB) plus 64 KiB of multipart room, 413 `import_too_large`. Every one
refuses a declared `Content-Length` over its cap before reading, then reads with `readBodyCapped`, which counts bytes
and stops at the cap, because a declared length is only a hint and a chunked body has none. Drafts and imports
check permission before any byte is read: drafts from the version id in the path (`drafts.saveAccess`), imports from
the team in the query. Render is anonymous, so the cap is all that stands before its read. Drafts and imports are
route handlers, not server actions, because actions run one at a time per client and cap bodies at 1 MB.

## Add a page

1. Add `page.tsx` under the right group. Keep the default export synchronous and typed
   `PageProps<"/your/route">`.
2. Render static chrome (`PageHeader`) directly. Put everything request-bound inside
   `<Stream fallback={<Skeleton with the final geometry />}>`.
3. Write the streamed component in `src/components/<feature>/`. It awaits `params`, calls a query in
   `src/server/queries/` (which resolves the viewer and, under `[team]`, `requireSpace`), and counts its dates from
   the read model's `now` (the service's `asOf`).
4. Add the route to the route lists in [helpers/principles.ts](../../e2e/helpers/principles.ts) with the personas
   that can see it, then run `npm run typecheck`, `npm run lint` and `npm run format:check`.

Copy [versions/page.tsx](<./(product)/[team]/templates/[templateId]/versions/page.tsx>) with
[versions-content.tsx](../components/versions/versions-content.tsx), or
[usage/page.tsx](<./(product)/[team]/usage/page.tsx>) for a static header with streamed parts.

## Add an API route

- **Public (`/api/v1`).** Copy [api/v1/templates/route.ts](./api/v1/templates/route.ts): `withDemoDate`, read
  the headers first, `requireConsumer`, parse the query with the domain parsers, answer with `jsonResponse` or
  `errorResponse`. Add the wire type to `src/contracts/api-v1.ts`, any new error code to `API_ERROR_STATUS`,
  a co-located `route.test.ts`, and a case in `e2e/api/consumer.spec.ts`.
- **Browser only, a read.** Data a page shows comes from a server component's props. Data loaded on demand (a
  dialog, a menu) is a GET route: copy
  [api/templates/[templateId]/base-version/route.ts](./api/templates/[templateId]/base-version/route.ts), which reads
  the request context (401 without one) and answers its service read's `ReadResult` with `readResponse()`, and add the
  read to `TemplateRead` in `src/lib/template-reads.ts`. Never a server action.
- **Browser only, a write.** A server action in `src/server/actions/`. Use a route handler when the body can pass
  1 MB or requests must not queue: copy [api/drafts/[versionId]/route.ts](./api/drafts/[versionId]/route.ts) for
  a capped write. Read the request context before the database (`requestContextOrRefusal()`, 401 without a viewer)
  and send `Cache-Control: no-store`. Type the context
  with `RouteContext<"/route">`, as the audit export does.

## Don't copy

- **Bare `Suspense`.** The two settings pages and `SettingsShell` use `Suspense` without `<Stream>`. Use
  `<Stream>` in new code. (`[team]/layout.tsx` also uses a bare `Suspense`, around a guard that renders nothing.)
- **`params.then(...)`** in `src/components/workspace/workspace-tab-bar.tsx`, called from the workspace layout.
  Await `params` inside an async component instead.
- **Permission logic in a page.** [request-access/page.tsx](<./(product)/request-access/page.tsx>) calls `can()`
  and picks a `REASONS` sentence itself. Let the query decide and return the result.
- **Another error shape.** Internal routes refuse as `{ ok: false, code, reason }`, with the code from a table in
  `src/domain`; a new one reuses that (a read, `readResponse`). Only a new public route uses `errorResponse`.
- **Linking to `(dev)` routes from the app, or giving them real data.** They are unauthenticated
  and exist only outside production builds.

## Testing

- **Route handlers:** co-located `route.test.ts` files under `api/`, run with `npx vitest run src/app/api`. The
  `/api/v1` tests call the exported handler with a `NextRequest` against a temporary migrated and seeded
  database (`tempDatabase` and `seededDatabasePerTest` in `src/server/testing/review-fixtures.ts`, one copy of the
  database per test) and mock `@/server/clock`. The template
  reads that haven't moved behind the service interfaces are tested the same way, one `route.test.ts` beside each
  route (the helpers they share are in `src/server/testing/read-routes.ts`), with `getViewer` mocked to each
  persona, and so is the palette's search ([route.test.ts](./api/palette/[space]/route.test.ts)). A moved read's
  route test checks only the HTTP mapping and the 401, on the in-memory fake
  ([submit-summary](./api/templates/[templateId]/submit-summary/route.test.ts)) or with the request context and the
  service mocked (compare, base-version): what the service decides is the contract suite's. The drafts and imports
  tests mock `getViewer` and the
  server function and test only the HTTP mapping. The audit export's test ([route.test.ts](<./(product)/[team]/audit/export/route.test.ts>)) mocks the viewer and the
  query the same way; the delivery file route has none.
- **Pages:** no unit tests; Playwright covers them. Spec files run in parallel against the production build, one
  server per worker ([decision 0050](../../docs/decisions/0050-each-e2e-worker-gets-its-own-server-and-database.md)):
  `E2E_WORKERS` sets the count (4 by default; `--workers` on the command line wins), and the tests inside one file
  still run in order. Worker `n` (Playwright's `TEST_PARALLEL_INDEX`) uses the server on `E2E_GATE_PORT + n` (3100
  by default), the database `data/e2e-n.db` and the uploads folder `data/e2e-uploads-n`. `playwright.config.ts`
  starts each server after an `npm run db:reset` on its own `DATABASE_URL`, `UPLOADS_DIR` and `DEMO_MODE=1` (the Demo pill, the clock and the persona switcher the specs use are off without it); the demo's
  `data/ucomp.db` and `data/uploads` are never touched. [e2e/storage.ts](../../e2e/storage.ts) derives the
  worker's port, database and folder from its index, and the config (which each worker loads too) takes the worker's
  `baseURL` from it, so a spec just uses `page.goto("/…")`. `openDb()` in `e2e/api/helpers.ts` and the cleanup
  helpers read the same values, so server and specs share the files, and `openDb()` waits out and retries the
  server's `SQLITE_BUSY`. `resetDemoData()` (`e2e/helpers/access.ts`), which a spec calls from `afterAll` when it
  cannot put its changes back by hand, re-seeds the worker's own files. For one spec file, `E2E_WORKERS=1` (or
  `--workers=1`) starts one server instead of four. The run is serial, on one server, when it cannot be split: with
  `E2E_PORT` (a server you started yourself), with `E2E_DATABASE_URL` or `E2E_UPLOADS_DIR` set, and in the opt-in
  `demo` and `stills-1280` projects. To check against a running dev server without a reset, start that server with
  the worker-0 values (`DATABASE_URL=file:./data/e2e-0.db UPLOADS_DIR=./data/e2e-uploads-0 npm run dev`, after an
  `npm run db:reset` with them), then `E2E_PORT=3000 npx playwright test e2e/principles-*.spec.ts` (`npm run dev` has the demo tools on; a `next start` you run yourself needs `DEMO_MODE=1`). To point the
  specs at the demo database instead, set `E2E_DATABASE_URL=file:./data/ucomp.db` and
  `E2E_UPLOADS_DIR=./data/uploads`.
- **Pace and recording:** a functional spec clicks, types and drags at test speed. The helpers in `e2e/helpers/`
  (`tap`, `typeSlowly`, `dragRowTo`) carry no pause and no recording code; waits are on a condition, never a
  `waitForTimeout`. The demo recording lives in `e2e/media/`: the opt-in `demo` project (cursor, mouse glides,
  slow clicks and typing, a video) and `stills-1280` (the 1280 stills). `chromium` never runs
  `e2e/demo-script.spec.ts`; run it with `npx playwright test --project=demo e2e/demo-script.spec.ts`, and the
  whole media set with `npm run gate:media` ([decision 0049](../../docs/decisions/0049-the-demo-script-runs-only-in-the-demo-project.md)).

| Spec                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/principles-*.spec.ts`                                                         | Every product screen as each persona that can see it, the settings modal sections, every `/sim` page, the tabs and filters inside pages, and the dialogs, sheets and popovers. Five files, of about the same duration so they run in parallel: `principles-library-review` (Library, review screens, Request access), `principles-workspace`, `principles-usage-audit-settings`, `principles-views-simulator` and `principles-dialogs`. The checks and the route lists are in `e2e/helpers/principles.ts`. Checks: one primary button per canvas or dialog, status words only in `StatusBadge`, no placeholders, no serious axe violations, CLS 0. The simulator gets only the last three. |
| `e2e/phase-1.spec.ts`                                                              | Shell, personas, Library, workspace header, router prefetch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `e2e/navigation.spec.ts`                                                           | Back and Forward, history entries, canvas scroll, the settings modal over the Library.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `e2e/palette.spec.ts`                                                              | The ⌘K palette: no page carries the template catalog, typing searches on the server, and a persona switch shows none of the last persona's answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `e2e/scenario-02.spec.ts` … `scenario-10.spec.ts`, `e2e/phase-6-two-stage.spec.ts` | Demo scenarios: create (workspace), review loop, going live and breaking change (workspace Usage, `/sim`), revoke (Versions), teams and audit export, access, import, copilot prompt, two-stage approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `e2e/review-rounds.spec.ts`                                                        | A send-back keeps the version number: v1 goes back, returns as v1, round 2 (the draft, the submit dialog, the queue), goes live approved on round 2, and the Versions tab folds its rounds, round 1 linking to its own read-only review screen.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `e2e/revoke-recovery.spec.ts`                                                      | After the Active version is revoked: Edit from the revoked content, contract changes against the version that still renders, approve, render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `e2e/action-refusals.spec.ts`                                                      | A refusal an action used to throw shows the domain's sentence: Edit refused because a newer version went into review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `e2e/autosave-session.spec.ts`                                                     | Autosave never drops an edit silently: a rename on the Versions tab saves, a conflict turns the page read-only with Reload, and leaving with a save out asks first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `e2e/comment-policy.spec.ts`                                                       | A reviewer comments on a version in review; an Active version's threads offer nothing to answer them with.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `e2e/email-off-rename.spec.ts`                                                     | A variable renamed while Email is off is renamed in the subject too, and the draft submits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `e2e/email-subject-comments.spec.ts`                                               | An email's subject and preheader take review comments: started from the Email details in the workspace and from the gutter on the review screen, listed under the field's name, marked, resolved and reopened.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `e2e/focus-targets.spec.ts`                                                        | Where focus goes after Esc in the preview, the name and the rail, after a submit, and when an imported template's Original tab widens the rail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `e2e/list-numbering.spec.ts`                                                       | Numbering and Start at… from the block menu: the editor, the PDF and the Web preview show the same markers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `e2e/maker-checker.spec.ts`                                                        | Someone who edited a draft another author submitted can't approve it or send it back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `e2e/panel-drop-block-move.spec.ts`                                                | A block moved by its grip after a panel drop keeps its id, and its comment thread stays on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `e2e/revert-undo.spec.ts`                                                          | Revert to vN and its toast's Undo: Undo puts the content back, and goes once anything is typed or the tab changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `e2e/submit-holds-draft.spec.ts`                                                   | Submit holds the draft still while it reads the summary, Cancel lets go, and a stale summary is refreshed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `e2e/sunset-passed.spec.ts`                                                        | A passed sunset: Change sunset stays disabled with its reason, and the sunset sweep's one audit row shows on Activity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `e2e/sunset-zone.spec.ts`                                                          | A sunset date ends at 00:00 in the business time zone, and changing the zone moves no sunset already set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `e2e/variable-rename.spec.ts`                                                      | A renamed variable reaches the submit dialog and the stored contract as one rename.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `e2e/versioned-name.spec.ts`                                                       | A draft rename reaches customers only when its version is approved, and the review shows it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `e2e/demo-script.spec.ts`                                                          | The whole demo script on one database state. Only in the opt-in `demo` and `stills-1280` projects, never in `chromium`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e/error-boundaries.spec.ts`                                                     | Each error boundary, reached by breaking a stored JSON value for one test: what it shows and keeps, and Try again once the value is back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `e2e/api/consumer.spec.ts`, `render.spec.ts`, `imports.spec.ts`                    | The `/api/v1` GET routes, the render route, and the import routes over HTTP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
