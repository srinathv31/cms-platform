# Review: `src/domain` (+ `src/editor/model`)

Repo at main 0cca665, 2026-10-12. Read-only review. Evidence tags: `measured` (ran it), `verified` (read the code), `traced` (followed, not run).

## 1. Summary

The domain layer is the strongest part of the codebase I would expect a Java team to inherit: 88 production files and 63 colocated test files of pure TypeScript whose boundary is lint-enforced (`eslint.config.mjs:102-115`, lint clean in 2.1 s, measured) and whose purity holds up to grep: no `Date.now`, `Math.random`, `crypto`, `console`, `process.env`, no `new Date()` without an argument, and no import outside `@/editor/model/*`, `@/contracts/api-v1` and relative files (measured). The transitions share one shape (`{ ok: true, changes, effects } | { ok: false, code, reason }`), refusal codes are provably unique across nine tables (`refusals.test.ts`), and a source scan fails the build if any screen compares an English sentence. The sunset rule (business-zone midnight, DST gaps and double midnights, idempotent sweep), maker-checker over every writer, review rounds, and the two-person revoke are each in one file with one test file beside it, and the 6-moves-by-6-states transitions table in `transitions.test.ts` is exactly how a reviewer wants a state machine proven. 1,537 domain tests run in 2.96 s (2,117 in 4.78 s with the editor model), deterministic, in random order. The READMEs (one per folder, with a reading order, a vocabulary table, a "rules that live outside" table and a "don't copy" list) are true today: I checked every row of the outside-rules table and every item of the don't-copy list against the code.

What holds it back from a 9 across the board is concentrated in a few places. Three large type files (`access-types.ts` 748 lines, `audit.ts` 686, `golive-types.ts` 390) still carry the scaffolding of how the prototype was built: "Phase 6 contract, written by the lead; every Phase 6 agent codes against this file", `PlatformConfigDomain`/`AuditDomain` interfaces that exist only to be `satisfies`-checked, and a header naming `domain/access.ts` and `domain/platform-config.ts`, files that decision 0043 split into folders. Audit and notice payloads are still `Record<string, unknown>` (D10, correctly Open). `PermissionResource` is a bag of optional fields, so a `can("version.decide")` call that forgets `writers` silently skips maker-checker. Several English sentences (notification titles, `contractLines`) are built in the domain and written into stored effects, which a Java port has to reproduce word for word. And JavaScript collation (`localeCompare`) decides at least one business outcome (which content type a new Alert gets). None of these is a bug I could reproduce; they are the handoff costs.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 8 | Boundary lint-enforced and clean; rules in one place with an honest, accurate list of the nine that aren't; two effect vocabularies and a few rules in components/queries remain. |
| 2 | Correctness & robustness | 8 | No reproducible bug in the slice; DST, idempotency, surrogate pairs, prototype keys handled; small inconsistencies (`approve` validates a sunset it then ignores; `setSunset` doesn't know about a pending revoke; `sunsetInstant` throws on a malformed day and relies on the caller's `isCalendarDay`). |
| 6 | Readability for humans | 7 | Most rule files are a pleasure (header with behavior table, short functions, decision links); three type files mix five concerns and carry build history; `approve` (186 lines) and `sweepAccess` (190) are the two functions that take a screen and a half. |
| 7 | Test quality | 9 | 1,537 tests in 2.96 s, deterministic, named for behavior, table-driven state machine, Unicode conformance file, every-day-of-two-years zone check, architecture tests; coupled to copy in ~100 assertions. |
| 8 | Documentation | 8 | Per-folder READMEs with reading order, vocabulary, "rules outside" and "don't copy" tables that match the code; stale header in `access-types.ts`, "under a second" is 3 s, 35 comment lines explain history not behavior. |
| 11 | Handoff readiness (Java/MSSQL/Azure) | 7 | Pure and portable with Java equivalents written where it matters; costs are collation in a business decision, `Intl` formatters, ES2025 `JSON.parse` source text, function-valued refusal entries, English stored in effects, untyped audit details. |

## 3. Strengths

- **Purity is real, not aspirational.** `grep` over non-test files for `Date.now`, `Math.random`, `crypto`, `structuredClone`, `toLocale`, `console.`, `process.env`, `Buffer` returns nothing; every `new Date(` has an argument (`dates.ts:38`, `business-zone.ts:90,96,133,134,168`, `recertification.ts:80`, `inactivity.ts:13,33,34`, …). Non-relative imports in production files are only `@/editor/model/*` (16 lines in 11 files) and type-only `@/contracts/api-v1` (measured).
- **The refusal contract.** `refusals.ts` builds every refusal with `refusal(code, sentence)`; `RefusalCode` is a type-level union of nine tables; `refusals.test.ts:46-51` fails on a duplicate code and `:95-122` scans `components`, `server`, `app`, `lib` for `=== REASONS.`-style or `reason === "Sentence"` comparisons. The three `.reason ===` hits in the repo compare enum fields (`inactivity_auto`, `invalid_key`, `escape-key`), not refusal sentences (verified).
- **One predicate per rule.** `sunsetPassed` (`lifecycle/sunset.ts:29`) is the only `sunsetAt <= now` comparison in `src` (measured: no other hit outside the file); `makerCheckerRefusal` (`permissions.ts:106`) is shared by the `version.decide` guard, `approve` and `requestChanges`; `nextRound` (`rounds.ts:80`) is the only numbering.
- **The state machine is proven as a table.** `lifecycle/transitions.test.ts:69-118` runs six review moves against all six `VERSION_STATES` and asserts the exact refusal for every blocked cell (36 cases), then the review loop, maker-checker across rounds, and the two-person revoke.
- **Business-zone math is correct and documented for Java.** `business-zone.ts:17-21` gives the `LocalDate.atStartOfDay(zone).toInstant()` and `instant.atZone(zone).toLocalDate()` equivalents; `sunsetInstant` handles skipped midnights (Santiago) and doubled midnights (Havana) and uses `hourCycle: "h23"` to avoid the 24:00 formatting trap; `business-zone.test.ts:62` checks every day of 2026 and 2027 in every offered zone.
- **Exact values, no doubles.** `editor/model/variables.ts:88-96, 143-258`: decimals are regex-validated strings, grouped by position (`groupThousands`), dates parsed by a fixed English table, no `Number`, `parseFloat` or `Intl` touches a value; `render/json-number-text.ts` keeps JSON numbers' source text. `golive/json-schema.ts` publishes the same grammar as JSON Schema 2020-12 with `[0-9]` instead of `\d` for cross-validator safety.
- **Unicode is pinned, not inherited.** `messages/graphemes.ts` implements UAX #29 at Unicode 17.0 from generated data instead of `Intl.Segmenter`, with the reason spelled out (browsers, Node and ICU4J disagree), and tests against Unicode's own `GraphemeBreakTest.txt`.
- **Headers that teach.** `dates.ts:1-22`, `rounds.ts:1-18`, `lifecycle/sunset.ts:1-7`, `render/resolve.ts:1-28`, `messages/gsm7.ts:1-20` (standards cited with section numbers), `render/types.ts:22-39` (RenderDoc invariants): each file opens with what it does and example outputs, so a reader knows the behavior before the first line of code.
- **Architecture tests.** `refusals.test.ts` (no sentence comparisons in UI/server), `platform-config/teams.test.ts` (every top-level route segment is a reserved slug), the schema-check test that fails when the editor gains a node the resolver doesn't handle, and `golive-types.ts:49-70` `_DriftChecks` holding the domain's render types equal to the published wire types at compile time.
- **The docs' honesty.** `README.md:212-226` lists nine rules that live outside the domain; I verified all nine are still where it says (`decideCheck` in `review-shared.ts:266`, the 2,000 limits in `actions/review.ts:52-53`, `decision-model.ts:14`, `validation.ts:21`, Auditor-request rule in `actions/access.ts:203-204, 265-266`, `conformToContentType` in `templates/create.ts:71`, `published()` in `consumer-api.ts:46`, …). `README.md:243-254` "Don't copy" names its own deviations (`editLatest` throws, two `Ok`, `andList` copies, dead `STATUS_META.renders`, duplicated 120 limit), all still true.

## 4. Findings

### High

None found in this slice.

### Medium

**M1. `PermissionResource` is a bag of optional fields, so a forgotten field silently disables a guard.** `verified`. `types.ts:174-200`, `permissions.ts:89-97, 117-128`. Maker-checker runs only when the caller passes `submittedBy` and `writers`; the two-person revoke only when `revokeStartedBy` is passed; the stage-named approver path only with `stageApproverIds`. A new `can(viewer, "version.decide", { teamId })` call site compiles and grants. Today the callers (`decideCheck`, the actions) pass them, and `permissions.test.ts` covers the guards, but the safety is by convention. Why it matters: a Java port with one `Resource` DTO will inherit the footgun. Fix: a resource type per guarded action (`DecideResource { teamId; submittedBy; writers }`) so the compiler demands the facts, or have `can` throw when a guarded action is asked without its facts.

**M2. Audit and notice payloads are untyped; sentence builders guess at fields.** `verified`. `review-types.ts:61-69` (`details: Record<string, unknown>` for every action but `version.sunset_passed`), `access-types.ts:151-161` (`AccessAuditEffect.details`), `audit.ts:143-254` (`describeAuditEvent`: `text(d.userName)`, `count(d.daysInactive)`, `d.reason === "inactivity_auto"`, 113 lines of defensive reads), `golive/notices.ts:1-29` (reads "slightly different payloads" from the seed and from runtime). This is D10, correctly marked Open; the scaffold for the fix exists (`AuditDetailsByAction` with one entry). Why it matters: the JSON column a Java team will map to a JPA entity has no schema; every reader re-derives it. Fix: finish `AuditDetailsByAction` for every `AuditAction` and `AccessAuditAction`, make `details` the mapped type, and migrate the seed instead of reading two shapes.

**M3. English sentences are built in the domain and written into stored effects, so a second backend must reproduce the exact words.** `verified`. Notification titles (`lifecycle/sunset.ts:93`, `revoke.ts:56,90`, `approve.ts:139,149,200`, `submit.ts:205`, `access/sweep.ts:129-130,165,175,…`), `contractLines` in consumer-notice payloads (`sunset.ts:82`, `approve.ts:169,210,224`, from `contract.ts:describeChanges`), and the `platform.config_changed` `summary` are English strings produced by the rule and stored in `notifications`/`consumer_notices`. Why it matters: the refusal design (code + sentence, sentence free to reword) is not applied here; if the Spring Boot API writes these rows, it must port the sentence builders character for character or consumers and the bell read different text for the same event. Fix: store the facts (kind, number, actor, round) and word them at read time, as `describeAuditEvent`/`noticeView` already do for audit rows and notices; keep `title` as a cached rendering only if needed.

**M4. `access-types.ts` is five concerns plus build scaffolding, and its header names files that no longer exist.** `verified`. `access-types.ts:1-8` says "Phase 6 contract … written by the lead; every Phase 6 agent codes against this file" and points to `domain/access.ts` and `domain/platform-config.ts`, both split into folders by decision 0043 (`ls` confirms neither exists). Lines 27-39 rule constants; 41-102 domain facts; 104-209 changes and effects; 233-637 read models for eight screens; 639-653 `PlatformActions` (server-action signatures); 655-748 `PlatformConfigDomain` and `AuditDomain`, interfaces whose only use is `satisfies` checks in `platform-config/contract.ts:17` and `audit.ts:679` and whose doc comments duplicate the implementing functions'. The same pattern is in `golive-types.ts:1-10, 106, 165, 174, 181, 333, 339` ("slice S1/S2/U3") and `import-types.ts:1-8` ("every 7a agent codes against this file"). Why it matters: a newcomer reads orchestration history as architecture, and two places must change for one signature. Fix: delete the `*Domain` interfaces and `contract.ts` (the functions are the contract), move read models beside their queries as decision 0042 did for review, keep the rule constants and effect types, and rewrite the three headers to describe what the file holds now.

**M5. Two effect vocabularies and two writers.** `verified`. `review-types.ts:61-140` `LifecycleEffect` (`audit` with `versionId?`, `notification` with `to: Recipients`, `consumer_notice`) vs `access-types.ts:124-209` `AccessEffect` (`audit` with `teamId`, `actorId`, `at`; `notification` with `AccessRecipients`, `AccessLink`, `at`), written by `server/effects.ts` and `server/access-effects.ts` respectively. The README (`README.md:124-128`) documents this as a fact. Why it matters: a Java `EffectWriter` has to implement both; a notification's link is `NotificationLink` in one and `AccessLink` in the other. Fix: one `Effect` union with optional `at`/`versionId`/`teamId`, one recipients type, one writer.

**M6. `approve` is a 186-line function; `sweepAccess` is 190.** `verified`. `lifecycle/approve.ts:59-245` runs eight refusal checks, builds the approval record, then has two exits ("an earlier stage", "the last stage") each assembling effect arrays inline; `access/sweep.ts:52-242` plans boundaries per membership, applies the last-admin rule, then a loop with four branches mutating a `set` via `Object.assign(set, {...} satisfies MembershipSet)`. Both are well commented and tested, but each takes a human more than ten minutes. Fix: `approve` → `checkApprove` + `approveStage` + `goLive`; `sweepAccess` → `planMembership`, `holdLastAdmins`, `applyBoundary`.

### Low

**L1. A JavaScript collation decides which content type a new Alert gets.** `measured`. `lifecycle/drafts.ts:94-97` `newTemplateContentType` sorts content types with `localeCompare` and takes the first. The probe shows `localeCompare` and code-point order disagree (`Émile eve UC-_9 UC-a1 uc-A3 UC-B2 Zoe` vs `UC-B2 UC-_9 UC-a1 Zoe eve uc-A3 Émile`). Eight other `localeCompare` sorts are display order only (`consequences.ts:196-197`, `permissions.ts:224`, `platform-config/channels.ts:58`, `access/sweep.ts:60,64`, `golive/usage.ts:239-240`). D11 names `localeCompare` generally; this is the one with a business consequence. Fix: `compareCodePoints` from `golive/cursor.ts:115` here, or pick by an explicit `position`/`isDefault` on the content type.

**L2. `approve` refuses a bad `sunsetPrevious` even when there is nothing to sunset.** `verified`. `approve.ts:103` checks `isAfterToday(sunsetPrevious)` before `:167` decides `active && sunsetPrevious !== null`; the doc at `:65-68` says "after the Active version was revoked … `sunsetPrevious` is ignored". `approve.test.ts:139-147` covers only a valid date with `active: null`. Fix: check the date only when `active` is non-null, or document that the date is validated regardless.

**L3. `setSunset` does not know about a pending revoke; the rule lives in a component.** `verified`. `lifecycle/sunset.ts:57-59` has no `revokePending` check; `components/versions/version-actions.tsx:76-79` hides Set sunset "while its revoke waits for a second approver, its fate is that" (a business reason, in a comment, in a component). Not in the README's outside-rules table. Fix: a `REFUSALS.revokePending` branch in `setSunset` and `versions.ts`'s `can.setSunset`, so the control is disabled with a reason rather than hidden (the repo's own UI rule).

**L4. `sunsetInstant` throws on a malformed day; the domain relies on the caller's pre-check.** `verified`. `business-zone.ts:124` `throw new RangeError`; `setSunset` runs `isAfterToday` (`"2027-13-45" > "2026-10-04"` is true) before `sunsetOn`, so a malformed day reaches the throw. Guarded today by `actions/review.ts:435, 515` (`isCalendarDay` → `REQUEST_REFUSALS.invalidDate`). Fix: refuse inside `setSunset`/`approve` with `invalid_date` so the rule is complete without its caller.

**L5. `canonicalAction` with a prototype key returns a function.** `measured`. `audit.ts:86-101`: `ALIASES["constructor"]` is `Object.prototype.constructor`, so `canonicalAction("constructor")` is `typeof "function"` and `categoryOf("constructor")` is `"templates"`. `parseAuditFilters` drops such values by accident (`"function Object…" in ACTIONS` is false; measured `{"action":"version.approved"}` for `constructor,toString,version.approved`). D11 lists it as remaining; harmless with current callers. Fix: `Object.hasOwn(ALIASES, action)` or a `Map`.

**L6. Five "a, b and c" joiners, two punctuations.** `verified`. `render/errors.ts:49` `joinWithAnd` ("a, b and c"), `consequences.ts:125` `joinList` ("a, b, and c", Oxford comma), `copilot.ts:36` and `import.ts:597` `andList`, `lifecycle/refusals.ts:16` `listKeys`; plus `components/access/format.ts:4`, `components/redline/blocks.ts:159`, two in `src/simulator`. The README's don't-copy list names three; `joinList` isn't among them and differs in output. Fix: one joiner in the domain (and decide the comma).

**L7. The released-state set is defined twice.** `verified`. `rounds.ts:56` `RELEASED_STATES` and `approval-chain.ts:154` `APPROVED_STATES`, the same three states. Fix: import `RELEASED_STATES`.

**L8. 35 comment lines explain history, not behavior.** `measured`. "Phase 6", "Phase 7a", "slice S3", "build plan", "0005 migration", "handoff review D10" in `access-types.ts` (×5), `golive-types.ts` (×8), `permissions.ts` (×4: "build plan"), `types.ts` (×3), `audit.ts`, `import.ts`, `import-types.ts`, `copilot.ts`, `activity.ts`, `approval-chain.ts:84`, `status.ts:10`. AGENTS.md says "Describe what the code does now, not how it got there." Fix: replace each with the rule it refers to or a decision link.

**L9. Tests pin English copy in ~100 assertions.** `measured`. `toEqual({ ok: false, code, reason: "…" })` appears 23 times in `approval-chains.test.ts`, 20 in `submit.test.ts`, 12 each in `access/requests.test.ts` and `members.test.ts`, 10 in `approve.test.ts`, … The repo's rule is that sentences are "UI copy you can reword freely", but rewording one breaks tests across files. Fix: assert `code` (and `toMatchObject` where the sentence carries data); let `refusals.test.ts` and a per-table test own the sentences.

**L10. `formatShortDate` without `now` never shows the year.** `measured`. `dates.ts:40-49`: `sameYear` is true when `now` is undefined. 17 call sites in `src/components` and `src/server` pass one argument (`request-access.tsx:34,73,83`, `usage-dashboard.tsx:31,105`, …), so a date from a previous year prints "Jan 3". Fix: require `now`, or default to showing the year when it isn't the current one.

**L11. Function-valued refusal entries will not port as data.** `verified`. `refusals.ts:45-58`: a worded refusal is a function with a `.code` property (`Object.assign((...args) => …, { code })`), so `ACCESS_REFUSALS.lastAdmin.code` and `ACCESS_REFUSALS.lastAdmin("Deposits")` both work. Elegant in TypeScript; in Java it is an enum of codes plus a `MessageFormat` per code, and the tables cannot be exported as JSON. Fix (for the port, not the TS): a generated `refusal-codes.json` (code → sentence template) from the nine tables, so both backends read one list.

**L12. README says the domain suite "takes under a second".** `measured`. `README.md:260`; `npx vitest run src/domain` is 2.96 s wall (tests 48%), 4.78 s with `src/editor/model`. Fix: "about three seconds".

**L13. Decision numbering skips 0040.** `verified`. `docs/decisions/` has 0039 and 0041, no 0040, and nothing in `docs/` references 0040. Fix: a one-line note in the decisions README, or renumber.

**L14. Test fixtures live in production folders.** `verified`. `lifecycle/fixtures.ts`, `access/fixtures.ts`, `platform-config/fixtures.ts`, `redline/fixtures.ts`, `messages/GraphemeBreakTest.txt` (796 lines). No production file imports them (measured), so bundles are unaffected, but a Java developer scanning `src/domain` will read `NOW = new Date("2026-10-04…")` as production code. Fix: a `__fixtures__/` or `*.fixtures.ts` naming convention, noted in the README.

**L15. `json-number-text.ts` depends on ES2025 `JSON.parse` source-text access.** `verified`. `render/json-number-text.ts:6-8, 43`: the reviver's third argument (`context.source`) exists in Node 22+/V8; the purity rules don't mention runtime-version requirements. For Java: Jackson with `USE_BIG_DECIMAL_FOR_FLOATS` plus a custom deserializer that keeps the token text, or reject non-string numbers in the API. Fix: note the Node floor in the README and the port note in the file.

## 5. Backlog check

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| I11 UI branches on English sentences | Fixed | Yes | `refusals.ts` codes, `RefusalCode` union, `refusals.test.ts:95-122` source scan; three `.reason ===` hits in `src` compare enum fields, not refusals. verified |
| D3 Chain edits mid-review | Fixed | Yes | `recordStages`/`stageOf`/`approvedThisRound` in `approval-chain.ts`; `approve.test.ts:371-427` covers reorder, insert, rule change, migrated data. verified |
| D6 Sunset means midnight UTC | Fixed | Yes | `business-zone.ts`; `setSunset`/`approve` take `zone`. verified |
| D7 Nothing records a passed sunset | Fixed | Yes | `sweepSunsets`; `sunsetPassed` is the only `sunsetAt <=` comparison in `src` (measured). |
| D8 Variable renames lost | Fixed | Yes | `ContractChange` is a union (`editor/model/types.ts:60-71`); `diffVariables` pairs by identity then key; `submit.test.ts:187`. verified |
| D9 Today/yesterday disagree | Fixed | Yes | `dates.ts` `daysBetween`/`formatAgo`; `consequences.ts:153` uses `formatAgo(precision: "day")`. verified |
| D10 Untyped audit/notice payloads | Open | Yes | `review-types.ts:61-69`, `audit.ts:143-254`, `golive/notices.ts:3-5`. verified (M2) |
| D11 JS-only behavior | Partly fixed | Yes | `localeCompare` in six domain files incl. a business decision (L1); `canonicalAction("constructor")` returns a function (L5, measured). |
| B2 A third of rules outside the domain | Partly fixed | Yes | `decideCheck` (`review-shared.ts:286`) still repeats `approvedEarlierStage`; README's nine-row table verified row by row. One more outside rule found (L3). |
| N16 Two refusal rules outside | Fixed | Yes | `validateAccessReason` exported from `access/requests.ts`; `cannotBeFirstTeamAdmin` in `platform-config/teams.ts` (README table). traced |
| H4 Formatting helpers duplicated | Fixed | Yes for dates/numbers/plurals | One `dates.ts`, `numbers.ts`, `plural.ts`; list joiners still copied (L6). verified |
| H8 Oversized files | Fixed | Mostly | Domain split into folders (decision 0043); `access-types.ts` header still names the pre-split files (M4, new). verified |
| S3 Maker-checker only stops the submitter | Fixed | Yes | `writers` on `DraftFields`/`ReviewVersion`; `makerCheckerRefusal`; `transitions.test.ts:276-338`. verified |
| S7 Comments accepted on any state | Fixed | Yes | `comments.ts` policy with `COMMENT_REFUSALS.closed`. traced |

New, not in the backlog: M1, M3, M5, L1 (as a consequence), L2, L3, L6 (`joinList`), L7, L10, L13, L14, L15, and the stale header in M4.

## 6. For the Java team

**Ports cleanly (translate, don't redesign):**
- `lifecycle/*`: each transition is facts + `now` → `changes` + `effects` or a refusal. Map `Outcome<T>` to a sealed interface (`Ok<T>` / `Refused(code, reason)`), `LifecycleEffect` to a sealed effect hierarchy, and the server's `inTransaction` + `writeEffects` to one `@Transactional` service method. The compare-and-set on `state`, `rev`, `currentStage` becomes `WHERE` clauses or `@Version`.
- `permissions.ts`: two tables (`TEAM_GRANTS`, `PLATFORM_GRANTS`) and four guards; `can()` is 12 lines. Read M1 before porting `PermissionResource`.
- `refusals.ts` and the nine tables: the codes are the contract. Generate a `RefusalCode` enum from them (L11); sentences can live in a message bundle.
- `business-zone.ts`: the Java equivalents are written in the file header; `java.time` does the DST work `sunsetInstant` does by hand.
- `editor/model/variables.ts` value grammar and `golive/json-schema.ts`: regex-defined, no floating point; `BigDecimal` is unnecessary because values stay strings. `longerThan` is `codePointCount`.
- `rounds.ts`: `nextRound`, `headOf`, `versionLabel`; pure integer logic.
- `messages/gsm7.ts`, `graphemes.ts`, `push.ts`: standards-cited; pin ICU4J to Unicode 17.0 as the README says, or port the generated table.

**Needs rethinking before or during the port:**
- Collation: replace every `localeCompare` with code-point or an explicit ordering column; L1 is the one that changes a business outcome.
- Stored English (M3): decide whether notifications and `contractLines` are facts worded at read time (recommended) or rendered strings both backends must match.
- Audit `details` (M2): define the JSON shape per action before mapping it to a JPA entity; today it is whatever each rule wrote.
- `Intl.DateTimeFormat`/`NumberFormat` in `dates.ts`/`numbers.ts` are en-US UTC; `DateTimeFormatter.ofPattern("MMM d", Locale.US)` etc. reproduce them, but the "same year → no year" rule (L10) is a product decision to confirm.
- `render/json-number-text.ts` (L15): decide how the API reads JSON numbers (Jackson token text, or strings only).
- The two effect vocabularies (M5): unify before writing one Java `EffectWriter`.
- `WordedRefusal` function-with-property (L11): an enum plus formatter.

**Read first, in this order:**
1. `src/domain/README.md` (vocabulary table, the lifecycle diagram, "Rules that live outside", "Don't copy").
2. `src/domain/lifecycle/README.md`, then `lifecycle/sunset.ts` and `lifecycle/revoke.ts` with their tests: the transition shape in 200 lines each.
3. `src/domain/permissions.ts` (grants, guards, `can`) and `approval-chain.ts` (a version's own stages, `stageOf`).
4. `src/domain/refusals.ts` and `refusals.test.ts`: the contract and how it is held.
5. `src/domain/rounds.ts` and `business-zone.ts`: the two non-obvious rules (numbers vs rounds; midnight in a zone).

## 7. Files

**Models of good code in this slice**
- `src/domain/lifecycle/sunset.ts`, `lifecycle/revoke.ts`, `lifecycle/refusals.ts`
- `src/domain/permissions.ts`
- `src/domain/refusals.ts`
- `src/domain/dates.ts`, `business-zone.ts`, `plural.ts`, `numbers.ts`
- `src/domain/rounds.ts`
- `src/domain/render/types.ts`, `render/version-rules.ts`, `render/validate.ts`, `render/resolve.ts` (header and structure)
- `src/domain/messages/gsm7.ts`, `messages/graphemes.ts`, `messages/README.md`
- `src/domain/channel-fields.ts` (the registry pattern)
- `src/domain/golive/cursor.ts` (an opaque cursor explained for a second backend)
- `src/editor/model/contract.ts`, `editor/model/variables.ts`, `editor/model/document-check.ts`
- Tests: `lifecycle/transitions.test.ts`, `business-zone.test.ts`, `refusals.test.ts`, `permissions.test.ts`

**Files a human will struggle with**
- `src/domain/access-types.ts` (748 lines, five concerns, stale header, phase scaffolding)
- `src/domain/audit.ts` (686 lines: catalog, 113-line sentence switch over untyped details, filters, CSV, bell fallbacks)
- `src/domain/golive-types.ts` (contract-by-slice comments; the `_DriftChecks` trick needs a sentence of explanation for a Java reader)
- `src/domain/lifecycle/approve.ts` (`approve`, 186 lines)
- `src/domain/access/sweep.ts` (`sweepAccess`, 190 lines; `held`, `set`, `Object.assign … satisfies`)
- `src/domain/redline/align.ts` (25 one-letter `const`s; algorithmic, header helps)
- `src/domain/import.ts` (702 lines; well sectioned, but PDF layout heuristics `HEADING_RATIO`, `TITLE_RATIO`, `EDGE` sit beside placeholder rules)
