# To do before the handoff

Items from the [October 12 quality review](docs/quality-review-2026-10-12.md), organized for parallel agents. Item
numbers are stable ids: 1 to 9 follow the review's "Recommended order of work" (section 9) and the owner's notes on
it; 10 to 12 were added after. The goal is a production-grade core application with no rework: anything that needs
enterprise context (the pipeline, the OpenAPI spec, the Java API's design) is noted for the handoff package instead
of being done here. Each lane is sized for one agent and one PR; "Owns" names the files it may touch, and lanes in
one wave own disjoint files.

## Execution plan

Four waves. A wave starts when the previous one is merged to main. Lanes inside a wave run at the same time.

| Wave | Lanes (parallel)                                                                                                       | Items                            | Waits for                              | Wall clock                            | Long pole                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| 0    | one agent, alone                                                                                                       | 1 Prettier                       | nothing                                | 1 hour                                | the formatting PR must merge before anything else branches  |
| 1    | A bugs · B decisions · C demo flag · D Windows and pins · E goldens                                                    | 4, 8, 10, 11, corpus gaps        | wave 0                                 | half a day to a day                   | B, which needs the owner in the room                        |
| 2    | F seam (2a then 2b fan-out) · G components splits · H editor splits · I render splits · K seed split · J OpenAPI brief | 3, 5, 6                          | wave 1 (F and J need B's decisions)    | 2 to 3 days                           | F: one design day, one fan-out day, half a day to integrate |
| 3    | L1 to L7 docs sweep, one per README · M newcomer docs                                                                  | 2, 9                             | wave 2 (they describe the final shape) | half a day to a day                   | none; all lanes are small                                   |
| 4    | one agent plus the owner                                                                                               | 12 handoff package, repo hygiene | wave 3                                 | half a day plus the external write-up | the Docsor side                                             |

About five to six working days end to end. The owner's time concentrates in wave 1 lane B (the decisions session),
the merge of each wave, and wave 4.

### Dependencies

- Item 1 → everything (one formatting PR, or every later PR carries whitespace noise).
- Item 4 → item 3: they touch the same server files; the small one lands first.
- Item 8 → item 3's HTTP side and item 6: two decisions change Node code (team id = slug; sentences or facts in
  notifications), and the brief needs the error-shape and consumer-identity answers.
- Item 3 → the server-query splits of item 5 (`usage.ts`, `review-shared.ts`, `review.ts`), which happen inside
  lane F's query fan-out rather than beside it.
- Item 3 and item 5 → items 2 and 9 (the docs describe what the code looks like after the splits).
- Items 10 and 11 → nothing; they go in wave 1 because they are small and independent.
- Everything → item 12.

### File ownership by lane

| Lane                   | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Does not touch                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| A (item 4)             | `src/lib/serialized-writes.ts`, `src/server/effects.ts`, `src/server/drafts/apply-patch.ts`, `src/server/import/create.ts`, `src/server/queries/access.ts`, `queries/platform.ts`, `queries/audit.ts`, `queries/spaces.ts` (a shared `requireCan`), `src/editor/paste/markdown.ts`, `next.config.ts` (headers), `src/app/api/v1/consumers/[consumerId]/notices/route.ts`, `src/app/api/templates/[templateId]/preview/route.ts`, `src/server/render/render-template.ts` (no log row for `unknown_consumer`), their tests | `package.json`, `src/server/actions/*`                                                      |
| B (item 8)             | `docs/decisions/` (new records 0051 upward, taken at final rebase), `docs/architecture.md` "Data" (links only)                                                                                                                                                                                                                                                                                                                                                                                                           | any code                                                                                    |
| C (item 10)            | a new config module under src/server (`DEMO_MODE`), `src/server/actions/demo.ts`, `actions/persona.ts`, `src/server/reset.ts`, `src/components/demo/`, their tests, the server README's "Demo-only paths"                                                                                                                                                                                                                                                                                                                | `effects.ts`, `viewer.ts`, `clock.ts` (lane F extends the config module later)              |
| D (item 11, pins)      | `package.json` (`cross-env`, exact pins for `@react-pdf/renderer` and `pdfjs-dist`, a `pretypecheck`), `package-lock.json`, `README.md`, path handling in `src/server/import/store.ts`, `src/server/render/channels/pdf-fonts.ts`, `e2e/storage.ts`                                                                                                                                                                                                                                                                      | source outside those three path sites; `.claude/skills/` and `.agents/` (they stay tracked) |
| E (corpus gaps)        | `src/server/render/golden/focused-cases.ts`, `golden/cases/`, `golden/README.md`, `docs/render-spec.md` §13 case count                                                                                                                                                                                                                                                                                                                                                                                                   | the adapters                                                                                |
| F (item 3)             | `src/server/**` except `render/`, `db/schema`, `seed/`; `src/lib/fresh-database.ts`; `src/app/api/**` as callers; server tests; `src/server/README.md`; `docs/architecture.md` "How requests flow"                                                                                                                                                                                                                                                                                                                       | `src/components/**`, `src/editor/**`, `src/domain/**` beyond type moves agreed in 2a        |
| G (item 5, components) | `src/components/workspace/content/content-workspace.tsx`, `comments/thread-list.tsx`, `workspace/content/rail.tsx`, new hooks beside them, tests for `preview/pdf/pdf-controller.ts` and `settings/platform/approval-chains.tsx`, `src/components/README.md` "Layout" rows for those files                                                                                                                                                                                                                               | `src/server/**`                                                                             |
| H (item 5, editor)     | `src/editor/components/block-menu.tsx`, `components/document-editor.tsx`, new files beside them, `src/editor/README.md` "Files"                                                                                                                                                                                                                                                                                                                                                                                          | `src/editor/model/**`                                                                       |
| I (item 5, render)     | `src/server/render/golden/content-*.ts` and `diff.ts` (was `content.ts`, split), `src/server/render/channels/pdf-text.ts` (`breakLines`), `golden/README.md`                                                                                                                                                                                                                                                                                                                                                             | `focused-cases.ts` and `cases/` (lane E is merged first)                                    |
| K (item 5, seed)       | `src/server/seed/templates/build.ts` and new emitters beside it, `seed.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          | anything else under `src/server`                                                            |
| J (item 6)             | a new brief under `docs/reference/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | code                                                                                        |
| L1 to L7 (item 2)      | one README each (`src/app`, `src/components`, `src/domain`, `src/editor`, `src/server`, `src/simulator`, `src/contracts`), plus the "Phase N" and build-history comments in that layer's code, plus that README's "how to read a file here" paragraph from item 9; L7 also owns `docs/architecture.md`, `docs/render-spec.md`, `AGENTS.md`, `docs/README.md`, `docs/reference/ui-checklist.md`                                                                                                                           | another lane's README                                                                       |
| M (item 9)             | new files only: the Next.js primer and the first-change guide under `docs/guides/`, a README in `e2e/`, the idioms list                                                                                                                                                                                                                                                                                                                                                                                                  | existing READMEs (lanes L)                                                                  |

### Rules for the agents (from the October batches)

- Fetch first; branch every worktree from `origin/main`. The owner's checkout carries an uncommitted
  `next.config.ts`; leave it.
- Numbered files collide: a decision record takes the next free number on `origin/main` at its final rebase. No
  migration is expected in this plan; a schema change waits for the Java side, and if one is unavoidable it is one
  lane's alone.
- Stage only your own paths by name. Never `git stash`, never a discard command: the stash is shared across
  worktrees. Each agent gets its own scratchpad subfolder.
- Every PR runs typecheck, lint, test, docs:check and build (after wave 0, `prettier --check` too), plus the e2e
  specs for the screens it touched. The full e2e suite runs once per wave on the integration branch, not per PR;
  at most three e2e runs at once on the Mac mini or timing specs flake. Read pass or fail from Playwright's summary
  line and `test-results/.last-run.json`, never from `$?` after a pipe.
- Agents cannot run `npm run db:reset` in auto mode; the orchestrator seeds each worktree (`db:migrate` is enough
  for `npm run build`). Lane agents push branches and open no PRs.
- Land a wave through one integration branch with a merge commit per lane branch, conflicts resolved keeping both
  sides, one full e2e, one PR; the owner reads it and says when to merge (a merge commit, never a squash). Edit an
  accepted decision record with an "Amended YYYY-MM-DD:" line, never a rewrite.
- Model mix: the orchestrator picks per lane (Haiku for lookups, Sonnet for well-scoped changes, Opus for design,
  concurrency, security and review), never Fable; one adversarial reviewer on each wave's integration PR, since the
  big PRs in October each hid a real Medium bug.

## Wave 0

### Item 1. Prettier, default configuration

- [x] Add Prettier as a dev dependency, run it with the default configuration (`--config=empty`, no project
      overrides), commit the result as one formatting-only PR, and add `prettier --check` to the checks in AGENTS.md.
      (wave 0, PR #76)
- Why: there is no formatter today, and formatting consistency comes from one author. With a team it drifts in a week
  and every PR carries whitespace diffs.
- Start at: `package.json` scripts; AGENTS.md "Commands" table; expect a large diff in `e2e/` and `src/components/`
  where lines run past 160 characters.

## Wave 1

### Item 4. The four Medium bugs (lane A)

- [x] M-1: two retry layers compound to a worst case of about 90 s (`src/lib/serialized-writes.ts:29`,
      `src/server/effects.ts:301-310`, the copy in `src/server/drafts/apply-patch.ts:68-77`). One place waits and
      fails fast; delete the copy; document the worst case. (wave 1)
- [x] M-2: import throws a 500 where it should refuse (`src/server/import/create.ts:96-97`): `return chosen`. (wave 1)
- [x] M-3: three answers for "you may not read this section" (`src/server/queries/access.ts:117-124` throws,
      `queries/platform.ts:58-62` and `queries/audit.ts:83` return 404, `queries/spaces.ts:141-144` redirects): one
      `requireCan(viewer, action, resource)` that answers `notFound()`. (wave 1)
- [x] M-4: pasting Markdown text containing U+0000 throws inside the clipboard parser
      (`src/editor/paste/markdown.ts:293-321`): strip control characters first. (wave 1)
- With them, the small security items that need no sign-in: static security headers in `next.config.ts` (M-20),
  the notices route answering 403 before 404 and the preview route resolving the viewer before reading the body
  (M-21), and no `render_log` row for an `unknown_consumer` attempt (M-7).

### Item 8. Walk through every remaining decision before writing entities (lane B)

- [x] A dedicated, in-depth session (not a review) that goes through the fifteen decisions in the review's section 8
      and the two below, and records each as a decision record before the Java team writes a single JPA entity:
      team and user ids, the JSON column policy per column, the notice sequence and filtered indexes, timestamps,
      stored sentences vs facts, typed audit and notice payloads (D10), document validation (JSON Schema or BFF),
      JSON number source text, the error shape, consumer identity, search paging, logs as time series, the PDF engine
      and font, the test seam, and test data with literal ids. The two that lane F needs first: team id = slug, and
      sentences or facts in notifications. (wave 1)
- The two data questions raised by the owner:
  - **Template ids and MSSQL.** Today `newTemplateId()` in `src/server/ids.ts` draws six Crockford base32
    characters from `crypto.getRandomValues` (about 1.07 billion values), and `freshTemplateId` in
    `src/server/templates/create.ts:45-51` re-reads up to four times on a collision; the check is read-then-insert,
    safe only because SQLite's single writer serializes it. Every other id is a prefix plus ten random characters
    (about 10^15 values, never checked). Expected collisions grow with the square of the count: at 10,000 templates
    about a 5% chance of one over the lifetime, at 100,000 about five. Options, to decide in the session: keep the
    random scheme and rely on the primary key, catching the unique violation and retrying inside the transaction (fine
    at this scale, portable, nothing to coordinate); or generate from a database `SEQUENCE` encoded in the same
    alphabet (no collisions, but sequential ids are enumerable by consumers); or separate the two concerns, an opaque
    primary key plus a business-facing display id with its own unique index.
  - **A readable id may become a business requirement.** If the business asks for a readable id (a team code, a
    year, a sequence, a check digit), keep it separate from the primary key and from the consumer-facing
    `templateId` in `/api/v1` unless the business wants consumers to use it too; the schema already has no template
    name column (decision 0016), so a `display_id` column with a unique index is the natural home. Gather the
    requirement before the session so the decision covers both ids at once. Owner's call (2026-10-12): what makes
    an id readable is for the product owner; it goes in the handoff package's open questions.

### Item 10. Demo tools behind a demo flag (lane C)

- [x] Put the demo reset, the clock advance and the persona switcher behind one `DEMO_MODE` flag read from a new
      config module under src/server (which lane F extends later), off by default; `resetDemo()` refuses any
      database that isn't a local file. Coral and the two dev labs stay for now (the labs already answer 404 in
      production). (wave 1)
- Why: S1 (Critical, deferred) is the one finding a production deployment cannot carry even for a day, and the flag
  is small. The removal itself waits for real sign-in, as the backlog says.
- Start at: `src/server/actions/demo.ts`, `src/server/actions/persona.ts`, `src/server/reset.ts:67-86`,
  `src/components/demo/`.

### Item 11. Windows readiness, with the dependency pins (lane D)

- [x] Every work laptop is Windows. `cross-env` for the POSIX-only npm scripts (`golden:update`, and the documented
      `E2E_WORKERS=1 …`, `E2E_PORT=3000 …` prefixes, with a PowerShell note in README.md); a
      `pretypecheck` that removes a stale `.next/dev/types`; check path handling in `src/server/import/store.ts`,
      `src/server/render/channels/pdf-fonts.ts` and `e2e/storage.ts` on a Windows checkout (M-31, M-32, T8). (wave 1)
- [x] In the same `package.json` change: exact pins for `@react-pdf/renderer` and `pdfjs-dist`, since the PDF
      adapter depends on their internals (M-19), with a comment saying why. (wave 1)
- Owner's call (2026-10-12): `.claude/skills/` and `.agents/` stay tracked. The owner uses them, and the handoff
  copies the source into a new repository rather than moving this one, so they are simply left out of the copy.
- Why: an env-prefixed script fails in cmd.exe and PowerShell.

### Golden corpus gaps (lane E, promoted 2026-10-12)

- [x] The corpus is the Java engine's acceptance test, the work is pure Node with no rework risk, and a hole here
      becomes a bug the Java team ships and then a dispute about which engine is right. Add `error-invalid-values-only`,
      `error-value-too-long` (a 1,001-code-point value), `error-push-field`, `error-sms-field`, a `round` fixture and
      one `*-round-2` case, and a web/email-only `characters-scripts` case with RTL and CJK text (M-16); fix the two
      comments in `src/domain/render/types.ts` that contradict the spec (M-17). (wave 1)
- Start at: `src/server/render/golden/focused-cases.ts`, `golden/README.md`, `docs/render-spec.md` §13.

## Wave 2

### Item 3. Make the Next.js app backend-agnostic, the BFF seam (lane F)

- [ ] Decide and build the separation so that porting the server code to the Java API leaves the Next.js app's own
      API surface unchanged: the server actions, the on-demand GET routes, the autosave route and the read models keep
      their shapes (`ActionResult`, `ReadResult`, refusal codes, `can` results, ISO strings), and only what sits
      behind them moves. The review's backend seam (handoff-review.md "The backend seam", steps 1, 2 and 6) is the
      plan: a fail-closed request context, use-case services behind interfaces with today's Drizzle code as the local
      implementation and an HTTP implementation beside it, and one config module. Rendering already has this shape
      (`src/server/render/engine.ts`); copy it.
- [ ] Decide the test strategy with it (review H-3). The port does not solve this by itself: it removes the SQLite
      behind `src/server`, so the 45 server test files (597 tests) and the SQL assertions in 36 of 50 e2e specs stop
      meaning anything. What survives untouched: the domain, editor-model, component and render golden tests, and
      every e2e assertion made through the UI or `/api/v1`. The seam decides how the rest is rewritten: with service
      interfaces, the server tests become tests of the BFF against a fake service, plus contract tests against the
      real Java API, and the e2e state assertions move to `/api/v1` and the admin screens.
- Not in scope: hand-written DTOs or interfaces for the Java API. The types come from the OpenAPI spec (item 6)
  once the enterprise writes it, generated with a library such as openapi-typescript, so nothing is written twice.
- How it runs: **2a, one design-heavy agent, one day:** the request context, the service interfaces, the config
  module (extending lane C's), the fake implementation, the test harness for it, and a `plan.md` in the scratchpad
  that assigns 2b's packages with disjoint files. **2b, four or five agents in parallel, one day:** one package per
  group (review actions; access and platform actions; comments, templates and import; the read models under
  `queries/`, which also splits `usage.ts`, `review-shared.ts` and `getReviewScreen` by concern as item 5 asks; the
  drafts and autosave route). Each moves its group behind the interfaces, ports its tests to the fake and keeps the
  database tests as contract tests of the local implementation. **Integration, half a day:** one branch, one full
  e2e, one adversarial reviewer, one PR.
- "Done" means: every action and read goes through a service interface; the local implementation is the only thing
  outside `src/server/db` and the seed that imports Drizzle; the fake exists and the server tests run against it;
  `getViewer()` and `now()` are read in one place, the request context, and nowhere else.
- Why: the migration to the Java API is decided. The cheaper the seam is now, the less Next.js work the port needs,
  and the Node app stays the team's UI and BFF for years.
- Start at: `src/server/actions/kit.ts`, `src/server/actions/review.ts` (`setSunset`, then `approveVersion`),
  `src/server/effects.ts`, `src/server/queries/versions.ts`, `src/server/viewer.ts`, `src/server/clock.ts`;
  decision records 0029 and 0042.

### Item 5. Go deeper on the files that concentrate complexity (lanes G, H, I, K; the server queries inside F)

- [ ] (wave 2.1: components, editor, render and seed; the server-query splits come with the seam, item 3) Split by concern (decision 0043's own test) the files the review says a human cannot read in ten minutes
      (§4 M-23, §5), and add the missing tests:
  - Lane G, components: `src/components/workspace/content/content-workspace.tsx` (24 props, seven concerns, into
    `useContentRevert`, `useContentComments` and a props object per concern), `src/components/comments/thread-list.tsx`
    (one optimistic path, the focus request isolated), `src/components/workspace/content/rail.tsx` (Escape arbitration
    behind a registry); tests for `src/components/preview/pdf/pdf-controller.ts` (H-5: pure `visibleIndices`, queue
    ordering and generation logic, then `load/adopt/cancelIncoming` against a fake pdf.js runtime) and for
    `src/components/settings/platform/approval-chains.tsx`.
  - Lane H, editor: `src/editor/components/block-menu.tsx` (popup, items, numbering and start-at in one file; the
    grip and keyboard openers in another) and `src/editor/components/document-editor.tsx` (the block-handle loader to
    `lib/`, the Activity and history hand-over to a `useEditorLifecycle` hook).
  - Lane I, render: the golden pipeline's old `content.ts` into content-text, content-html, content-plaintext,
    content-pdf and diff; `breakLines` in `src/server/render/channels/pdf-text.ts` into `placeLead`, `placeWord`,
    `applyEdits` with flags on `Piece` instead of identity sets.
  - Lane K, seed: `src/server/seed/templates/build.ts` (one 370-line function) into `emitVersion`, `emitApprovals`,
    `emitLifecycleNotices`, `emitThreads`, with named loop variables.
  - Inside lane F's query package: `src/server/queries/usage.ts` (aggregates as pure functions in
    `src/domain/golive/usage.ts`, the query file as loaders plus one assembly), `queries/review-shared.ts` into people,
    template access and chain, `getReviewScreen` in `queries/review.ts`.
- Why: these are the files most bugs will be fixed in by people who did not write them. Each is commented and tested;
  none is readable in one sitting.
- Overlaps with item 9, which is the broader readability pass; this item is the structural splitting.

### Item 6. A brief for the OpenAPI specification (lane J)

- [x] Write the document from which the Java team authors the OpenAPI 3.1 (Swagger) spec for `/api/v1`. The team
      writes the spec, since the Java API's shape is theirs; this brief gives them everything the Node side knows.
      It should cover: every endpoint and DTO in `src/contracts/api-v1.ts` with the status table
      (`API_ERROR_STATUS`); the error format decision 0056 settles (the existing UCOMP API's, and that the CMS preview
      route changes in the same PR, since it shares the shape today); consumer authentication (client credentials, replacing
      `X-Consumer-Id`); the cursor format and the commit-ordered `seq` it depends on (decision 0006); the sunset
      instant plus `sunsetDay` and `zone` (decision 0038); the notices kinds and their per-kind fields; the render
      request's rule that a JSON number keeps its source text (decision 0011 and `docs/render-spec.md`); the
      `Date` header going back to real time (A7); and the fields the review found ambiguous (`ApiTemplateDetail.name`'s
      three-way rule, `activatedAt`'s fallback, `ApiError.details` per code, `ApiContractChange` as a tagged union).
      It takes lane B's answers on the error shape and consumer identity as inputs. (wave 2.1)
- Why: the contract is TypeScript-only today (A5). The spec is also what makes the BFF seam (item 3) testable.
- Start at: `src/contracts/api-v1.ts`, `src/contracts/README.md`, `src/server/queries/consumer-api.ts`,
  `src/domain/golive/cursor.ts`, the review's routes report ("For the Java team").

### Item 7. Folded into item 3

The backend-agnostic Next.js app and the BFF seam are the same piece of work.

## Wave 3

### Item 2. The docs sweep (lanes L1 to L7, one per README)

- [ ] Make every doc describe the business logic and the code as they are now: fix the eight stale claims and the
      contradiction (review §4 M-28), delete the editor README's status header and its eight "Changes since Phase N"
      sections (H-4), remove the 31 "Phase N" mentions outside `docs/archive/`, rewrite the three type-file headers
      that still address build agents (M-22), label the render spec's pagination rules Node-only and archive its §14
      Before/Now table (M-18), cap doc bullets and table cells at about 600 characters (M-30), and remove numbers that
      drift (timings, file counts) rather than correcting them, since `docs:check` cannot see a stale statement.
- Each lane owns one layer: its README, the "Phase N" and build-history comments in that layer's code, and that
  README's new "how to read a file here" paragraph (item 9). L7 owns the docs root: `docs/architecture.md`,
  `docs/render-spec.md`, `AGENTS.md`, `docs/README.md`, `docs/reference/ui-checklist.md`.
- Why: the docs are true in the large and link-checked, but staleness lives in statements `docs:check` cannot see,
  and history reads as architecture to a newcomer. Running after wave 2 means the sweep describes the split files
  and the seam once, not twice.
- Start at: `src/components/README.md:396` (the e2e contradiction), `src/editor/README.md:8-12` and `:521-643`,
  `src/domain/access-types.ts:1-8`, `src/server/README.md:198`.

### Item 9. Lower the barrier to entry for Node.js developers (lane M, plus one paragraph per lane L)

- [ ] A readability pass guided by the review's section 5, with one rule: the TypeScript stays idiomatic TypeScript,
      optimized for Node.js developers, not reshaped to look like Java. Mixing two languages' conventions is how a
      codebase gets messy. Lane M writes the new files: a two-page Next.js primer for developers new to the App Router
      (server components, why `"use server"` is a public endpoint, streaming and hydration, why `cookies()` outside
      Suspense is a build error, `cache()` and `connection()`); a "your first change" guide that adds a field end to
      end; a README for the e2e folder; a short list of the TypeScript idioms a newcomer meets first (the review names
      ten), explained once rather than rewritten out of the code; and the reading order from the review's section 10.
      Lanes L add the one-paragraph "how to read a file here" to each README (header comment = contract, `/** */` on
      exports, `//` for a decision at a line).
- Why: at the file level the code is readable (median 86 lines, English names, no suppressions); at the system
  level it is slow to learn because of concentration (item 5), history in the docs (item 2) and a comment dialect that
  explains well but scans slowly.
- Start at: `src/components/README.md`, `src/server/README.md`, `src/app/README.md:19-40`, `docs/README.md`
  ("Where a new doc goes" says where the guides belong).

## Wave 4

### Item 12. The handoff package

- [ ] Before the repository moves, assemble the handoff package (Docsor or wherever the team's docs live), written
      with the enterprise context this side-project does not have. The team uses AI agents too, so write it for
      both. Contents: the reading order (review §10) and the Next.js primer (item 9); the decisions made in item 8
      and the ones still open; the product owner's calls below, unresolved; the contract notes to watch during the
      port (the backend seam, the fifteen decisions in review §8, the fields the routes report calls ambiguous, the
      search ranking that is not a SQL keyset, the JSON-number source-text rule, the golden corpus and how Java runs
      it); the monitoring note that streamed pages answer 200 on not-found (below); what the enterprise pipeline
      must run (Prettier check, typecheck, lint, docs:check, test, build, e2e at `E2E_WORKERS=2`); the Windows notes;
      and the nine full reports under `docs/quality-review-2026-10-12/`.
- [ ] What to leave out when copying: the repository itself does not move (owner's call, 2026-10-12); the source is
      copied into a new repository, so git history (G4) and the author identities don't travel. Leave out the
      vendored `.agents/` and `.claude/` folders and the local addresses in `next.config.ts`'s `allowedDevOrigins`
      (an uncommitted local change today).

## Product owner's calls (go in the handoff package, not solved here)

Findings from the UX walkthrough (review §7) that need a product decision. The app works as built; these are
choices about what it should do. Taking the app to the product team for requirements happens in parallel with the
engineering handoff.

- Imported variables are all typed Text, rates and dates included: a Text "Purchase APR" renders `21.99`, not
  `21.99%`, unless the author retypes each. Infer from the placeholder name, block Submit on unconfirmed types, or
  accept as is?
- Pasting `{{any_key}}` silently creates a required Text variable per key, a breaking contract change noticed only
  at Submit. Report after the paste, create as optional until confirmed, or keep (it serves the Copilot flow)?
- A 12-column table is squeezed rather than refused (one letter per line in the editor, about 6 pt in the PDF). Cap
  columns per content type, or allow with a minimum column width and a scrolling or landscape PDF?
- Two-person flows have no presence signal (no "Priya is editing") and no live refresh (Jordan's screen still offers
  Confirm after Alex confirmed). The compare-and-set keeps the data right; is the experience acceptable for v1?
- The template name is cut at 120 characters silently; the Library filter has no "Changes requested", "Superseded"
  or "Revoked" chip; comment quotes are not snapped to words; an author can resolve a reviewer's thread during
  review (`src/domain/comments.ts`); the members table hides controls for roles that may not act rather than
  disabling them with a reason. Each is a small rule to confirm or change.
- A readable template id (item 8): what makes an id readable to the business?
- The `UC-` prefix (item 8, decision 0060): it is left from the product's old name and printed on every customer
  PDF. Keep it, or change it while there are no consumers to break? Asked together with the readable id.

## Noted for the handoff doc, not for this repo

- **Streamed pages answer HTTP 200 on not-found and forbidden.** A documented Next.js constraint, not a bug: once a
  Suspense fallback renders, the server has committed `200 OK` to start the stream, and a `notFound()` inside it can
  only render the not-found UI and inject `noindex` (`node_modules/next/dist/docs/01-app/02-guides/streaming.md`,
  "Status codes"). With Cache Components every dynamic route streams a static shell first, so the documented fix is
  to check the resource in `proxy.ts` before the page renders. The app's `/api/*` routes are route handlers and
  return real statuses already. Decide in the handoff: accept the soft 404 for an internal app behind SSO and key
  monitoring on the API routes, or add a `proxy.ts` existence check once the Java API exists to answer it cheaply.
- **CI/CD, Node pin, `.env.example`, coverage tooling (T4, T9):** handled by the enterprise template and the
  enterprise agents, not here. Write the expected checks and their timings into the package (item 12).
- **DTOs and typed payloads (D10, M-11):** wait for the OpenAPI spec and the enterprise API design, then generate
  the types. Not hand-written here.
- **Who upgrades Next.js:** PR #4 (16.4) is parked on an upstream prefetch loop; name an owner in the package.
- **Deletion and cascades:** what can be deleted (a template, a team, a user) and what outlives what. Nothing can be
  deleted today, and several references have no foreign key on purpose (logs outlive their targets; the data model
  report's M7). Decide before anyone writes JPA cascades.
- **A consumer registry screen (decision 0057):** nothing registers a consumer or links it to an Entra app
  registration; consumers come from the seed.
- **The exact UCOMP error shape (decision 0056):** `/api/v1` follows the existing UCOMP API's error format; write the
  format down and map today's codes and each code's details onto it.
- **The viewer's credential from the BFF to Java (decision 0070):** forward the user's token for the Java API's scope,
  or an on-behalf-of exchange; decided with the sign-in work.
- **Better Auth's Microsoft account id (decision 0054):** check whether it is `sub` (per app) or `oid` (per tenant),
  and how Better Auth's tables map onto the app's `users` table.
- **Before the Java PDF port (decision 0067):** whether customer PDFs must be PDF/UA (accessible) or PDF/A (archival),
  and the enterprise font's licence for embedding and subsetting, with its coverage written into the render spec (R3).
