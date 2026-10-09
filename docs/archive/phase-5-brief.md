> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# Phase 5 brief: going live (Track A)

Track A, worktree `/Users/srinathvenkatesh/Documents/CodeProjects/prototypes/cms-platform/ucomp-golive`, dev server http://localhost:3001, gate port 3101. Read this instead of the long plans. They're the source if this is silent: `docs/UCOMP-Implementation-Plan.md` §9 "Phase 5" and §8 "The simulator boundary", and the build plan's "Going live (mocked)" and Demo script scenarios 4, 5 and 6.

**Gate:** `e2e/scenario-04.spec.ts` and `e2e/scenario-05.spec.ts` end to end, `e2e/scenario-06.spec.ts` updated (after the revoke, Coral's send in the simulator fails with the revoke message), `e2e/api/consumer.spec.ts`, domain tests for every pure function below, and visual QA of the dashboard against `reference-images/Unknown.png` and of the simulator's "outside system" look.

## Contracts (written by the lead; don't change them — if one is wrong, make the smallest additive change and say so first in your report)
- `src/contracts/api-v1.ts`: the /api/v1 wire shapes (search, template detail + contract + JSON Schema + diff, notices, render restated). Self-contained, no imports (ESLint). Both sides use it.
- `src/domain/golive-types.ts`: UCOMP's read models (Usage dashboard, per-template Usage, integration panel), `API_ERROR_STATUS`, the windows (`USAGE_WINDOW_DAYS` 30, `NEARING_SUNSET_DAYS` 30, `HEATMAP_WEEKS` 18), every UCOMP-side signature (in comments), and compile-time checks that the render types still fit the wire shapes.
- `src/simulator/types.ts`: Coral's side: mapping fields, read models, action signatures. The simulator may NOT import `@/domain`, `@/server` (except `@/server/db/schema/sim`) or `@/editor`; it imports `@/contracts/api-v1` and its own files.

## What exists
- Render: `POST /api/v1/templates/{id}/render` (`src/app/api/v1/templates/[templateId]/render/route.ts`, contract `src/domain/render/types.ts`, errors and exact messages in `src/domain/render/errors.ts`). `render_log` never holds values; previews have `is_preview = 1` and no consumer.
- Notices: `consumer_notices` rows written by `src/server/effects.ts` to every consumer that rendered the template (not a preview) in the last 90 days. Seeded and live payloads differ; `noticeView` normalizes (see `NoticeRow`).
- `loadConsumerUsage` (`src/server/queries/review-shared.ts`) feeds the consequence text; keep it, reuse its filters.
- Seed (done in contracts): ~27k render_log rows over 90 days, consumers `coral` and `deposits-online`; sim offers (Spring Travel unlinked, with `terms.annualFee: 95` and `terms.endsOn`), 10 customers (every one has `annualFee`, "0" or a fee; one 60-character name), 3 links (Balance Transfer pinned v1, Cash Back v2, Holiday Points v2), and `sim_notice_reads` marking every seeded Coral notice read except Balance Transfer v1's sunset (one unread on first load).
- Schema (migration `0002_phase5_golive`): `sim_links` one row per offer (unique `offer_id`); `sim_deliveries` + `template_id`, `version_number`, `newer_version`, error `{status, code, message}`, indexes on (offer_id, at) and batch_id; `sim_offers.terms` + `endsOn`. No UCOMP table changed.
- The Usage nav item already exists (`app-shell/nav.ts`). Placeholders: `src/app/(product)/[team]/usage/page.tsx`, `…/templates/[templateId]/usage/page.tsx`, the integration sheet frame in `src/components/workspace/workspace-share.tsx`, the demo pill's disabled "Open simulator" (`src/components/demo/demo-pill.tsx`).

## Routes
- `GET /api/v1/templates?q=&limit=` · `GET /api/v1/templates/{id}?version=&since=` · `GET /api/v1/consumers/{consumerId}/notices?since=&templateId=&limit=` (semantics and errors in api-v1.ts).
- `/[team]/usage` (team dashboard; "all" = every visible team) · `/[team]/templates/[templateId]/usage` (the tab).
- Simulator (`src/app/(simulator)/`, its own layout, palette, dashed "Coral — simulated" banner, "← Back to UCOMP" pill to `/`, and the Demo pill so the presenter can advance the clock there):
  - `/sim`: offers (link state, "v3 available", last send) and the notice inbox.
  - `/sim/offers/[offerId]`: link card + mapping, Send (customer picker), the results grid; a customer view dialog per result.
  - `/sim/offers/[offerId]/link` (`?template=UC-…` once chosen): search → version → channels → map → Link / Relink to vN.
  - `/sim/deliveries/[deliveryId]/file`: GET, the stored output (pdf bytes, web html, email html) for iframes and "Open PDF".

## Decisions made in the contracts (log them in `docs/decisions/track-a.md`)
1. **The /api/v1 contract is its own module** (`src/contracts`), because the ESLint boundary forbids the simulator `@/domain`. Domain types are checked against it at compile time.
2. **The simulator calls UCOMP server-side** (server actions and server components fetch the app's own origin from `headers()`; `UCOMP_API_ORIGIN` overrides). The browser never sees a 4xx, so the console stays clean while sends fail on purpose.
3. **Consumer endpoints require `X-Consumer-Id`** (registered), like render. Notices also require it to equal the path id.
4. **"Renders this month" = rolling 30 days vs the 30 before** (a calendar month is nearly empty early in the month). Label "Renders · 30 days". Renders = successful non-preview renders; errors are counted apart.
5. **One link per offer**; relink updates it. A link may be saved with unmapped required variables; **Send** is then disabled and names them ("Map Annual fee to send."). Optional variables may stay unmapped.
6. **A send renders every linked channel for each chosen customer** (results grid: a row per customer, a status per channel). PDF is requested with `encoding: "base64"`; outputs stay in `sim_deliveries`. Customer view: web → phone frame, email → inbox, pdf → embedded PDF + Open PDF.
7. **Mapping fields** are customer.* and offer.* (`SimFieldPath`). `annual_fee` is never auto-mapped: the person chooses (scenario 5 picks "Offer · Annual fee").
8. **Simulator times**: deliveries are stamped with real time in the action (the simulator can't read UCOMP's clock); notice times are shown relative to the API's `asOf`.
9. **The integration panel loads on open** through a server action (props unchanged, so `workspace-header.tsx` and `review-header.tsx` stay untouched); the sheet widens to about 40rem.

## Gotchas (plus `docs/phase-4-brief.md`'s list)
- GET route handlers prerender under Cache Components unless they read request data first: read `request.headers` (X-Consumer-Id) before any DB call.
- The simulator's DB handle is `src/simulator/db.ts` (its own libSQL client on `DATABASE_URL`, sim schema only). SQLITE_BUSY: render first, then write the batch's deliveries in one insert, with a small busy retry.
- At most 3 renders in flight per send. The first PDF render warms fonts (≈1–2 s).
- Simulator pages that fetch or read the DB render inside `<Stream>`; `fetch(..., { cache: "no-store" })`. `new Date()` is fine in actions, never in server components (use `asOf`).
- Never log values: no customer data in console output, in UCOMP tables or in render_log (scenario 4 asserts it).
- Notices and the consequence text only name Coral if Coral rendered the template (not a preview): specs must make Coral render before approving v3.
- Typed routes: `/sim/offers/${id}` needs `as Route`. Base UI: `render` prop, not `asChild`.
- The simulator's palette lives in `src/simulator/theme.css` as `--sim-*` custom properties under `[data-sim]` (its own colors; UCOMP tokens stay untouched); components use `bg-(--sim-surface)` style utilities. Follow the picked mock under `src/app/(dev)/design/simulator/` (don't edit the mocks).

## Slices (at most 3 agents at once; file ownership is disjoint within a wave)

### Wave 1 — server and domain (no UI)
**S1 · Consumer API + integration data — Opus.** Owns `src/domain/golive/{json-schema,contract-diff,notices,samples}.ts` + tests; `src/server/api/http.ts` (the header and error-response helpers, moved out of the render route) and the render route's import of them; `src/app/api/v1/templates/route.ts`, `src/app/api/v1/templates/[templateId]/route.ts`, `src/app/api/v1/consumers/[consumerId]/notices/route.ts` (+ `route.test.ts` each, like the render route's); `src/server/queries/consumer-api.ts`, `src/server/queries/integration.ts`, `src/server/actions/integration.ts`; `e2e/api/consumer.spec.ts`. Signatures in golive-types.ts. Accept: every error row in api-v1.ts has a test; every seeded sample validates against its JSON Schema and junk doesn't; both notice payload shapes normalize; search by id/words; `curl` against :3001 works for all three.

**S2 · Usage aggregation — Opus.** Owns `src/domain/golive/usage.ts` + test (`trendPct`, `heatmap`, `usageTags`, `errorText`); `src/server/queries/usage.ts` (+ test against a fresh seeded DB, like `queries/review.test.ts`). Accept: previews never count (test inserts a preview and a consumer-less row and sees no change); Coral Offers dashboard shows Balance Transfer v1 "sunset in 21 days" as nearing sunset with its tag; heatmap has `HEATMAP_WEEKS` columns with levels 0–4; numbers match direct SQL; each query < 150 ms on the seed.

**S3 · Simulator core — Opus.** Owns `src/simulator/{db.ts,fields.ts,mapping.ts,mapping.test.ts,ucomp-api.ts,queries.ts,actions.ts}` and `src/app/(simulator)/sim/deliveries/[deliveryId]/file/route.ts`. Codes against api-v1.ts; integrates once S1's routes land (run S1 first if only two slots are free). Accept: mapping tests (suggest, missing, values, sentence); a scratch script (in its scratch folder, deleted after) links Spring Travel to a template the agent creates, sends to 5 customers × channels, all delivered; a revoked/sunset version's send stores the API's exact error; no `@/domain`/`@/server` imports (`npx eslint src/simulator`).

### Wave 2 — UI (Sonnet; each also follows `docs/ui-checklist.md`)
**U1 · Simulator UI.** Owns `src/app/(simulator)/**` (except the file route), `src/simulator/ui/**`, `src/simulator/theme.css`, and `src/components/demo/demo-pill.tsx` (the entry becomes a link to `/sim`). Depends on S3 (+ the lead's mock pick). Accept: scenario 4/5/6 flows by hand on :3001; Send disabled with the names when blocked; failures show the message verbatim; the long name holds in the grid, the phone frame and the PDF; zero console errors.

**U2 · Usage dashboard + Usage tab.** Owns both usage `page.tsx` files and `src/components/usage/**` (stat cards with trend pill, SVG heatmap with month labels and More/Less legend, horizontal bars, consumers table with tags, the template tab). Server-rendered SVG inside shadcn Card/Tooltip, no chart library. Depends on S2 (+ the mock pick). Accept: matches Unknown.png's composition; skeletons with real geometry (CLS 0); 1280 and 1440 clean.

**U3 · Integration panel.** Owns `src/components/workspace/workspace-share.tsx` and `src/components/integration/**`. Sections: ID + Active version + channels; contract table; JSON Schema (copy); sample request (curl | fetch, per channel); response formats; "What changed since vN" (picker over `since`); copy buttons everywhere. Depends on S1. Accept: Sam (viewer) can open and copy; copied text equals `jsonSchemaText`/samples; focus returns to the ring on close.

### Wave 3 — gate and QA
**E1 · Gate specs — Sonnet.** Owns `e2e/scenario-04.spec.ts`, `e2e/scenario-05.spec.ts`, the scenario-06 update, and `e2e/helpers/golive.ts` (new; additive). Self-contained like scenario-03: a fixture inserts "Spring Travel Rewards — Terms" with v2 Active (clone a seeded Coral version's body, variables first_name, last_name, purchase_apr, home_state + optional offer_end_date, channels pdf/web/email) and afterAll removes everything it wrote (template rows, render_log, notices, sim_links for offer_spring_travel, sim_deliveries, new sim_notice_reads, and `clock_offset_days` back to its prior value). Scenario 5 standalone: fixture link pinned v2 + one Coral render via the API before Maya edits. Uses `shoot()` at the script's beats. Accept: all three green on :3101 twice in a row against one DB.

**Q1 · QA — Sonnet (report only).** Checklist pass on every new screen at 1280 and 1440; the dashboard vs Unknown.png; the simulator reads as a different product. The lead batches fixes into one or two fix agents.

## Names the specs rely on (UI slices: use exactly these)
- Simulator: offer links by offer name; buttons "Link template", "Relink to v{n}", "Send"; status text "Delivered" / "Failed"; the grid is a `table` named "Results"; the upgrade badge text "v{n} available"; mapping rows are comboboxes named by the variable label; the customer view is a `dialog` named "{Customer name} · {Channel}".
- Usage: stat labels "Renders · 30 days", "Active templates", "Consumers", "Nearing sunset"; the consumers table is a `table` named "Consumers".
- Integration panel: the sheet is a `dialog` named by the template name; copy buttons are named "Copy {thing}" ("Copy JSON Schema", "Copy curl", "Copy template ID").
