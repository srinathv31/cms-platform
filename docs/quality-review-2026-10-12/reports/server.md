# Review: `src/server` (actions, queries, effects, drafts, import, viewer, clock, sweeps, testing)

Scope: everything under `src/server` except `render/`, `db/` and `seed/`. Repo at main @ 0cca665, 2026-10-12.
Evidence tags: `measured` (ran it), `verified` (read the code), `traced` (followed, not run).

## 1. Summary

This is a well-built server layer for a prototype, and an unusually honest one: the README's "Don't copy" list and the domain README's "Rules that live outside src/domain" table name almost every deviation I found before I found it. Every one of the 21 server actions runs on one 112-line kit (`actions/kit.ts`) that fixes the order viewer → zod → authorize → `now()` once → one transaction → after; the two demo tools (`demo.ts`, `persona.ts`) are the documented exceptions. Inside transactions the code reads and writes through `tx` without exception (I grepped every `transaction:` callback), every lifecycle write is a compare-and-set on `id, state, rev, currentStage`, and side records (audit, notifications, consumer notices numbered in commit order) land in the same transaction through `writeEffects`. The slice's 32 test files (597 tests) run in 5.5 s against a copy of the real seeded database per test, and they test behavior, including the races that matter (two saves at once, two admins demoting each other, double clicks). Lint is clean on the slice.

The weaknesses are the ones the backlog already names: the actions *are* the service layer (B1), about ten business rules still live here rather than in `src/domain` (B2), SQLite-isms are spread around (two busy-retry copies, `rowid` ordering, `strftime`, whole-table loads in `library.ts`/`audit.ts`/`getRequestAccessData`), and autosave's lost-response recovery reads the audit log (B5). I found a handful of things the backlog does not have: a "team id equals slug" convention baked into five modules and the domain's `createTeam`; two retry layers that can stall a blocked action for up to ~90 s before it fails; an import path that throws a 500 instead of refusing; two different behaviors for "may not read this settings section" (throw vs 404); and 18 comments that record history ("Phase 7a", "(Sri, Oct 5)") against the repo's own rule. Readability is good to excellent in the small files and the kit, and hard in three: `queries/usage.ts` (559 lines, two ~130-line functions, single-letter names), `queries/review-shared.ts` (a seven-concern grab-bag), and `queries/review.ts`'s `getReviewScreen` (four different "baseline" concepts in one function). A Java developer can follow the kit and an action in ten minutes; the read models will take them longer, mostly because of TypeScript type inference idioms (`NonNullable<Awaited<ReturnType<typeof findVersion>>>`) and `Map`s keyed by concatenated strings.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 7 | Lint-enforced boundaries and one action kit; but actions are the service layer, ~10 rules live here, two read-model shapes coexist, and team id == slug is an unwritten invariant. |
| 2 | Correctness & robustness | 8 | CAS on every lifecycle write, retries, races tested, 597 tests green; a few unhandled throws and a 90 s worst-case stall are the only robustness gaps I could reproduce by reading. |
| 6 | Readability for humans | 7 | Kit, effects, drafts, import and the small queries read in minutes; `usage.ts`, `review-shared.ts` and `getReviewScreen` do not; history leaks into 18 comments. |
| 7 | Test quality | 8 | 5.5 s, deterministic (per-test DB copy, shuffled order), behavior-level with race cases; persona/demo actions untested and no coverage tooling. |
| 9 | Security posture | 6 | Inputs zod-parsed everywhere, body caps, permission-before-body, no traversal; but identity fails open, demo tools ungated, persona cookie not HttpOnly, 404-before-403 in autosave, no Origin check. Gaps are all listed. |
| 11 | Handoff readiness (Java/MSSQL/Azure) | 7 | Clear seam plan, stable refusal codes, pure domain transitions; but CAS/retry/partial-index/JSON-column/id==slug semantics and trigger-driven sweeps need rethinking, and there is no OpenAPI. |

## 3. Strengths

- **The action kit** (`src/server/actions/kit.ts`, 112 lines, `verified`). The header comment enumerates the six steps; the code below is exactly those steps. `refuse()` throws a `RefusalError` that rolls the transaction back and becomes `{ ok: false, code, reason }`; anything else propagates as a bug. All 21 `serverAction(` call sites across `review.ts`, `access.ts`, `platform.ts`, `comments.ts`, `templates.ts`, `create-template.ts`, `notifications.ts` use it (`measured`: grep). `kit.test.ts` covers each step, including busy retry and `after` rethrowing Next's redirect.
- **Transaction discipline** (`verified`, `measured`). A grep of every `transaction:` callback in `src/server/actions/*.ts` for `db.` finds nothing. `updateVersion` (`actions/review.ts:142-162`) checks `id`, `state`, `rev`, `currentStage` and bumps `rev` in the same UPDATE; `approveVersion` supersedes the previous Active row with `where state = 'active'` and refuses `activeChanged` on a miss (lines 461-468); `decideAccessRequest` and `decideRecertItem` CAS on `status = 'pending'` / `decision IS NULL` (`actions/access.ts:284-289, 372-377`); thread resolve/reopen CAS on `status` (`actions/comments.ts:320-325`). `startDraft` relies on the partial unique index `versions_one_draft` with `onConflictDoNothing()` for two people pressing Edit (`actions/templates.ts:97-102`).
- **`effects.ts`** (`verified`). One writer for audit rows, notifications and consumer notices inside the caller's `tx`; recipients resolved server-side, the actor excluded; `takeNoticeSeqs` (lines 253-272) numbers the outbox in commit order under the write lock, keeps a high-water mark in `settings` so deleted rows never hand their numbers out again, and the comment explains all three properties. `recipientSpaces` (194-216) handles the cross-team stage reviewer's link correctly.
- **Autosave** (`drafts/apply-patch.ts`, `parse-patch.ts`, `audit-merge.ts`, the route; `verified`). Pure work (normalize, prepare, parse) before the write lock; permission checked from the path before a byte of body is read; `readBodyCapped` with a 2 MB cap; CAS on `rev` and `state`; the lost-response tolerance (`sessionOwnsRev`) is a 7-line pure function with a clear doc comment; `parse-patch.ts` bounds depth (40), nodes (100k), variables (200), sample sets (50) and keeps JSON number source text. 54 + 38 + 14 + 10 tests, including "two saves at once" (`apply-patch.test.ts:676-688`).
- **Import isolation** (`import/isolate.ts`, `zip-limits.ts`, `convert-worker.mjs`, `store.ts`; `verified`, `measured`). Zip central-directory claims checked before inflating; mammoth and pdf.js in a worker with a 256 MB heap and 30 s timeout; the tests actually exhaust a worker's heap and time one out (`convert.test.ts`, 4.7 s). `store.ts` builds every path from a regex-checked upload id and fixed basenames; the client file name never reaches the file system; `readOriginal` re-validates the stored path. No traversal.
- **Test infrastructure** (`testing/review-fixtures.ts`, `src/lib/fresh-database.ts`; `measured`). 32 files, 597 tests, 1 skipped, 5.54 s. Each database test gets a fresh copy of a seeded file; tests are shuffled; `loadPersona` builds a `Viewer` the way `getViewer()` does. `review.test.ts` (1,566 lines, 57 tests) exercises submit/approve/request-changes/sunset/revoke end to end with the real seed.
- **Read models that return decisions** (`queries/versions.ts` `versionActions`, `queries/access.ts` `can`/`consequences`; `verified`). A component gets `can: { setSunset: PermissionResult, … }` with the same refusal codes the action would return, so disabled controls show the exact sentence and never call `can()`.
- **Honest documentation.** `src/server/README.md` "Don't copy" and `src/domain/README.md` "Rules that live outside src/domain" are accurate against the code (I checked each entry).

## 4. Findings (by severity)

### High

**H-1. Team id == slug is an unwritten invariant across five modules and the domain** — `verified`
- Where: `access-effects.ts:97` (comment "Team ids are their slugs (seed contract), so every link builds from the id"), `queries/spaces.ts:124` (`teamId: string | null` "same as the slug"), `queries/access.ts:108` (`teamBySlug`: "team ids are their slugs"), `queries/access.ts:1040-1047` (`getSidebarCards` uses `s.slug` as `teamId`), `queries/review.ts:96` (`inScope`), and the domain's `createTeam` (`src/domain/platform-config/teams.ts` lines 73, 95: `team = { id: slug, slug, … }`).
- What happens: hrefs, permission checks and SQL filters interchange `teams.id` and `teams.slug`. It holds today because the seed and `createTeam` both set `id = slug`. Nothing enforces it (no CHECK, no test named for it), and a team can never be renamed without changing its primary key.
- Why it matters: a JPA team will have a surrogate key by default; the first `Team` entity with an identity column breaks every link the notifications table already holds and every `can(viewer, …, { teamId })` call that was handed a slug. This is the kind of hidden semantic the brief asks for.
- Fix: decide now (keep `id = slug` and add a CHECK + a decision record, or split them and pass `teamId` everywhere). Either way, remove the "(seed contract)" comments and make it a stated rule in `docs/architecture.md`.

### Medium

**M-1. Two retry layers compound into a ~90 s worst-case stall** — `verified`
- Where: `src/lib/serialized-writes.ts:29` (`DEFAULT_WAIT_MS = 15_000`, a writer that can't get its turn fails as `SQLITE_BUSY`), `effects.ts:301-310` (`inTransaction` retries `SQLITE_BUSY` up to 5 more times, sleeping 15…240 ms), same shape again in `drafts/apply-patch.ts:68-77`.
- What happens: if one transaction holds the process-wide write lock for a long time, every other action waits 15 s, fails busy, retries, waits 15 s again — six attempts before the kit throws. Server actions have no timeout, so a user can sit on a spinner for a minute and a half before seeing the generic failure.
- Why it matters: the README describes `inTransaction` as a short retry for a file-level collision ("15 ms, doubling"); it does not say the inner wait is 15 s per attempt. The two layers were written for two different failure modes (another process vs. this process) and now multiply.
- Fix: make `serialized-writes` the only place that waits (and fail fast there), or cap `inTransaction`'s total budget; delete the second copy in `apply-patch.ts` (README "Don't copy" already asks for this). Document the worst case.

**M-2. Import throws a bug where it should refuse** — `verified`
- Where: `import/create.ts:96-97`: `const chosen = await newTemplateType("document"); if (!chosen.ok) throw new Error(chosen.reason);`
- What happens: when the platform has no document content type (a Platform Admin can't delete one today, but the domain already returns a refusal for the case), the route answers 500 instead of `{ ok: false, code, reason }`. `createTemplate` (`actions/create-template.ts:55-56`) handles the same result with `refuse(chosen)`.
- Fix: `return chosen;` (the `ImportResponse` union already carries `Refused`), add the code to `importStatus`.

**M-3. Business rules still in this layer (B2), and two of them duplicated here** — `verified`
- Where: `queries/review-shared.ts:266-288` (`decideCheck` re-implements the approve transition's "approved an earlier stage" rule); `queries/consumer-api.ts:46-47` and `queries/integration.ts:68` (`published` channels filter, written twice); `effects.ts:31` (`CONSUMER_NOTICE_WINDOW_DAYS = 90`, the recipient rule); `actions/access.ts:204, 263-267` (two Auditor rules); `actions/review.ts:52-53` (`NOTE_MAX`/`REASON_MAX`, copied in three places per the domain README); `actions/platform.ts:300-326` (re-notify on a stage rule change).
- Why it matters: the Java team will port `src/domain` and miss these. The domain README lists them, which is the right stopgap, but the list is not lint-enforced and the `published` filter has already forked.
- Fix: one domain function per rule (`publishedChannels(version, contentType)`, `noticeAudienceWindow`, `decideCheck` folded into `canDecide`), as the backlog already plans.

**M-4. Three different answers for "you may not read this section"** — `verified`
- Where: `queries/access.ts:117-124` (`teamSection` → `assertCan` → throws `PermissionError`); `queries/platform.ts:58-62` (`requireManage` → `notFound()`); `queries/audit.ts:83` (`notFound()`), vs `queries/spaces.ts:141-144` (`requireSpace` → `redirect`). No `error.tsx` under `src/app` handles `PermissionError` (grep found none).
- What happens: a Team Admin page reached by someone without the role surfaces as the error boundary's "This tab didn't load." (a thrown error), the Platform group as a 404, a hidden team as a redirect.
- Fix: one helper (`requireCan(viewer, action, resource)` → `notFound()`) used by every section read model.

**M-5. `queries/usage.ts` is the file a human will struggle with most** — `verified`
- Where: `getUsageDashboard` (lines 277-403, ~127 lines) and `getTemplateUsage` (418-559, ~140 lines); `Map`s keyed by `` `${templateId}#${number}` `` and `` `${templateId}#${consumerId}#${versionNumber}` `` (lines 85, 205); loop variables `w`, `g`, `c`, `r`, `v`, `e`, `s`; six `Promise.all` loaders whose results are then re-aggregated in three passes.
- Why it matters: it is the one place that computes every Usage number; a wrong denominator here is a wrong dashboard. The header comment is good ("one denominator everywhere"), but nothing in the body carries that forward.
- Fix: extract `aggregateCells(cells)`, `weeklySeries(series, w)`, `versionsOut(…)` as named pure functions in `src/domain/golive/usage.ts` (where `heatmap`, `usageTags` already live) and leave the query file as loaders + one assembly.

### Low

**L-1. History in comments against the repo's own rule** — `measured`
- Where: 18 hits for `Phase N`, `(Sri, …)`, `build plan`, `slice S2`, `prototype-log` in this slice (`clock.ts:8`, `viewer.ts:9`, `actions/review.ts:266`, `actions/templates.ts:23,126`, `access-effects.ts:9`, `queries/review-shared.ts:32,109`, `queries/review.ts:132`, `queries/usage.ts:42`, `queries/workspace.ts:219`, `queries/copilot.ts:14`, `queries/import.ts:12`, `import/create.ts:20`, `import/pdf.ts:11`, `convert-worker.mjs:46`, `starters/card-offer-terms.ts:8`).
- Why it matters: AGENTS.md says "Describe what the code does now, not how it got there." A newcomer does not know what Phase 6 was.
- Fix: a one-hour sweep; keep decision-number references, drop phases and names.

**L-2. `queries/review-shared.ts` mixes seven concerns** — `verified`
- Where: people (37-50), dates (54-60), template access (64-175), approval chain (178-256), decide check (259-288), render-log usage (292-320), document anchors (324-342). Its header literally says "Helpers the Phase 4 read models … share."
- Fix: `queries/people.ts`, `queries/template-access.ts`, `queries/chain.ts`; move `iso()` to `src/domain/dates.ts`.

**L-3. `getWorkspaceHeader` re-implements `requireTemplate`** — `verified`
- Where: `queries/workspace.ts:106-108` repeats the three checks `seesInSpace` makes in `review-shared.ts:99-102` instead of calling `requireTemplate(spaceSlug, templateId)` (which is `cache()`d and already used by the sibling tabs).
- Fix: call `requireTemplate`; drop the inline copy.

**L-4. Autosave answers 404 before 403 (S10 is still open)** — `verified`
- Where: `drafts/apply-patch.ts:33-37` (`editRefusal`: `versionGone` first, then the permission refusal), used by `accessRefusal` which the route calls before reading the body.
- What happens: a probe can learn whether a version id exists on a team it cannot see. The kit's stated rule for actions ("a record that doesn't exist is refused like a forbidden one") is not applied here.
- Fix: look up the version with the team and answer `generic` (403) for both unknown and forbidden; keep 404 only for a syntactically invalid id.

**L-5. Persona cookie is set without `httpOnly` or `secure`** — `verified`
- Where: `actions/persona.ts:41-45`, `actions/demo.ts:20-24` (`{ path, sameSite: "lax", maxAge }`).
- Why it matters: demo-only today (S1/S2 deferred), but whatever session cookie replaces it will be set from the same two call sites; make the flags part of that change.

**L-6. `after` runs inside the kit's try/catch** — `verified`
- Where: `actions/kit.ts:106-110`. A `RefusalError` thrown from `after` would return `{ ok: false }` for a write that already committed. No current `after` does this; the one in `accessAction` (`actions/access.ts:94-97`) only refreshes.
- Fix: move `await steps.after?.(result, ctx)` after the catch, or document that `after` must not refuse.

**L-7. `accessAction` performs side effects inside `authorize`** — `verified`
- Where: `actions/access.ts:89-93`: the access and sunset sweeps run (and call `refreshAfter()`) inside the wrapped `authorize`, i.e. before the kit reads `now()` and opens the action's transaction.
- Why it matters: it is documented in the README's "Variations today" and the reason is sound (a refusal must not roll a sweep back), but a reader of `kit.ts` learns that `authorize` reads and checks only. The sweeps also run on every access action, on a persona switch and on clock advance, never on a timer (S4, deferred).
- Fix: a kit step `before?: () => Promise<void>` between authorize and the transaction, so the deviation is a named extension point rather than a wrapper that overrides `authorize`.

**L-8. Worker path assumes `process.cwd()` is the repo root** — `verified`
- Where: `import/isolate.ts:20`: `path.join(process.cwd(), "src/server/import/convert-worker.mjs")`.
- What happens: deployed from a build output or started from another directory, every .docx/.pdf import fails as `unreadable` (the worker's `error` event). Same family as T8 (Open), which names `pdf-fonts.ts` only.
- Fix: add it to T8's "Where"; in production resolve the worker from the deployed bundle or read it from an env path.

**L-9. Whole-table reads in read models (B4 is still open)** — `verified`
- Where: `queries/library.ts:73-85` (every version of every team, no `where`, for any space), `queries/access.ts:154` (`loadMembershipFacts(db)` with no filter for the Request access page), `queries/audit.ts:215-236` (the whole log, filtered in memory, by design per the header), `queries/consumer-api.ts:100-119` (every Active version's `variables` JSON for a search). Fine at seed scale (~20 templates, ~27k render_log rows are grouped in SQL); not a pattern to port.

**L-10. Untested: `persona.ts`, `demo.ts`; stale T9 text** — `measured`
- `grep` for `switchPersona|advanceClockAction|resetDemoAction` in `src/**/*.test.ts` finds nothing. T9's description also says library, workspace and platform queries are untested; `library.test.ts`, `platform.test.ts` and workspace coverage in `review.test.ts` exist now, so the finding's "What happens" is partly stale while its Status (Open) is right about coverage tooling.

**L-11. Readability idioms a Java developer will trip on** — `verified`
- `actions/review.ts:112` `type FoundVersion = NonNullable<Awaited<ReturnType<typeof findVersion>>>`; `actions/access.ts:148,208` `?? refuse(…)` as an expression (a `never`-returning throw in a null-coalescing position); `effects.ts:81,89` `team ??= teamSlug(tx, ctx)` memoizing a Promise; `actions/access.ts` three wrapper layers (`memberAction` → `accessAction` → `serverAction`); `queries/template-name.ts:21` a raw SQL subquery in a template string. Each is idiomatic TypeScript and commented; together they are the learning curve.

**L-12. Two copies of `isBusy`/retry** (README "Don't copy", still present) — `verified`: `effects.ts:289-310` and `drafts/apply-patch.ts:56-77`.

## 5. Backlog check (docs/handoff-review.md)

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| H1 Three server-action styles | Fixed | Yes | 21 `serverAction(` call sites; demo/persona documented exceptions (`measured`) |
| T3 DB tests depend on order | Fixed | Yes | `seededDatabasePerTest` in every DB test file; 597 tests pass shuffled in 5.5 s (`measured`) |
| S6 Body limits trust Content-Length | Fixed | Yes | `readBodyCapped` in the drafts and imports routes; permission before body (`verified`) |
| S7 Comments on any state | Fixed | Yes | `canComment`/`canActOnThread` in authorize and the transition inside `tx` (`verified`) |
| A6 Reads as server actions | Fixed | Yes | `compare.ts`, `base-version.ts`, `submit-summary.ts` are `server-only`; GET routes exist; lint confines `"use server"` (`verified`) |
| N17 private `draftRow` | Fixed | Yes | `actions/review.ts:33` imports it from `templates/create.ts` (`verified`) |
| N18 `readBodyCapped` location | Fixed | Yes | `api/read-body.ts` (`verified`) |
| N16 Two rules outside the domain | Fixed | Yes for the Auditor-as-first-admin rule (`createTeam` action passes `platformRole` to the domain, checks nothing itself) (`verified`); the reason check I did not trace into the form |
| A3 Error shapes | Partly fixed | Yes | Actions, reads, autosave, import and audit export all answer `{ ok, code, reason }` (`verified`) |
| B1 Actions are the service layer | Partly fixed | Yes | Still true of every action (`verified`) |
| B2 Rules outside the domain | Partly fixed | Yes | See M-3; domain README's table is accurate (`verified`) |
| B4 SQLite workarounds spread | Open | Yes | See L-9, L-12, `rowid` ordering in `audit.ts:235`, `activity.ts:45`, `notifications.ts:28` (`verified`) |
| B5 Autosave reads the audit log | Open | Yes | `apply-patch.ts:152-171` (`verified`) |
| S10 No Origin check; 404 before 403 | Open | Yes | See L-4 (`verified`) |
| S2 Identity fails open | Deferred | Yes | `viewer.ts:58-59` falls back to `DEFAULT_PERSONA` (`verified`) |
| D10 Payloads untyped | Open | Mostly | `AuditDetailsByAction` exists with one typed action; `ConsumerNoticeEffect.payload` is typed; `AccessEffect.details` is `Record<string, unknown>`. "Open, mechanism in place" would be more accurate (`verified`) |
| T9 No coverage, untested code | Open | Status yes, text stale | See L-10 |
| H8 Oversized files | Fixed (by concern) | Defensible | Five files in this slice exceed 400 lines; decision 0043 says split by concern not line count. `usage.ts` is the one that fails the concern test too (M-5) |

New, not in the backlog: H-1 (team id == slug), M-1 (compounded retry stall), M-2 (import throws), M-4 (three not-allowed behaviors), L-3, L-5, L-6, L-7, L-8 (worker path), L-1 (history in comments).

## 6. For the Java team

**Ports cleanly (keep or translate 1:1):**
- The kit's step order *is* a Spring service method: `authorize` → `@PreAuthorize`/explicit check; `transaction` → `@Transactional` method; `writeEffects` → an `EffectsWriter` bean called inside the same transaction; `after` stays in the BFF (`revalidatePath`/`refresh`).
- Domain transitions (`src/domain/lifecycle/*`) are pure: `{ ok, changes, effects } | { ok: false, code, reason }`. Port them as-is; the refusal codes are the API contract (`src/domain/refusals.ts`).
- `updateVersion`'s compare-and-set → JPA `@Version` on `versions.rev` plus a state guard; `approve`'s "previous Active steps down first" keeps its order.
- zod input schemas, `ActionResult`, `ReadResult` statuses (400/403/404/409) and `useActionRun` stay in the BFF unchanged; the BFF action body becomes one HTTP call.
- `import/*` is already backend-shaped: `importTemplate(viewer, input, options)` with `uploadsRoot` injectable; `store.ts` is the one file to replace with a blob client (`writeUpload`/`readOriginal`/`removeUpload`).
- `takeNoticeSeqs` → a database `SEQUENCE` (same guarantees, no `settings` row).

**Needs rethinking:**
- `inTransaction` + `serialized-writes`: delete both; MSSQL row locks replace the process lock. Keep the CAS predicates.
- Partial unique indexes (`versions_one_draft`, `versions_one_active`, `versions_one_released`) → MSSQL filtered indexes (supported) or application checks; `onConflictDoNothing` in `startDraft` → catch the unique violation.
- JSON columns the actions read and write (`versions.writers`, `stages`, `channel_fields`, `audit_events.details`, `consumer_notices.payload`) → NVARCHAR(MAX) with JSON functions, or normalize `writers`/`stages`.
- Team id == slug (H-1), `teamId: null` meaning "platform-wide", millisecond-integer timestamps read as `Date`, ISO strings at the read-model boundary, `rowid` ordering, `strftime` day buckets, `localeCompare` sorts.
- The sweeps (`access-sweep.ts`, `sunset-sweep.ts`) run only on demo triggers; in Spring they are `@Scheduled` jobs with the same `sweepAccess`/`sweepSunsets` domain functions.
- `getViewer()` (24 call sites) and `now()` are the two seams for Entra ID and a real clock; both must fail closed.
- The notice-window rule (90 days from `render_log`) and `published` channels filter are server rules the Java service must own.

**Read first, in this order:** `src/server/README.md`; `src/server/actions/kit.ts`; `src/server/actions/review.ts` (`setSunset` then `approveVersion`); `src/server/effects.ts`; `src/server/drafts/apply-patch.ts`; then `docs/handoff-review.md` "The backend seam".

## 7. Models of good code / files a human will struggle with

**Models of good code**
- `src/server/actions/kit.ts`: the whole mutation contract in one screen.
- `src/server/effects.ts`: `takeNoticeSeqs` and `writeEffects` comments explain the invariants, not the history.
- `src/server/drafts/parse-patch.ts` and `audit-merge.ts`: pure, bounded, tested.
- `src/server/import/isolate.ts`, `zip-limits.ts`, `store.ts`: one concern each, limits named and justified.
- `src/server/api/read-body.ts`, `api/reads.ts`: small, exact.
- `src/server/queries/versions.ts` (`versionActions`): the read-model-with-decisions pattern at its clearest.
- `src/server/testing/review-fixtures.ts` and `review.test.ts`'s header: how to test an action.

**Files a human will struggle with**
- `src/server/queries/usage.ts` (559 lines; M-5).
- `src/server/queries/review-shared.ts` (seven concerns; L-2).
- `src/server/queries/review.ts` `getReviewScreen` (lines 260-390: `renameBaseline`, `reviewBaseline`, `contractBaseline`, `replacedBy`, `previousNumber`, `stillRenders` in one function).
- `src/server/actions/access.ts` (three wrapper layers, `?? refuse()` idiom; L-11).
- `src/server/actions/review.ts` (651 lines; well sectioned, but the 18-line JSDoc paragraphs and `FoundVersion` inference slow a first read).
