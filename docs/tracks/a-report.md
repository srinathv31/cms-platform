# Track A report: Phase 5, going live

> Note: this track's migration was replaced at integration by `src/server/db/migrations/0002_phase5_7.sql` (one migration for Phases 5–7).

Branch `track/golive`, worktree `../ucomp-golive`. Decisions: `docs/decisions/track-a.md`. Brief: `docs/phase-5-brief.md`.

## What was built
- **Consumer API**:
  - `GET /api/v1/templates` (Active only, searchable), `GET /api/v1/templates/{id}` (metadata + contract + JSON Schema), `GET /api/v1/consumers/{id}/notices`. All require `X-Consumer-Id`.
  - Wire contract in `src/contracts/api-v1.ts` (import-free, lint-enforced). Shared HTTP helpers moved to `src/server/api/http.ts`.
  - Pure functions in `src/domain/golive/` (json-schema, contract-diff, notices, samples, api-errors, usage).
- **Coral simulator** (`/sim`, `src/simulator/**`, `src/app/(simulator)/**`): ops-console look (variant A) with its own palette in `src/simulator/theme.css`, the "Coral — simulated" banner, "Back to UCOMP", and the Demo pill. It covers:
  - offers, link + pin, value mapping, and send with a results grid that shows exact render errors;
  - customer views (phone, inbox, PDF) and the notices inbox;
  - stepwise relink with new required variables;
  - Customers and Deliveries lists.
  - It reaches UCOMP only over `/api/v1`, server-side.
- **Usage**:
  - The team dashboard (`/[team]/usage`, Insights layout per Unknown.png, server-rendered SVG charts in Cards + Tooltips, Overview | Consumers with the consumers table and filter).
  - The per-template Usage tab. Previews never count; renders = succeeded + failed attempts.
- **Integration panel** behind SHARE (`workspace-share.tsx`, `src/components/integration/**`): ID, Active version, channels, contract table, copyable JSON Schema, curl/fetch samples, response formats, "What changed since vN". Focus-trapped, inline copy confirmation.
- **Demo pill**: "Open simulator" opens /sim and closes the drawer.
- **Specs**: `scenario-04`, `scenario-05`, `scenario-06` (step 4b: Coral's send fails with the revoke message), `e2e/api/consumer.spec.ts`, helpers in `e2e/helpers/golive.ts` (self-cleaning fixture for Spring Travel v2; always restores the clock).

## Checks at commit
- `tsc` clean; `eslint src e2e` 0 errors (1 pre-existing warning in `e2e/qa/contact-sheet.mjs`).
- `vitest`: 112 files, 1,917 tests passed.
- `next build`: passes. It prints the same Node `ExperimentalWarning: localStorage…` as Track B. To baseline at integration.
- Gate `E2E_GATE_PORT=3101 npx playwright test`: 124/124 passed on a fresh build of the committed code. Scenarios 04–06 also pass in the `demo` and `stills-1280` projects on the dev server.
- QA (Sonnet, two passes against the checklist: usage/integration and simulator): 3 must + 14 should found. All fixed; axe clean on every /sim route, the usage pages and the integration panel.

## Schema and migration
- Only `src/server/db/schema/sim.ts` changed:
  - `sim_links`: unique index on `offer_id`.
  - `sim_deliveries`: nullable `template_id`, `version_number` and `newer_version`; the error keeps `{status, code, message}`; indexes on (offer_id, at) and batch_id.
  - `sim_offers.terms`: new `endsOn`.
  - `sim_notice_reads` already existed in `0000_init`; this track only seeded rows into it (no schema change to that table).
- Migration `0002_phase5_golive.sql` (+ snapshot, journal). It collides with Track B's `0002_phase6_access`; regenerate at integration.

## Seed changes
- Spring Travel's offer terms carry `annualFee: 95` and `endsOn`. Customers without a fee have "0".
- `sim_notice_reads` marks every seeded Coral notice read except Balance Transfer v1's sunset (one unread notice at start).

## New dependencies
None (zod's `fromJSONSchema` was already available).

## Files outside the ownership map
- `eslint.config.mjs`: purity rule for `src/contracts`.
- `src/server/seed/context.ts`, `index.ts`: `simNoticeReads`.
- `src/app/api/v1/templates/[templateId]/render/route.ts`: imports the moved HTTP helpers (behaviour unchanged).
- `src/components/primitives/status-badge.tsx`: dropped `opacity-80` on the sunset suffix (contrast).
- `e2e/phase-1.spec.ts`: SHARE ring test uses `.first()`.

## Known issues
- Headless Chromium can't show the embedded PDF (blank frame); specs fetch "Open PDF" and check `%PDF-`. Real Chrome shows it.
- In the `demo` project, harness init scripts add console noise in the PDF frame; `dropDemoNoise` filters exactly those lines in demo mode only.
- **Not Track A code, needs a look:** on the dev server, clicking Edit on an Active template occasionally does nothing (about 1 in 4). Scenario 5 retries the click. Suspect `src/server/actions/templates.ts` `startDraft` or a redirect to the same URL.

## For the integrator
1. `src/components/demo/demo-pill.tsx` conflicts with Track B (B added clearing of `ucomp:dismissed:*` on Reset). Keep both changes.
2. `e2e/phase-1.spec.ts` was edited by both tracks; keep both changes.
3. Drop both `0002_*` migrations and regenerate one (`phase5_7`).
4. Investigate the intermittent Edit no-op above in the 7b UX pass.
