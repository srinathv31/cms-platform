# Handoff: you orchestrate Phases 5, 6 and 7 to the end

You're the lead (orchestrator) for the rest of the UCOMP prototype. Phases 1–4 are done and committed on `prototype`:
- 26cab98: foundation
- 5a64260: editor
- 68a8836: navigation fixes
- 78ea70b: Phase 3, preview and render
- 949f49c: Phase 4, lifecycle and review

Repo: /Users/srinathvenkatesh/Documents/CodeProjects/prototypes/cms-platform/cms-platform

**Mandate.** Finish Phases 5, 6 and 7 on your own, then hand Sri the finished product to review once. No per-phase review gates, no blocking taste checkpoints. Make the calls the way Sri has been making them (below), record each one so he can overrule it, and keep going.

**Execution: parallel tracks.** The work runs as three tracks in separate git worktrees (A: Phase 5, B: Phase 6, C: Phase 7a), then one integration session for Phase 7b. `docs/tracks/README.md` has the split, the branches, the ports, the file-ownership map and the laptop resource rules, and it overrides this file where they differ: a track commits on its own branch, records nothing until integration, and never merges into `prototype` itself. In single-lead mode (the default) you are the lead for all of it: you set up the worktrees, run the tracks through subagents, and integrate.

## What this is
UCOMP is a bank's content platform. Business teams write disclosure templates with typed variables; other systems (Coral, simulated) render them.
- Treat this as phase one of the real platform. `src/editor/` will be lifted into production as is (frozen public API: additive changes only, and update its README).
- Mock only what depends on outside systems: login, delivery, Coral.
- **UX is the top priority.** Audiences: C-suite, everyday business users, engineers.
- The app must be self-evident:
  - no onboarding;
  - no hint text;
  - one black primary button per screen;
  - explain only when blocked;
  - consequences before commitment.

## Read first, in order
1. `docs/UCOMP-Implementation-Plan.md`: §9 Phases 5, 6, 7 (scope and gates), §6 (data model), §8 "The simulator boundary", §10 QA, §12 open questions.
2. `docs/UCOMP Prototype — Build Plan for Claude Code.md`: "Experience principles", "Going live (mocked)", "Teams, access and administration", "Seed data", "Out of scope and caveats", and the whole "Demo script". Scenarios 1–11 are the acceptance test.
3. `docs/agent-brief.md`: the rules every subagent follows. Give it to every subagent.
4. `docs/ui-checklist.md`: the UI yardstick from Phase 3's QA. Every UI agent and every QA agent uses it.
5. `docs/phase-4-brief.md`: an example of the one-page phase brief that worked. Write one per phase.
6. `docs/design-reference.md` and `reference-images/`:
   - `Unknown.png` is the Usage dashboard target;
   - `Unknown-3.png` is the settings modal target.
7. `src/editor/README.md` and `AGENTS.md`: this Next.js 16.3.8 has breaking changes, so read `node_modules/next/dist/docs/` before any Next API.
8. Your memory files (auto-loaded): `ucomp-build-posture`, `ucomp-layout-philosophy`. They hold Sri's taste.

## Decisions already made (don't reopen them)
- **Layout and look:**
  - Workspace layout is "Rail": the main pane is just the document; ALL per-template metadata and controls live in the right rail, never the header or the document column.
  - Preview: the rail widens into the preview (Preview | Variables tabs).
  - The review screen is document-first with a decision rail.
  - Review comments live in the rail (Comments | Variables tabs) with gutter markers.
  - The header's status badge carries the state, and the label never repeats it.
  - The SHARE ring (76px) shows on Active templates only, and it opens the integration panel (the sheet frame exists in `src/components/workspace/workspace-share.tsx`).
  - Fonts: Newsreader (display and in-document H2), Figtree (UI), Geist Mono (keys).
- **Platform:**
  - Chrome is the only target browser.
  - Tooling: npm, current Node, no version pinning. New deps are fine via `npm install` (report them).
  - Data: SQLite via libSQL + Drizzle (`./data/ucomp.db`). Migrations are in `src/server/db/migrations`; generate them with `npx drizzle-kit generate --name <name>`. `npm run db:reset` re-migrates and reseeds.
  - Demo clock: `now()` from `src/server/clock.ts` (real time + an advance offset; the demo pill advances it).
  - User sessions run on the production build (`npm run demo`).
  - `partialPrefetching` stays OFF.
- **§12 defaults, now final:**
  - Q5: inactivity is flagged at 90 days, the Team Admin can suspend or keep, and automatic suspension comes at 120 days.
  - Q6: charts are small server-rendered SVG inside shadcn Cards and Tooltips (no Recharts).
  - Q7: the simulator is a full-page route in the same tab with an "← Back to UCOMP" pill. It has its own cooler, deliberately foreign palette and a dashed "Coral — simulated" banner.
  - Q8: Help is a popover with keyboard shortcuts and the status-badge legend, no tours.
- **Simulator boundary** (enforced by ESLint):
  - `src/simulator/**` and `src/app/(simulator)/**` reach UCOMP only over `/api/v1`, and use only their own `sim_*` tables (`src/server/db/schema/sim.ts`).
  - UCOMP never reads `sim_*`.
  - Coral renders with `X-Consumer-Id: coral`.
- **Phase 4 behavior Sri accepted:**
  - Resubmitting answers (auto-resolves) the change request.
  - Any approver may withdraw a pending revoke.
  - Viewers don't see decision buttons.
  - Dates on the Versions and Activity tabs are UTC days.

## What exists (Phases 1–4)
- **App shell:** personas (switch via the avatar), the demo pill (Reset demo, Advance clock, and a "Consumer simulator" entry marked Phase 5), the Library, the starter gallery.
- **The editor:** variables, required sections, Word paste, comments mechanics.
- **The workspace:** Content (editor + rail), Versions, Usage (placeholder), Activity.
- **Render:**
  - `POST /api/v1/templates/{id}/render`, with the contract in `src/domain/render/types.ts`;
  - PDF (@react-pdf), Web and Email adapters;
  - `render_log`, which never holds values.
- **Lifecycle and review:**
  - submit dialog, review queue and badge, review screen, redline, comments;
  - approve with go-live, request changes, sunset, two-person revoke;
  - audit events, notifications (rows written; a full notifications UI is Phase 6), and consumer notices (rows written; the API to read them is Phase 5).
  - Contracts: `src/domain/review-types.ts`.
- **Placeholders to build out:**
  - `src/app/(product)/[team]/usage/page.tsx` (5 lines) and `…/audit/page.tsx` (5 lines);
  - the settings modal frame (`@modal/(.)settings/[section]`);
  - the integration sheet frame;
  - the demo pill's simulator entry.
- **The seed** (`src/server/seed/*`) already holds about 90 days of render history (around 27k render_log rows), consumers coral and deposits-online, and `sim_*` offers, customers and links. Verify what Phase 5 needs and extend it.
- **Tests:** 1,724 unit tests (`npx vitest run`) and 111 e2e tests. The e2e suite covers:
  - `phase-1`, `navigation`;
  - `scenario-02`, `02a`, `03`, `06`;
  - `api/render`.
  `npx playwright test` builds nothing: run `npx next build` first. It runs `db:reset` and `next start` on :3100 itself.
- **Gate media:** `npm run gate:media` runs every `scenario-NN` spec in the `demo` project (1440 video, cursor, presentation pacing) and the `stills-1280` project. It writes `e2e/__screens__/gate/<spec>.mp4` and stills from `shoot(page, name)` calls in the specs. Helpers live in `e2e/media/demo.ts` and `e2e/helpers/scenario.ts`.

## How to work (what made Phases 3–4 fast; keep doing it)
1. **Contracts first, by you.** Per phase:
   - a types file of the read models, actions and API shapes, with the signatures for every slice;
   - a one-page `docs/phase-N-brief.md` (owners, signatures, routes, gotchas);
   - any schema change and migration.
   Then fan out.
2. **Parallel waves with disjoint file ownership.** Up to about 8–9 agents at once. Always pass an explicit `model`:
   - **Opus:** domain logic, server actions and queries, editor changes, anything subtle (access rules, clock-driven lapses, import conversion).
   - **Sonnet:** UI slices, e2e specs, QA, mocks.
   - **Haiku:** mechanical work (seed generators from a spec, renames).
   - **Never Fable.**
   Every brief includes `docs/agent-brief.md`, `docs/ui-checklist.md` (for UI), the phase brief, and the contract file, plus file ownership and "report back in text".
3. **Taste calls, done autonomously.** Where Sri would have picked from a mock (simulator look, Usage dashboard layout, settings modal sections, integration panel):
   - have one Sonnet agent build a 2–3 variant clickable dev mock under `src/app/(dev)/design/<name>/` with screenshots and a short recording;
   - YOU pick, guided by the memory files, the decisions above, the design reference and the checklist;
   - record the pick, the rejected variants and why in `docs/decisions.md`, with screenshot paths, so Sri can overrule it at review.
   Ask Sri only if a choice is irreversible or contradicts a recorded decision.
4. **QA in the pipeline.** As each UI slice lands, a Sonnet QA agent reviews it against the checklist (report only). Batch the fixes into one or two fix agents, not a long loop at the end.
5. **Keep your own context light.** Screenshots, research and big reads go through subagents, which report in text. Look at a still yourself only when deciding something.
6. **Server and DB hygiene** (learned the hard way):
   - One dev server: `preview_start "ucomp-dev"` (port 3000). Agents never start servers or run pkill, and never `rm` by wildcard in shared folders. Each uses its own scratch subfolder.
   - Agents test on templates they create, and restore any seeded row they change.
   - Specs against the dev server use `E2E_PORT=3000` only after a curl 200. Playwright never starts or resets anything off :3100 (enforced in `playwright.config.ts`).
   - `e2e/navigation.spec.ts` resets the DB itself.
   - Agents mid-edit make the dev server answer 500. Wait and retry; don't work around it.
7. **Gotchas** (full list in `docs/phase-4-brief.md`):
   - Cache Components: request data and the DB only inside `<Stream>`; `now()` not `new Date()` in server components.
   - Hidden routes stay mounted (`<Activity>`).
   - Base UI: the `render` prop (not `asChild`), and dialogs focus a frame after open.
   - Playwright with ProseMirror: human-paced clicks, visible-element locators, wait for `pmViewDesc`.
   - Preview iframes need `test.use({ trace: "off" })`.
   - A placeholder like `@max-[Nrem]` in a code comment generates broken CSS (Tailwind scans comments).

## The phases (scope is in the plan's §9; gates below are the minimum)
**Phase 5, Going live.** Gate: scenarios 4 and 5 end to end, plus scenario 6 re-run with the simulator's send failure.
- Consumer API:
  - `GET /api/v1/templates` (search, Active only);
  - `GET /api/v1/templates/{id}` (metadata + contract);
  - `GET /api/v1/consumers/{id}/notices` (the notices Phase 4 writes).
- The simulator at `/sim`: offers, link and pin, map values, send with a results grid, customer views (phone frame, inbox, PDF), notices, relink with new required variables, exact render errors on failure. Wire the demo pill's simulator entry.
- The Usage dashboard (Flow's Insights layout, `Unknown.png`) and the per-template Usage tab; previews never count.
- The integration panel behind SHARE: ID, Active version, channels, the contract table, copyable JSON Schema, curl/fetch samples, response formats, "What changed since vN", copy buttons.
- Visual QA: the dashboard against Unknown.png; the simulator's "outside system" look.

**Phase 6, Access and admin.** Gate: scenarios 7 and 8.
- Request access (Morgan).
- Settings, Team group: Members, Access requests, Recertification (lapse at the deadline on the demo clock), Inactivity.
- Settings, Platform group: Teams, Content types, Channel rules, Approval chains (add Dana Park's Legal stage, then demo and e2e-test a TWO-stage approval; Phase 4 could only unit-test that).
- The Auditor (all teams, read-only); the Audit page (filters, demo-clock times, CSV if time allows); the notifications UI (unread dot, mark read, every event type); the sidebar cards.
- Opus reviews `domain/access.ts` and the clock-driven lapses.
- Visual QA: the settings modal against Unknown-3.png.

**Phase 7, Import and polish.** Gate: scenarios 1–11.
- Import .docx, .pdf and .txt into a draft. `{{placeholders}}` become Text chips. "Compare with original" shows the source beside the draft. Use the editor's `normalizePastedHtml`, `chipsInJSON` and `ensureBlockIds`; pdfjs-dist's legacy build for PDF text.
- Copy prompt for Copilot: pasting back turns `{{key}}` into chips through the existing paste path.
- The ⌘K palette.
- A full UX pass against the experience principles and the checklist.
- The full demo script as ONE serial Playwright run from a fresh reset (scenarios 1–11), with zero console errors.
- Principle checks on every route: at most one primary button in the canvas, statuses only via `<StatusBadge>`, no placeholder text other than "Type / for blocks", axe clean, CLS 0.
- A final contact sheet of every screen, and a recorded walkthrough of the whole demo script.

**Rough edges carried in from Phases 3–4** (fold these into the right phase):
- Editor typing latency was 2.5ms median vs about 1.5ms in Phase 2 (budget 16ms), measured on a loaded machine. Re-measure quietly; profile and fix if it holds. Sri may already have started this as a separate task: check `git log` first.
- PDF: a heading and its one-line intro can be stranded before a table that moves to the next page (keep-with-next chain).
- Redline "Changes only": a thread on a hidden unchanged block gets no marker.
- Below about 796px wide, the workspace tab bar no longer fits.
- Dev mocks under `src/app/(dev)/design/*` are kept as references; leave them.

## Definition of done, per phase
- `npx tsc --noEmit`, `npx eslint src e2e` and `npx vitest run` all green.
- `npx next build` with no warnings.
- `npx playwright test` all green on the production build.
- `npm run gate:media`.
- A QA pass with no open should-fix items (anything deferred is listed in `docs/decisions.md` with the reason).
- Then commit on `prototype` as "Phase N: <name>" (no attribution lines). Delete stray outputs first: temp scripts, reporter JSON, scratch files. **Never push.**

## Final handoff to Sri (end of Phase 7)
- `npm run db:reset`, stop every server, and leave ports 3000, 3100 and 3200 free.
- `docs/final-review.md`:
  - what was built per phase;
  - how to run it (`npm run demo`, then the demo pill's Reset demo);
  - the scenario walkthrough (the demo script, with what to look for);
  - every autonomous decision with links to its mock screenshots (from `docs/decisions.md`);
  - known rough edges;
  - test counts.
- Send Sri (SendUserFile) the full demo-script recording, the contact sheet, and a handful of key stills at 1440 and 1280, with a short summary.
- While you work, post a one-line status note at each phase boundary. Sri may be away; keep them short.
