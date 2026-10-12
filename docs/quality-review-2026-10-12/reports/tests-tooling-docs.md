# Review: tests, tooling, docs (slice `tests-tooling-docs`)

Repo: `/Users/happy/Documents/CodeProjects/prototypes/cms-platform` @ `0cca665` (main), reviewed 2026-10-12.
Evidence tags: `measured` (I ran it), `verified` (I read the code), `traced` (followed, not run).

## 1. Summary

The test system is the strongest part of this slice and genuinely unusual for a prototype: 285 Vitest files, 5,283 tests, 19.4 s wall time, every test shuffled with a replayable seed, every database-backed test on its own copy of a seeded SQLite file, golden files that double as the acceptance test for the future Java render engine, and 50 Playwright specs (220 tests) that include a "principles" matrix checking every screen as every persona for one-primary-button, status-badge-only, no-placeholder, axe and CLS 0. Waits are web-first (1,407 `getBy*` locators against 517 `.locator(`; only 4 `waitForTimeout` outside the opt-in recording code), `retries: 0`, and a console-error fixture fails any test that logs an error. The tooling that enforces architecture (`eslint.config.mjs`) and doc integrity (`scripts/docs-check.ts`) is excellent and fast (lint 10 s, tsc 2 s, docs:check 0.3 s).

The gaps are the ones the backlog already names and a few it does not. There is still no CI, no Node pin, no `.env.example`, no coverage tool, no formatter config, and runtime paths still assume the dev machine (`process.cwd()/node_modules` for PDF fonts). The repo ships 286 vendored agent-skill files (36k lines) and 14 tracked symlinks that a Windows checkout will mangle. Unit tests and e2e assertions are bound to SQLite (36 of 50 spec files run raw SQL), so the test suite does not survive the planned Java backend swap without a contract-test layer.

The documentation is extensive (9,468 lines under `docs/`, 3,347 lines of layer READMEs), co-located, link-checked, and the decision records are the best I have seen in a prototype. But it is written for an agent that reads everything, not a human who reads one page: single bullets of 3,692 characters, table cells of 1,700 characters, and no onboarding path for someone who has never used the App Router. Eight concrete claims are stale, one of them a direct contradiction (the components README says `npm run e2e` resets the demo database; AGENTS.md and decision 0050 say it never touches it). History still leaks into reference docs (six "Changes since Phase N" sections in the editor README).

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 6 | Readability for humans | 6 | Code comments are behavior-first and dense; docs prose is accurate but written in 1,000–3,700-character blocks a newcomer cannot scan; three e2e files exceed 1,000 lines. |
| 7 | Test quality | 8 | Fast, deterministic (seeded shuffle, DB per test), meaningful (goldens, parity, principles matrix, console-error fixture); gaps: no coverage tool, some server modules reached only via e2e, SQLite-bound assertions, one 7.9 s test is 40% of the unit run. |
| 8 | Documentation | 7 | True in the large and link-checked; decisions exemplary; but 8 stale claims (one contradiction), history in reference docs, no newcomer path, no e2e or scripts README. |
| 10 | Tooling & DX | 6 | Three-command setup and sub-20 s checks with lint-enforced architecture; but no CI, no Node pin, no `.env.example`, no formatter, dev-machine paths, POSIX-only npm scripts, vendored skills and symlinks in the tree. |
| 11 | Handoff readiness (this slice) | 6 | Goldens, refusal codes and decision records port cleanly; the unit and e2e suites are SQLite-bound and the docs assume Next.js fluency; a Java team gets a spec but not a portable test harness. |

## 3. Strengths

- **Deterministic, isolated unit tests.** `vitest.config.mts` shuffles tests within each file (`sequence.shuffle.tests: true`) and `scripts/seed-reporter.ts` reprints the seed with the replay command on failure. Decision 0048 and `src/lib/fresh-database.ts` give every DB-backed test a clone of one seeded file; `src/server/README.md:246` forbids story-shaped files. `measured`: 285 files, 5,283 passed, 1 skipped, 19.40 s; no `.only` anywhere.
- **Golden files as a cross-engine contract.** `src/server/render/golden/` splits `expected/` (engine-neutral, what Java must reproduce) from `node/` (font-dependent). `golden.test.ts` (180 tests), `parity.test.ts` (300), `parity-detects.test.ts` (plants defects) and `determinism.test.ts` (fresh Node processes, either order) cover the engine from four angles. `verified`.
- **The e2e helpers are a pleasure to read.** `e2e/helpers/settled.ts` (57 lines) replaces sleeps with an RAF-polled "8 still frames, fonts loaded, no finite animation running" check and documents its one limitation. `e2e/helpers/principles.ts` holds the five screen rules and the route-by-persona matrix in one place; `describeRoutes` generates tests from it. `e2e/storage.ts` (46 lines) is the one place worker ports, DB files and upload folders are derived. `verified`.
- **Flakiness hygiene.** `playwright.config.ts`: `retries: 0`, `trace: "retain-on-failure"`, `reportSlowTests` at 60 s, `reuseExistingServer: !process.env.CI`. `measured`: 13 `waitForTimeout` total, 9 in `e2e/media|qa|perf` (recording and probes), 4 in specs (two in `demo-script.spec.ts`, demo project only; two in `phase-1.spec.ts:996,1015` as the stated 3-second prefetch counting window). 58 `toPass`/`expect.poll` uses. The `problems` auto-fixture in `e2e/helpers/scenario.ts:22-37` fails a test on any console error or page error.
- **Lint enforces the architecture, with messages that teach.** `eslint.config.mjs` has nine `no-restricted-imports` blocks (domain purity, editor isolation, simulator fence, server/components ban, contracts no-imports) plus a `no-restricted-syntax` rule confining `"use server"` to `src/server/actions/`. `EDITOR_PUBLIC_MODULES` (28 entries) matches the editor README's Public API table exactly. `measured`: `npx eslint .` clean in 10.1 s.
- **`scripts/docs-check.ts`** checks 74 Markdown files, 1,428 links, 753 backticked paths and 92 `docs/` references in code comments in 0.27 s, against `git ls-files` rather than the disk so a gitignored local file cannot make it pass. `measured`.
- **Decision records.** 49 records with Context / Decision / Alternatives considered / Consequences, and dated "Amended" lines instead of rewrites (0013, 0025, 0029). 0043 (split by concern, not line count), 0048 (DB per test) and 0050 (server per e2e worker) each give measured numbers and the rejected alternatives. `verified`.
- **Commit hygiene.** 273 commits, 87 merges, median subject 67 characters, imperative and specific ("Give every refusal a stable code and branch on it (I11)"), finding ids cited; largest blob in history is a 1.4 MB webm, `.git` is 23 MB. `measured`.
- **`docs/handoff-review.md` as a living backlog.** 111 findings with a Status line each; every Fixed status I spot-checked in this slice was true (section 5).

## 4. Findings (by severity)

### High

**H1. No CI, Node pin or environment template (T4, still open).** `measured`. No `.github/`, no `.nvmrc`, no `engines` in `package.json`, no `.env.example` (and `.gitignore:36` `.env*` would swallow one). Env vars in use (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `UPLOADS_DIR`, `UCOMP_API_ORIGIN`, `PORT`, `E2E_*`) are documented only in prose (`docs/architecture.md:217-218`). Consequence: whether `main` is green is unknown from the repo (T1 found it red before). Fix: see "What a minimal pipeline needs" below; one workflow file, `.nvmrc` = 24, `engines.node >= 24`, `.env.example` with `!.env.example` in `.gitignore`.

**H2. The docs contradict each other on whether e2e touches the demo database.** `verified`. `src/components/README.md:396-397`: "On the default port, `npm run e2e` runs `npm run db:reset` before starting the server, which resets the shared demo database." AGENTS.md:26, `docs/architecture.md:239-244`, decision 0050 and `e2e/storage.ts` say the opposite (own `data/e2e-<n>.db`). A newcomer reading the components README will either avoid the suite or distrust the other docs. Fix: delete the sentence; point at decision 0050.

**H3. The test suites are bound to SQLite and will not survive the Java swap.** `verified`. All 45 `src/server/**/*.test.ts` and the 11 `src/server/queries/*.test.ts` run against a real libSQL file; 36 of 50 e2e spec files read or write raw SQL through `openDb()`/`rowsOf()`/`rows()` (`e2e/helpers/golive.ts` 39 statements, `scenario-03.spec.ts` 37, `scenario-06` 21, `phase-6-two-stage` 18, `sunset-passed` 17, `sunset-zone` 14). When `src/server` becomes a BFF over Spring Boot, the server unit tests and the e2e assertions need a different seam (the owner's "mock the data layer" note and B1 agree). Fix: before the port, introduce a repository/service interface in `src/server` (B1), write the e2e state assertions through `/api/v1` and the admin screens where possible, and keep the raw-SQL ones behind one helper so they can be swapped for JDBC checks.

### Medium

**M1. Runtime paths assume the dev machine (T8, still open).** `verified`. `src/server/render/channels/pdf-fonts.ts:47-59` joins `process.cwd()` to `node_modules/pdfjs-dist/standard_fonts/...` and `node_modules/@expo-google-fonts/newsreader/...`; `src/server/import/store.ts:25` resolves uploads from `process.cwd()`; `scripts/db-migrate.ts` runs under `tsx` (a devDependency) with `--conditions=react-server`. All three break in a standard container or Azure App Service. Fix: copy the eight font files into a fonts folder under src/server/render/channels (or `public/`), read `UPLOADS_DIR` as an absolute path with a required value in production, and compile or replace the migration script.

**M2. No coverage tooling; several server modules are reached only indirectly (T9, still open).** `measured`. No `@vitest/coverage-*` in `package.json`. Modules with no sibling test and not imported by any test file: `src/server/api/render-http.ts` (160 lines; e2e `api/render.spec.ts` only), `src/server/import/dom.ts`, `import/store.ts`, `import/isolate.ts` (worker isolation, 256 MB heap, 30 s timeout: untested at unit level), `src/server/actions/persona.ts`, `src/server/queries/personas.ts`, `src/server/render/channels/html.ts` and `pdf-text.ts` (covered via golden/pdf tests). `src/simulator/queries.ts` (525 lines) is imported by 2 test files. Domain coverage is complete: the 25 untested domain files are all `*-types.ts`, `fixtures.ts`, `refusals.ts` tables or 9-line helpers. Fix: add `@vitest/coverage-v8` with a threshold on `src/domain` and `src/server`, and unit tests for `render-http.ts` and `isolate.ts`'s timeout path.

**M3. Eight stale documentation claims.** `verified`/`measured`. `docs:check` cannot see these (it checks paths, not statements):

| Claim | Where | Reality |
| --- | --- | --- |
| "`npm test` … about 10 seconds" | AGENTS.md:22, architecture.md:236 | 19.4 s measured |
| "About 4.5 minutes (11 with one worker)" | AGENTS.md:26, architecture.md:244 | decision 0050:46-47 and commit a85c340 say 3.0 minutes |
| `save-status.tsx` imports `@/editor/lib/platform`, "which is not in the editor's public API" | components/README.md:355 | `lib/platform` is row 48 of the Public API table and in `EDITOR_PUBLIC_MODULES` |
| "runs this layer's 75 files" | components/README.md:378 | 109 test files under `src/components`, `src/lib`, `src/hooks` |
| `npm run e2e` "resets the shared demo database" | components/README.md:396-397 | contradicted by decision 0050 (H2) |
| Channel fields: "today only Email's subject and preheader" | server/README.md:137 | Push (title, subtitle, body) and SMS (text) fields exist (decision 0034, `src/domain/channel-fields.ts`) |
| Platform sections: `teams`, `content-types`, `channel-rules`, `approval-chains` | app/README.md:66 | `time-zone` is a fifth (`src/components/settings/sections.ts:49`, `e2e/helpers/principles.ts:357`) |
| `scripts`: "`db:migrate`, `db:reset`, `docs:check`"; `src/lib`: "`cn` and the SQLite write lock" | architecture.md:26,28 | also `golden-import.ts`, `unicode-graphemes.ts`, `seed-reporter.ts`; also `fresh-database.ts`, `template-reads.ts` |

Also minor: server/README.md:8 says only `scripts/db-migrate.ts` and route tests import the db client outside `src/server`; `src/lib/fresh-database.ts` and `scripts/golden-import.ts` do too. "About 40 files" (architecture.md:56) is 46. The H6 count "382 `text-[Npx]`" is now 410.

**M4. History leaks into reference docs.** `measured`: 31 "Phase N" mentions outside `docs/archive/`. `src/editor/README.md` opens with "Status: Phase 2 complete, ready to lift; Phase 4 adds…" (line 8), titles its API "Public API (frozen for Phase 2)" (line 24), and carries six changelog sections "Changes since Phase 1/2/3/4/7a" and "Changes for the message composer" (lines 521-642, about 120 lines) that describe deltas against versions nobody will ever see. `docs/reference/ui-checklist.md:3` "Distilled from the Phase 3 visual QA". `src/server/seed/people.ts:5` cites `docs/archive/agent-brief.md` for persona ids. e2e headers: "Phase 7 principle checks" (`principles.ts:6`), "Phase 2 gate" (`scenario-02a.spec.ts:30`), "Phase 1 gate" (`phase-1.spec.ts:1`). Fix: fold the editor changelog into the current description (or move it to a decision), drop "Phase" from headings, and let `docs/README.md:37`'s own rule ("Don't explain through history") apply to the READMEs.

**M5. No onboarding path for a Java developer new to the App Router.** `verified`. The reading order exists (README → architecture.md → layer README) and the domain Vocabulary (`src/domain/README.md:74-108`) is a good product glossary. Missing: any explanation of the Next.js mental model a newcomer needs before `src/app/README.md:19-40` makes sense (what a server component is, why `"use server"` makes a public endpoint, what hydration and streaming are, why `cookies()` outside Suspense is a build error, what `cache()` and `connection()` do). AGENTS.md's answer is "Read the guide in `node_modules/next/dist/docs/`" (about 100 files). There is no "your first change" walkthrough, no troubleshooting (locked keychain, `db:reset` after clone is the only one, in README.md), no a README in e2e or a README in scripts (docs:check requires READMEs only under `src/`), and no "how to debug a server action" (zero hits for debug/inspect in the docs). The vendored `.agents/skills/next-cache-components/SKILL.md` is close to the primer a human needs but is filed as agent tooling. Fix: a 2-page a newcomer guide under docs/guides (ten terms, two diagrams, one request traced), an a README in e2e, and a "first change" guide that adds a field end to end.

**M6. Prose density.** `measured`. Longest single lines: `src/server/README.md:198` is one bullet of 3,692 characters (render stages, preview route, PDF fonts, log, both callers, `assertNever`); `src/components/README.md:63` is a table cell of 1,705 characters (the `review/` folder); `src/domain/README.md:48` a cell of 1,003 characters; `src/components/README.md:235-263` is one 29-line paragraph on the session store. The voice is accurate and never padded, but it is optimized for grep, not for reading. Three passages that are hard to parse:

> "On the review screen, a bare link opens the head, except for a stage reviewer outside the team who can't open it: `requireReviewVersion` gives them the newest round of that number they may open, the one they decided. A sent-back round's screen (`getReviewScreen`) carries `replacedBy`, the head its work went on to, only when the viewer may open it (`opensRound`, the same rule)." (`src/server/README.md:36`, inside a table cell)

> "`review-workspace.tsx` only lays the screen out; each kind of client state has a hook: `use-review-view.ts` (which view, `previewVisited`, the Preview's channels), `use-review-changes.ts`, `use-preview-sets.ts`, `use-review-comments.ts`, `use-review-decision.ts` (Approve, Request changes and their dialogs' props), `use-viewed-outputs.ts` (the outputs the approver has had on screen in the Preview, per viewer, version and round, kept in sessionStorage) and `use-go-live.ts`." (`src/components/README.md:63`)

> "Round · One submission of a version for review: a row with `number` and `round`, frozen at submit. A send-back doesn't use up a number: the next submission is the next round of the same number, and the version that goes live is still "v1". Labels show the round only once the number was sent back ("v1 · Round 2", "v1, round 2"); a released version is "vN", and its review history names the round it was approved on." (`src/domain/README.md:80`)

Three that are excellent:

> The numbered six steps at the top of `src/server/actions/kit.ts:12-34` ("1. `getViewer()`. 2. The input, parsed with zod … 5. `transaction`: ONE `inTransaction`, retried when SQLite is busy. Re-read, ask the domain, write with a compare-and-set…").

> `e2e/helpers/settled.ts:3-17`: "Settled means all of these, read on every animation frame: web fonts are loaded; no finite animation … is running (an endless one, such as a spinner, is ignored: it never ends); the size of the page and the box of every element are the same as on the last `STILL_FRAMES` frames. It does not wait for anything to appear."

> Decision 0043: "A file is split when it mixes concerns a reader has to tell apart, not because it passes a line count. The test is whether one sentence says what the file holds."

Fix: a hard cap of about 600 characters per bullet or cell; move the long explanations into subsections with headings; keep the tables for the map only.

**M7. Vendored agent skills and tracked symlinks in the tree.** `measured`. `.agents/` holds 286 tracked files, 36,358 lines, 2.1 MB, reinstallable from `skills-lock.json`; `.claude/skills/*` are 14 tracked symlinks (git mode 120000) into `.agents/`. On a Windows checkout without symlink support they become one-line text files; on every machine they inflate search results (both are excluded from lint, tsc and docs:check, so they are already treated as foreign). Fix: stop tracking `.agents/` and `.claude/skills/` (keep `skills-lock.json`), or document in README.md that they are agent tooling and add `core.symlinks` guidance.

**M8. No code formatter.** `measured`. No `.prettierrc`, `biome.json` or `.editorconfig`; `prettier` is not a dependency; ESLint runs `core-web-vitals` and `typescript` only, with no stylistic rules. Lines run to 160+ characters (e.g. `e2e/helpers/principles.ts:169`). Formatting consistency today comes from one author; with a team it drifts in the first week and every PR carries whitespace diffs. Fix: add Prettier (or Biome) with `printWidth` matching the current style and a format check in CI.

**M9. Three e2e files over 1,000 lines and long per-test timeouts.** `measured`. `e2e/demo-script.spec.ts` 1,356 lines (demo project only), `e2e/phase-1.spec.ts` 1,019, `e2e/scenario-03.spec.ts` 1,002, `e2e/api/render.spec.ts` 916. `test.setTimeout` is raised to 150–180 s in `navigation.spec.ts:166-457` (seven tests), `scenario-03.spec.ts:302` (240 s), `phase-6-two-stage.spec.ts:185` (300 s). With `fullyParallel: false` a file is a story: one failure cascades to the rest of the file, and the longest file bounds the run (decision 0050:48). Fix: split `phase-1.spec.ts` by screen (as `principles.spec.ts` was) and make each `navigation` test independent so its timeout can fall back to the default.

**M10. POSIX-only npm scripts and documented commands.** `verified`. `package.json:14` `"golden:update": "GOLDEN_UPDATE=1 vitest run …"` and every documented `E2E_WORKERS=1 …`, `E2E_PORT=3000 …` prefix fail in cmd.exe and PowerShell. A Java team is likelier than most to be on Windows. Fix: `cross-env` in the scripts and a note in README.md on PowerShell syntax.

### Low

**L1. `npm audit`: 16 vulnerabilities (9 high, 7 moderate), all but one in dev tooling.** `measured`. shadcn CLI (`fast-glob`/`braces`/`ts-morph`), `eslint-config-next` (`fast-glob`), `drizzle-kit` (`esbuild`). The production one is `mammoth` (moderate, `sprintf-js` DoS via `argparse`), whose only "fix" is a downgrade to 0.3.29. `npm audit --omit=dev` in CI with an allowlist for `mammoth` is the honest state.

**L2. Dependency oddities.** `verified`. `@types/node ^26.6.4` while the machine runs Node 24.21 and there is no `engines` field; `tsconfig.json` targets ES2017; `next-themes@0.4.6` is extraneous in `node_modules` (not in `package.json`; a stale install, not a lockfile problem). `cn` (28 imports via `src/lib/utils.ts`) is the base-nova style's choice and there is no `clsx`/`tailwind-merge` duplication. `happy-dom` belongs in `dependencies`: `src/server/import/dom.ts` and `src/server/render/golden/content.ts` use it at runtime.

**L3. `public/` still holds the five create-next-app SVGs** (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`); nothing in `src`, `e2e` or `docs` references them. `measured`.

**L4. Decision numbering skips 0040** (0039 then 0041 in `docs/decisions/README.md`; no file). `measured`. Harmless, but a reader will look for it.

**L5. Build-era scripts without a home.** `verified`. `e2e/qa/capture-phase-1.mjs`, `walkthrough-phase-1.mjs` and `prefetch-probe.mjs` (no header comment) are Phase-1 QA tools referenced only from `docs/archive/`. `scripts/unicode-graphemes.ts` is well documented but absent from the `scripts` row of `architecture.md:28`.

**L6. One test is 40% of the unit run.** `measured`. `src/domain/messages/graphemes.test.ts` "agrees with this runtime's Intl.Segmenter on every code point" takes 7.86 s of 19.40 s. It is valuable (Unicode conformance) but could run behind an env flag or as its own script, bringing `npm test` to about 12 s.

**L7. Agent-workflow assumptions in the test infrastructure.** `verified`. `e2e/helpers/principles.ts:209-216` retries `page.goto` four times over 30 s because "another agent may be mid-edit"; `e2e/helpers/access.ts:131-133` says the database "is shared with whatever else has it open (… a dev server on the same worktree)". With one server per worker (0050) these retries now mask real 5xx responses. Fix: one attempt, fail on `>= 500`.

**L8. Three git author identities.** `measured`. `Happy <happy@Happys-Mac-Mini.local>` 126 commits, the GitHub noreply identity 121, the gmail identity 26. `.mailmap` or a rewrite before handoff.

**L9. Reference images remain in history** (G4 "Partly fixed" is accurate). `measured`. `reference-images/Unknown-2.png` (889 KB) and `Unknown-3.png` (453 KB) were added in `26cab98` and later removed; they are still in the pack. Decide before the repo moves to the enterprise.

### What a minimal pipeline needs (GitHub Actions or Azure DevOps)

Steps and measured or documented timings on this machine (12 cores): `npm ci` (~1 min, cacheable); `npx playwright install --with-deps chromium` (~1 min, cacheable); `npm run typecheck` (`next typegen` + tsc; tsc alone 1.8 s warm); `npm run lint` (10 s); `npm run docs:check` (0.3 s); `npm test` (19 s here; expect 40–60 s on a 2-core runner because 285 isolated workers spawn); `npm audit --omit=dev`; `npm run build` (not run here; the docs give no number; expect 1–3 min); `npm run e2e` (3.0 min at 4 workers per decision 0050, which also says four workers want ~3 GB and four cores, so a 2-core hosted runner needs `E2E_WORKERS=2` and about 5–6 min; a 4-core runner keeps 3–4 min). Total about 8–12 minutes. The config is already CI-aware (`reuseExistingServer: !process.env.CI`, `trace: retain-on-failure`). Needed additions: `.nvmrc`/`engines`, upload `test-results/` on failure, create nothing else (`db:reset` creates `data/`). Run the `demo` project nightly, not per PR (decision 0049).

## 5. Backlog check (docs/handoff-review.md, this slice)

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| T1 main fails e2e | Fixed | Not verifiable here (no e2e run); the undo/redo render fix is in `save-status.tsx` per decision 0003 | traced |
| T2 lint fails on clean checkout | Fixed | Yes: `eslint.config.mjs:197` ignores `.agents/**`, `.claude/**`; `npx eslint .` clean | measured |
| T3 DB tests depend on order | Fixed | Yes: `vitest.config.mts` shuffle, `src/lib/fresh-database.ts`, 5,283 pass shuffled | measured |
| T4 No CI / Node pin / .env.example | Open | Yes, still open | measured |
| T5 E2E can't use own DB | Fixed | Yes: `e2e/storage.ts`, `playwright.config.ts` webServer env | verified |
| T6 shadcn runtime dep | Fixed | Yes: `shadcn` in devDependencies, `next-themes` not in `package.json` | verified |
| T7 slow/brittle test habits | Fixed | Yes: 4 `waitForTimeout` in specs, exactly the exceptions the status names; 21 files use fake timers | measured |
| T8 runtime paths assume dev machine | Open | Yes, still open (`pdf-fonts.ts:47-59`, `store.ts:25`) | verified |
| T9 no coverage tooling | Open | Yes, still open | measured |
| G1, G2, G3 (AGENTS.md, implementation plan, agent brief) | Fixed | Yes: AGENTS.md rewritten, both docs archived with banner | verified |
| G4 build-process docs/artifacts | Partly fixed | Yes: `.claude/launch.json` gone; `docs/decisions/media` is 28 files / 7.5 MB, all cited; reference images remain in history | measured |
| G5 editor API enforced only in prose | Fixed | Yes: `EDITOR_PUBLIC_MODULES` matches the README table (28 = 28) | verified |
| N2 failed demo-script leaves state | Fixed | Yes: `demo-script.spec.ts` has 4 `afterAll` including `resetDemoData` | verified |
| N20 five flaky specs | Fixed | Not measurable here; the named waits are present in `scenario-02a`, `scenario-08`, `focus-targets` | traced |
| N21 superseded decision lines | Fixed | Yes: "Amended 2026-10-11" lines in 0013, 0025, 0029 | verified |

New, not in the backlog: H2 (docs contradiction on e2e and the demo DB), M3 (stale claims), M7 (vendored skills and symlinks), M8 (no formatter), M10 (POSIX-only scripts), L3, L4, L6, L7.

## 6. For the Java team

**Ports cleanly:** the golden files (`src/server/render/golden/cases/*/expected/` are the Java engine's acceptance test, and the README says how to run them from Java); refusal codes as the contract (decision 0025, `src/domain/refusals.ts`); the decision records (read 0033, 0034, 0017, 0006 for the data semantics); `src/contracts/README.md` as the API description until OpenAPI exists; the documentation discipline (`docs:check`, README beside each module) which any language can keep; the e2e principles matrix, which tests the UI they keep.

**Needs rethinking:** every `src/server` unit test and 36 e2e specs assert against SQLite (H3); `npm run db:reset`/`db:migrate` and seed are TypeScript over Drizzle (the Java side needs Flyway/Liquibase and a seed of its own, and the e2e `resetDemoData()` must call an API, not `npm run db:reset`); the demo clock (`settings.clock_offset_days`) is read by every test and e2e flow, so the Java API needs the same offset or the e2e suite loses its time-travel; runtime paths (M1); the absence of CI (H1).

**Read first (in order):** `AGENTS.md`; `docs/architecture.md`; `src/server/README.md` "Anatomy of a mutation" (lines 54-107) with `src/server/actions/kit.ts`; `src/server/render/golden/README.md`; `e2e/helpers/principles.ts` (the route and persona matrix doubles as a map of the product).

## 7. Files that are models of good code in this slice

- `scripts/docs-check.ts` — one screen of header says exactly what fails; checks against `git ls-files`; 0.3 s.
- `e2e/helpers/settled.ts` — 57 lines, one idea, limitations documented.
- `e2e/storage.ts` — the single source of worker port, DB and uploads folder.
- `src/server/actions/kit.ts` — the numbered header is the best explanation of the server rules in the repo.
- `vitest.config.mts` with `scripts/seed-reporter.ts` — deterministic shuffle with replay, in 20 lines.
- `eslint.config.mjs` — architecture as lint, each rule with a message that says where the thing should go instead.
- decision 0043, `0048`, `0050` — measured numbers, rejected alternatives, consequences.

**Files a human will struggle with**

- `src/server/README.md` (274 lines, but line 198 alone is 3,692 characters; line 36 is a 1,100-character table cell).
- `src/components/README.md` (397 lines; the `review/` cell at line 63 and the 29-line session paragraph at 235-263).
- `src/editor/README.md` (690 lines; 120 lines of phase changelog; "frozen for Phase 2" headings).
- `e2e/demo-script.spec.ts` (1,356 lines), `e2e/phase-1.spec.ts` (1,019), `e2e/scenario-03.spec.ts` (1,002): story-shaped files whose later tests depend on earlier ones.
- `playwright.config.ts` — parses `process.argv` for `--project` and `--workers` at module load to decide worker count and opt-in projects; clever, and the kind of thing a newcomer edits wrong.
- `docs/handoff-review.md` (1,083 lines) is fine as a backlog but a newcomer should be told not to read it end to end.
