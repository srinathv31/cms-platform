# `src/simulator`: Coral, a simulated consumer of `/api/v1`

Coral is a pretend card-offers system that belongs to another company. It shows the consumer side of the demo:
link an offer to a Stencil template, pin a version, map Coral's own customer and offer fields to the template's
variables, send renders, see the API's errors as they come back, read Stencil's notices, and relink when a new
version arrives. It lives in this repo, but it behaves like an outside system: it reaches Stencil only over HTTP on
the public `/api/v1`, keeps its data in its own `sim_*` tables, and has its own look. Its pages are under `/sim`
(routes in `src/app/(simulator)`), opened from the Demo pill's "Open simulator" button
([demo-pill.tsx](../components/demo/demo-pill.tsx)).

## Rules

Lint-enforced in `eslint.config.mjs`:

- Files in `src/simulator/**` and `src/app/(simulator)/**` may not import `@/server/*`, `@/domain/*` or `@/editor/*`.
  The one exception is `@/server/db/schema/sim`, Coral's own tables. `@/contracts/api-v1`, `@/lib/*` and
  `@/components/*` are allowed.
- The reverse: `src/app/(product)/**`, `src/app/api/**`, `src/components/**` and `src/server/**` may not import
  `@/simulator` or the sim schema. `src/server/seed/**` and `src/server/reset.ts` are exempt, because they write
  Coral's seed rows ([seed/sim.ts](../server/seed/sim.ts)). `src/editor` and `src/domain` ban `@/simulator/*` in
  their own rules.

Conventions (not linted):

- Every call to Stencil goes through `ucompApi()` in [ucomp-api.ts](ucomp-api.ts), on the server only: from
  `queries.ts` in server components and from `actions.ts` in server actions. Client components call the actions;
  the browser never talks to `/api/v1` and never sees its 4xx answers.
- Coral has no persona and no permissions. `X-Consumer-Id: coral` (`CONSUMER_ID`) is its only identity, and it must
  be a consumer Stencil has registered ([seed/platform.ts](../server/seed/platform.ts)).
- Show the API's errors verbatim. A failed render keeps `{ status, code, message }` exactly as the API sent it, and
  the results grid prints `message` unchanged. Coral writes its own sentence only when there is no contract error
  body: `unreachable` (status 0), `bad_response`, and `no_active_version` in the link flow.
- Colors come only from the `--sim-*` custom properties in [theme.css](theme.css), which apply under the
  `[data-sim]` element the layout renders. It is the only stylesheet besides `src/styles/tokens.css` that holds raw
  colors; Stencil's tokens don't reach inside Coral, and Coral's components never write a color of their own.
- Coral's UI is built from [ui/bits.tsx](ui/bits.tsx) and native elements, not Stencil's shadcn primitives (the one
  exception is `Skeleton`), so it reads as a different product. The frame strip in the layout is Stencil's.
- Display helpers are Coral's own ([ui/format.tsx](ui/format.tsx)) because `@/domain/dates` is off limits. Dates
  are formatted in UTC so the server and the browser agree.
- Nothing here logs customer values.

## Layout

| Path | What it holds |
| --- | --- |
| [ucomp-api.ts](ucomp-api.ts) | The HTTP client for `/api/v1`: `createUcompApi`, `apiOrigin`, `ucompApi()`. Returns `ApiResult<T>`; never throws on an HTTP error. |
| [queries.ts](queries.ts) | Server-only read models: `getSimHome`, `getSimOfferPage`, `getSimLinkFlow`, `getSimDeliveryView`, `loadDeliveryFile`, `loadBatch`. Each reads `sim_*` rows and asks the API for what only Stencil knows. |
| [actions.ts](actions.ts) | Server actions: `searchTemplates`, `linkTemplate`, `saveMapping`, `sendToCustomers`, `markNoticesRead`, `getDeliveryView`. Each returns `SimResult`; the four that write call `refresh()`. |
| [fields.ts](fields.ts), [mapping.ts](mapping.ts) | Pure: Coral's 14 field paths (`SIM_FIELDS`) and the variable types each fits; `suggestMapping`, `missingRequired`, `valuesFor`, `blockedSentence`. |
| [types.ts](types.ts) | Coral's read models and `SimResult`, built on the `Api*` wire types. |
| [assert-never.ts](assert-never.ts) | Coral's own exhaustive check. Every branch on a channel is a `switch` over `ApiChannel` (the client) or `SimChannel` (a stored delivery, `schema/sim.ts`) that ends in `assertNever`, so a channel added to either is a compile error at each place that must handle it. |
| [db.ts](db.ts) | `simDb`, a Drizzle client that knows only the sim schema, and `withBusyRetry` for writes. |
| [theme.css](theme.css) | Coral's palette, fonts and radii. |
| [ui/offer-view.tsx](ui/offer-view.tsx) | Client. One offer: Template, Values and Send tabs (`?tab=`), optimistic mapping rows, send, customer drawer. |
| [ui/link-flow.tsx](ui/link-flow.tsx) | Client. Link and relink: search, choose, version and channels, map, confirm. |
| [ui/send-tab.tsx](ui/send-tab.tsx), [ui/customer-drawer.tsx](ui/customer-drawer.tsx) | The customer picker and results grid; the phone, inbox and PDF views of one delivery. |
| [ui/notices-panel.tsx](ui/notices-panel.tsx), [ui/offers-table.tsx](ui/offers-table.tsx), [ui/mapping-table.tsx](ui/mapping-table.tsx) | Notice inbox with mark-read; the offers list; the variable-to-field table (with [ui/mapping-select.tsx](ui/mapping-select.tsx)). |
| [ui/bits.tsx](ui/bits.tsx), [ui/format.tsx](ui/format.tsx), [ui/page-frame.tsx](ui/page-frame.tsx), `ui/nav*.tsx` | Shared pieces: pills, buttons, panels, strips, table classes; labels and dates; page scroll and skeleton; sidebar. |
| [ui/lists.ts](ui/lists.ts) | Server-only reads for the Customers and Deliveries pages (sim tables only). |
| [(simulator)/layout.tsx](<../app/(simulator)/layout.tsx>) | The frame: a dashed Stencil strip ("Back to Stencil", "Coral — simulated") and the Demo pill around Coral's sidebar and `[data-sim]` content. |
| `src/app/(simulator)/sim/` | Pages `/sim`, `/sim/offers/[offerId]`, `/sim/offers/[offerId]/link` (`?template=`), `/sim/customers`, `/sim/deliveries`, `/sim/notices`, and the route [deliveries/[deliveryId]/file](<../app/(simulator)/sim/deliveries/[deliveryId]/file/route.ts>). |
| [schema/sim.ts](../server/db/schema/sim.ts) | Coral's tables. Migrations go to the shared `src/server/db/migrations` folder (`drizzle.config.ts` lists both schemas). |

## Where data lives

| Table | Holds |
| --- | --- |
| `sim_offers` | Coral's offers and their terms (`spend`, `bonus`, `months`, optional `annualFee` and `endsOn`). |
| `sim_customers` | Coral's customers: name, email, home state, purchase APR, annual fee. |
| `sim_links` | One row per offer (unique `offer_id`): template id, a cached template name, `pinned_version`, chosen channels, and the mapping (variable key → Coral field path). Relinking updates the row. |
| `sim_deliveries` | One row per customer × channel of a send, grouped by `batch_id`: what Coral received in `output` (PDF as base64, the web HTML, or the email JSON) or the API's error, plus `newer_version` and `correlation_id`. |
| `sim_notice_reads` | Which of Stencil's notices Coral has marked read. |

Fetched from `/api/v1` on each page load and never stored: version states, sunset and revoke dates, whether the pin
still renders, the pinned version's contract, the diff to a newer Active version, template search results, and the
notices. When the API answers, its template name wins over the cached one.

Time: `sim_deliveries.at` is the API response's HTTP `Date` header, which Stencil sets from its demo clock
(`withDemoDate` in [server/api/http.ts](../server/api/http.ts)), so deliveries line up with Stencil's sunsets after
the clock moves. `linked_at` and `read_at` use real time.

In the demo both sides share one SQLite file: `simDb` opens `DATABASE_URL` (default `data/ucomp.db`) through
`createAppClient` in `src/lib/serialized-writes.ts`, so its writes take turns with Stencil's. The seed
([seed/sim.ts](../server/seed/sim.ts)) writes four offers (Spring Travel unlinked, so the demo links it live), ten
customers, three links, and read marks on every Coral notice but the newest.

## How it works

**Calling Stencil.** `ucompApi()` builds a client for the current request. `apiOrigin()` uses `UCOMP_API_ORIGIN`
when set, else `http://127.0.0.1:` plus `PORT` (3000 when unset): the app calls itself over loopback, as an outside
consumer would. It never takes the origin from the request's `Host` or `X-Forwarded-*` headers, because the server
stores what that origin answers. It calls `connection()`, so callers render inside `<Stream>` or run in an action.
Every request sets `X-Consumer-Id`, `Accept: application/json` and `cache: "no-store"`. `render()` adds
`X-Correlation-Id`, asks for PDF as base64 JSON, keeps web as the HTML document, reads `X-Stencil-Newer-Version`,
and returns `at` from the `Date` header.

**Pages.** Each page is a sync component that wraps an async child in `<Stream fallback={<PageSkeleton …/>}>`. The
child awaits one read model and hands it to the UI. When the API can't be reached, the read model still returns
Coral's own rows with `apiError` set, and the page shows it in a `Strip`.

**Flows.**

- **Link** (`LinkFlow`, `getSimLinkFlow`, `linkTemplate`). The search box calls `searchTemplates`, debounced
  250 ms; only Active templates come back. Choosing one navigates to `?template=UC-…`, and the page loads it at its
  Active version with `suggestMapping` (keeps current mappings that still fit, auto-maps keys it is sure of, leaves
  `annual_fee` to the person). `linkTemplate` re-reads the template, refuses a version that isn't Active or a channel
  it doesn't render, drops unknown keys and fields, and upserts `sim_links`. Unmapped required keys may be saved;
  Send then names them.
- **Map values** (`OfferView`, `saveMapping`). Each select saves at once under `useOptimistic`. `saveMapping` checks
  the keys against the pinned version's contract over the API.
- **Send** (`sendToCustomers`). Checks the mapping against the pinned contract first (`missingRequired`, then
  `blockedSentence`). Then one `POST /api/v1/templates/{id}/render` per customer × linked channel at the pinned
  version, at most 3 in flight, each with a fresh `coral_…` correlation id. `valuesFor` leaves out fields Coral has no
  value for, so Stencil answers `missing_variables` rather than Coral inventing a value. Every render becomes a
  `sim_deliveries` row, failed or not. The action fails only on bad input or when Stencil couldn't be reached at all.
- **Customer view** (`CustomerDrawer`, `getDeliveryView`). Sandboxed iframes load `/sim/deliveries/{id}/file`,
  which serves the stored output with `no-store`, `nosniff`, and for HTML a CSP that allows no scripts.
- **Upgrade, sunset, revoke** (`loadLinkState`, `linkStatus`). For each link Coral reads the template at the pinned
  version, and when a newer version is Active, reads `?since={pinned}` for the diff. The offer page shows
  "vN available" with the `newRequired` keys, or "A send now fails" when the pin is revoked or past its sunset.
  Relinking reopens the link flow with `?template=` set: What changed, Map new value, Confirm.
- **Notices** (`NoticesPanel`, `markNoticesRead`). Read from `GET /api/v1/consumers/coral/notices`, page after page
  (`allNotices` follows `nextCursor` until `hasMore` is false), and shown newest first; read state is Coral's own.
  Each kind has a title and a tone ("New version: v3", "Sunset scheduled for v2", "v2 sunset passed", "v1
  revoked") beside the API's `message`, shown as sent. A `sunset_passed` notice arrives when Stencil's sweep runs,
  which can be after the sunset; the offer's "A send now fails" comes from the template's `sunsetPassed`, not from
  the notice.
  Coral keeps no cursor and reads the whole outbox on each page load, at most `MAX_NOTICE_PAGES` (50) pages; an
  empty page that says more follow, or more pages than that, shows as an API error. A consumer that polls would
  keep the last `nextCursor` instead.

**Against a different backend.** The simulator knows only the HTTP contract, so pointing it at another
implementation of `/api/v1` (a Spring Boot service, for example) takes only `UCOMP_API_ORIGIN`. In a real consumer,
`ucomp-api.ts` corresponds to the client it would generate from Stencil's API description (the role
[api-v1.ts](../contracts/api-v1.ts) plays here; see [src/contracts/README.md](../contracts/README.md)), and the
`sim_*` tables to its own data.

## Copy these

| When you need to… | Copy | Notes |
| --- | --- | --- |
| Call another `/api/v1` endpoint | `getTemplate` in [ucomp-api.ts](ucomp-api.ts) | Add the shape to `src/contracts/api-v1.ts` first. Return `ApiResult`; keep the API's error as is. |
| Add a page | [sim/notices/page.tsx](<../app/(simulator)/sim/notices/page.tsx>) | `<Stream>` with a `PageSkeleton` of the real geometry; `apiError` strip. With a param and `notFound()`: [offers/[offerId]/page.tsx](<../app/(simulator)/sim/offers/[offerId]/page.tsx>). |
| Add a server action | `markNoticesRead`, `saveMapping` in [actions.ts](actions.ts) | zod `safeParse`, then `fail(reason)`; `withBusyRetry` around the write; `refresh()` after. Unexpected errors are not caught. |
| Save on change, optimistically | the mapping rows in [ui/offer-view.tsx](ui/offer-view.tsx) | `useOptimistic` inside `useTransition`, with a per-row error. |
| Pure logic with tests | [mapping.ts](mapping.ts) with [mapping.test.ts](mapping.test.ts) | No server imports. |
| A styled piece | [ui/bits.tsx](ui/bits.tsx) | Reads `--sim-*` only; server-safe. |

## Don't copy

- [ui/lists.ts](ui/lists.ts) is a read model that lives in `ui/`, and its `getSimCustomers` repeats `customerRow`
  from `queries.ts`. Put new reads in `queries.ts`.
- `NoticeBadge` (rendered by the layout, so on every `/sim` page) and `/sim/notices` call `getSimHome()`, which also
  loads every offer's link state and last send over the API. A new count or list should read only what it shows.
- Copied helpers: `joinWithAnd` in `mapping.ts` and `andList` in `ui/format.tsx` are the same function;
  `CHANNEL_LABEL` is defined in both `actions.ts` and `ui/format.tsx`; dollar amounts are formatted three times
  (`money` in `ui/template-tab.tsx`, `fee` in `ui/send-tab.tsx`, inline in `sim/customers/page.tsx`). In UI code use
  `ui/format.tsx` and add what's missing there.
- `ui/link-flow.tsx` builds `SimMappingRow`s inline, repeating `mappingRows` in `queries.ts` (server-only, so the
  client can't import it).
- `src/app/(dev)/design/simulator/` is a dev-only design mock of these screens, with its own `bits.tsx`, data and
  raw colors. It is not the simulator.
- The comment blocks in `types.ts` that restate the helper and action signatures have drifted from the code (they
  say every action calls `refresh()`, and the auto-map list is short two keys). Read `actions.ts` and `mapping.ts`.
- `src/server/seed/sim.ts` has its own `SIM_FIELDS` (a key → path map for seeded links). It shares only the name with
  `SIM_FIELDS` in `fields.ts`.

## Testing

- Unit tests run with `npx vitest run src/simulator`. [mapping.test.ts](mapping.test.ts) covers the pure helpers.
  [ucomp-api.test.ts](ucomp-api.test.ts) drives the client through a fake `fetch`, including that a forged `Host`
  never becomes the origin. [actions.test.ts](actions.test.ts) runs the actions and read models against a temporary
  SQLite file migrated from `src/server/db/migrations` and a fake Stencil behind `fetch`; it mocks `@/simulator/db`,
  `next/cache` and `next/server`. [ui/notices-panel.test.tsx](ui/notices-panel.test.tsx) renders the inbox in
  happy-dom with every notice kind.
- End to end (Playwright): `e2e/scenario-04.spec.ts` (link, send to five customers, customer views, no customer
  values in Stencil's tables), `e2e/scenario-05.spec.ts` ("v3 available", send fails after the sunset, relink),
  `e2e/scenario-06.spec.ts` (revoke, then Coral's send fails with the API's message), `e2e/sunset-passed.spec.ts` (the
  sweep's `sunset_passed` notice in Coral's inbox), `e2e/demo-script.spec.ts`, and
  the "Simulator (foreign system)" block in `e2e/principles.spec.ts` (axe and layout shift on each `/sim` page).
  The drivers and the snapshot and restore of `sim_*` rows are in `e2e/helpers/golive.ts`.
  `e2e/api/consumer.spec.ts` calls the GET routes the way Coral does.
- The e2e helpers open `data/ucomp.db` directly (`openDb` in `e2e/api/helpers.ts`) and write to `sim_*` rows. When
  `playwright.config.ts` starts its own server (the gate port), it runs `npm run db:reset` first, so a run rewrites
  the demo database.
