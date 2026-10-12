# Quality review (October 12, 2026)

An end-to-end review of Stencil at `main` @ 0cca665, after PR #75, for the handoff to a Java Spring Boot team. It
reviews the state of [handoff-review.md](handoff-review.md) (the October 7 findings backlog), then scores the
codebase on an eleven-point rubric, with readability by a human maintainer as a dimension of its own. The method:
every check in AGENTS.md run on this machine, the full e2e suite, nine parallel reviewers (one per layer, one
driving the running app), and the orchestrator's own spot checks of every claim this page leads with. Evidence tags:
*measured* (a command was run), *verified* (the code was read), *traced* (followed, not run). Line numbers are from
0cca665.

This page is a report, which [docs/README.md](README.md) says does not belong in `docs/`. It is left uncommitted
for the owner to keep, move, or fold into the backlog.

## 1. Verdict

**Overall: 7.2 / 10** (weighted toward the owner's priorities: architecture, correctness, readability, tests and
UX at 1.5, security at 0.5 because its gaps are deferred by design; the unweighted mean is 6.9). A well-built
prototype, in the top quartile of what a dev team inherits, with its risks concentrated in two places: the port (the
data model and the tests are bound to SQLite in ways nobody has written down) and system-level readability (a dozen
files and three READMEs that a human cannot read in ten minutes).

What is genuinely strong: every check is green (typecheck, lint, 5,283 unit tests in 18 s, docs check, build, 379
e2e tests in 3 minutes with zero flakes while nine agents and a second server loaded the machine). The business rules
are pure TypeScript behind a lint-enforced boundary, and their purity holds up to grep. Every mutation runs on one
112-line kit with compare-and-set writes and effects in the same transaction. The render engine is a real seam with a
normative spec, a 60-case golden corpus, parity tests that plant defects to prove themselves, and zero behavioral
disagreement between spec and code in about 35 sampled rules. Refusals carry stable codes and a test fails the build
if any screen compares an English sentence. Accessibility is engineered and measured on every screen as every
persona. The docs' "Don't copy" and "rules outside the domain" lists are true row by row; every one of about 90
backlog statuses spot-checked by the reviewers was accurate.

What holds it back: the schema's hard invariants outside `versions` (last admin, one open recertification, one
pending request, the notice sequence) hold only because one in-process lock serializes every write, and nothing in
the repo says what Azure SQL must do instead. Team ids equal team slugs by a "seed contract" mentioned in six comments
and stated as a rule nowhere. Forty-five server test files and 36 of 50 e2e specs assert through raw SQL, so the test
suite does not survive the backend swap without a service seam. The prose dialect of the comments and READMEs (full
sentences, dense, history leaking in from the build) explains intent well and reads slowly; the editor README still
says "Status: Phase 2 complete". There is no CI, no Node pin, no formatter, and a stale `.next/dev/types` folder on
any working copy that ran the dev server before October 7 turns typecheck and build red until it is deleted.

| # | Dimension | Score | What moves it up |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 8 | B1 (service seam), B2 (ten rules still in the server), the id = slug decision |
| 2 | Correctness & robustness | 8 | Four Medium bugs found (below); none High |
| 3 | Data model & persistence | 6 | Constraints, a `SEQUENCE`, a JSON-column policy, a port-notes page |
| 4 | API & contract | 6 | OpenAPI 3.1 and RFC 9457 problem details, both already planned |
| 5 | UI/UX quality | 8 | Presence and live refresh on two-person flows, paste and import variable typing, the wide-table rule |
| 6 | Readability for humans | 7 | Split five files, retire the phase history, cap doc bullets, add a newcomer guide |
| 7 | Test quality | 8 | Coverage tooling, tests for `pdf-controller.ts`, a seam so tests outlive SQLite |
| 8 | Documentation | 7 | Eight stale claims, one contradiction, no Next.js primer, prose density |
| 9 | Security posture | 5 | All gaps listed and deferred by design; security headers are new and trivial |
| 10 | Tooling & DX | 6 | CI, `.nvmrc`, `.env.example`, formatter, the stale-types trap |
| 11 | Handoff readiness | 7 | Render is the model; data model and test seam are the risk |

The two lenses matter. **As a prototype on SQLite today**, this is an 8: it works, it is tested, and it is honest about
itself. **As the codebase a Java team inherits and ports**, it is a 7: the rules port, the UI stays, but the decisions
that make the port cheap or expensive (ids, JSON columns, stored sentences, the test seam) have not been made.

## 2. Measured baseline

| Check | Result | Time |
| --- | --- | --- |
| `npm run typecheck` | Failed on first run: `.next/dev/types/validator.ts` (dated Oct 7) still lists the `(dev)/design/*` pages removed in 4e69144, and `tsconfig.json` includes `.next/dev/types/**`. Passed after that folder was removed. | 7 s |
| `npm run lint` | Clean | 9 s |
| `npm test` | 285 files, 5,283 passed, 1 skipped | 18.5 s |
| `npm run docs:check` | 74 files, 1,428 links, 753 paths, all good | 1 s |
| `npm run build` | Same stale-types failure, then clean: 44 routes | 17 s (warm) |
| `npm run e2e` | 379 passed, 0 failed, 0 flaky, 4 workers, under heavy concurrent load | 3.0 min |

Size: 643 non-test source files, 83,076 lines (median 86, p90 294; 63 files over 300, 33 over 400); 285 test files;
74 Markdown docs; 50 decision records; 14 migrations; 21 CMS tables. Static health: 0 `any`, 0 `@ts-ignore`, 0
`TODO`, 4 `eslint-disable`, 29 `as Route`, 1 `dangerouslySetInnerHTML` (server-allowlisted HTML), 343 `text-[Npx]`
utilities (H6, growing), 12% comment lines. History: 273 commits, 87 merges (PRs #2 to #75), October 3 to 11, one
author.

## 3. The backlog, re-checked

[handoff-review.md](handoff-review.md) holds 111 findings: 13 Open, 8 Partly fixed, 86 Fixed, 4 Deferred. The table
matches the Status lines (counted). All 27 "Found while fixing" items are Fixed.

- **Every Fixed status the reviewers spot-checked was true in code** (about 90 across the nine slices: S3, S6, S7,
  S8, D3, D6 to D9, R1 to R10, A1, A2, A6, I1 to I15, H1, H3, T2, T3, T5 to T7, G1 to G5, N2, N6 to N27 among them).
  Fixed means fixed here.
- **Every Open, Partly and Deferred status is still accurate**, with three text-level staleness notes: T9's "What
  happens" lists queries that now have tests (library, platform, workspace); T5 says `data/e2e.db` where it is now
  `data/e2e-<n>.db` per worker; H6's count of 382 is now 343 in `src` (410 repo-wide with e2e).
- **Two statuses understate progress:** D10 (untyped payloads) has the typed-per-action mechanism in place for one
  action and the notice effect typed; H8 (oversized files) is fixed everywhere but `content-workspace.tsx`, which the
  status line does not name.
- **Two statuses under-describe the problem:** S5 (consumer header) does not say that every render attempt, including
  an `unknown_consumer` refusal, writes a `render_log` row through the process-wide lock
  (`src/server/render/render-template.ts:150-170`); S10 does not mention that the autosave route answers 404 before
  403 (`src/server/drafts/apply-patch.ts:33-37`).

The backlog is doing its job. The findings below are the ones it does not have.

## 4. New findings, by severity

Severity is in the handoff's context: High means a Java team will be hurt by it or a user can be; Medium means a
maintainer will be; Low is hygiene.

### High

**H-1. Team id equals team slug, an invariant held by convention in six files.** *verified.*
`src/domain/platform-config/teams.ts:95` (`id: slug`), `src/domain/access-types.ts:185`, `src/domain/audit.ts:584`,
`src/server/access-effects.ts:97`, `src/server/queries/spaces.ts:103`, `src/server/queries/access.ts:108`. Hrefs,
`can(viewer, …, { teamId })` calls and SQL filters interchange the two; a team can never be renamed without changing
its primary key. A JPA entity with a surrogate key breaks every stored notification link and every permission check
fed a slug. Fix: decide now (keep `id = slug` with a CHECK and a decision record, or split them and pass `teamId`
everywhere); remove the "(seed contract)" comments; state the rule in `docs/architecture.md`.

**H-2. Business invariants hold only under one process-wide lock, and no page says what the port must do.** *verified,
measured.* The notice counter (`takeNoticeSeqs`, `src/server/effects.ts:265-284`) is read-then-write on a `settings`
row; last-admin, one-open-recertification and one-pending-request are read-check-write with no constraint; the schema
snapshot has 0 CHECK constraints on any table; `rowid` tiebreaks in three queries, `strftime` buckets
(`queries/usage.ts:55`), `BEGIN IMMEDIATE`, NULL-distinct partial unique indexes and millisecond-integer timestamps
are each load-bearing. Safe today because `src/lib/serialized-writes.ts` serializes every write in the process. On
Azure SQL (read-committed snapshot by default) with two instances, two `takeNoticeSeqs` read the same number and the
unique index turns a consumer notice into a failed commit, which breaks the "never miss a revoke" promise (A2). B3
and B4 cover the mechanics; what is new is that `docs/architecture.md` and the server README describe what SQLite
does and never what the replacement must. Fix: a one-page "porting the data model" record: `SEQUENCE` for `seq`,
filtered unique indexes as Flyway SQL (with `WHERE number IS NOT NULL`, since MSSQL treats NULL as a value), CHECKs
on every enum column, `(at, id)` ordering, `CAST(at AS DATE)`, `rev` as `@Version`, and the JSON policy from M-9.

**H-3. The test suites are bound to SQLite and will not survive the backend swap.** *verified.* All 45
`src/server/**/*.test.ts` run on a real libSQL copy; 36 of 50 e2e spec files assert through raw SQL
(`e2e/helpers/golive.ts` 39 statements, `scenario-03.spec.ts` 37, `scenario-06` 21, `phase-6-two-stage` 18). When
`src/server` becomes a BFF over Spring, the server unit tests and most e2e assertions lose their seam. This is the
cost side of B1 and of the owner's parked "unit tests should mock the data layer" goal. Fix: before the port,
introduce the service interfaces B1 describes, route the e2e state assertions through `/api/v1` and the admin screens
where possible, and keep the raw-SQL ones behind one helper that can be swapped for JDBC checks.

**H-4. The editor README is 18% phase history and its status header is false.** *measured.* `src/editor/README.md:8-12`
("Status: Phase 2 complete, ready to lift; Phase 4 adds…"), `:24` ("Public API (frozen for Phase 2)"), `:521-643`
(eight "Changes since Phase N" sections, 123 of 690 lines). `docs/README.md` names this file as the model for depth
while forbidding exactly this ("Don't explain through history"). Fix: delete the status sentence and the eight
sections; move the three choices worth keeping (markers drawn as text, the guard's single invariant, chips store only
a key) to decision records. Also remove the 31 "Phase N" mentions outside `docs/archive/` (18 in `src/server`
comments, 35 lines in `src/domain`, five in the editor).

**H-5. `pdf-controller.ts` (590 lines) is the most intricate imperative code in the UI and has no test.** *measured.*
`src/components/preview/pdf/pdf-controller.ts`; `pdf-viewer.test.tsx:12-24` mocks the class away. Superseding loads
with abort signals, a double-buffered swap, two IntersectionObservers, a render queue, idle text fill. It also feeds
the approve gate (`onPdfShown` counts a PDF as viewed). Fix: extract `visibleIndices`, queue ordering and the
generation logic as pure functions with tests; test `load/adopt/cancelIncoming` against a fake pdf.js runtime
(`load-pdfjs.ts` already isolates it).

**H-6. `ContentWorkspace` has 24 props and seven concerns in one 330-line function.** *measured.*
`src/components/workspace/content/content-workspace.tsx:44-100, 118-486`. Draft binding, revert with scroll
preservation, threads and composer focus (two nested `requestAnimationFrame`s at 262-279), live-draft creation,
message-vs-document branching, rail and preview wiring, 14 `useCallback`s. Decision 0043's own test ("one sentence
says what the file holds") fails here; H8 is marked Fixed without naming it. This is the screen authors live in. Fix:
`useContentRevert`, `useContentComments`, and a props object per concern, as `ReviewWorkspace` was split.

### Medium

**Correctness**

- **M-1. Two retry layers compound into a worst case of about 90 s.** *verified.* `src/lib/serialized-writes.ts:29`
  waits 15 s per turn on the lock, then fails `SQLITE_BUSY`; `inTransaction` (`src/server/effects.ts:301-310`) and
  its copy in `drafts/apply-patch.ts:68-77` retry five more times. Six attempts × 15 s before the generic failure;
  server actions have no timeout. The README describes a 15 ms retry. Fix: one place waits and fails fast; delete the
  copy (the README's "Don't copy" already asks); document the worst case.
- **M-2. Import throws where it should refuse.** *verified.* `src/server/import/create.ts:96-97` `throw new
  Error(chosen.reason)` answers 500; `createTemplate` handles the same domain result with `refuse(chosen)`. Fix:
  `return chosen`.
- **M-3. Three answers for "you may not read this section".** *verified.* Team sections throw `PermissionError`
  (`queries/access.ts:117-124`, no boundary catches it, so the tab shows "This tab didn't load"); platform sections
  and the audit page `notFound()`; `requireSpace` redirects. Fix: one `requireCan(viewer, action, resource)` →
  `notFound()`.
- **M-4. Pasting Markdown text containing U+0000 throws.** *measured.* `src/editor/paste/markdown.ts:293-321` uses
  `\u0000N\u0000` placeholders; `markdownToHtml("a\u00000\u0000b **x**")` throws inside `clipboardTextParser`, so the
  paste fails instead of landing as text. Fix: strip `CONTROL_CHARACTERS` first.
- **M-5. Word and Google Docs paste drop list numbering; Markdown paste keeps it.** *verified.*
  `paste/normalize-html.ts:430` reads the marker only to choose `ol`/`ul`; `markdown.ts:267` writes `<ol start>`. A
  Word list "(a) (b) (c)" pastes as "1. 2. 3." and "see 2(b)" references break silently. The backlog names it in
  "Follow-ups" without a number. Fix: map the captured marker to `start`, `data-marker-format` and
  `data-marker-delimiter`, which `ListNumbering.parseHTML` already reads; give it a finding number.
- **M-6. "A required section heading is an H2" is assumed in three modules, stated nowhere, enforced nowhere.**
  *verified.* `editor/model/usage.ts:143`, `editor/lib/sections.ts:34`, `editor/extensions/section-paste.ts:84` vs
  `required-sections.ts:219` (`requiredKey` on any heading) and the spec (silent). Producers always write level 2
  today. A Java validator built from the spec would accept documents the editor treats inconsistently. Fix: write the
  rule into `docs/render-spec.md` §2 and `documentProblem`.
- **M-7. The `/api/v1` GET handlers answer a non-JSON 500 (A4), and `unknown_consumer` attempts write a log row
  (S5).** *verified.* Both already in the backlog; listed here because the second is write amplification through the
  process lock from anonymous callers. Fix: a `withApiErrors` wrapper; return before `renderVersion` for
  `unknown_consumer` as the route does for `bad_request`.

**Design and the port**

- **M-8. `PermissionResource` is a bag of optional fields.** *verified.* `src/domain/types.ts:174-200`,
  `permissions.ts:89-128`: maker-checker runs only when the caller passes `submittedBy` and `writers`; a new
  `can("version.decide", { teamId })` compiles and grants. Safe by convention today; a Java port with one `Resource`
  DTO inherits the footgun. Fix: a resource type per guarded action, or `can` throws when a guarded action lacks its
  facts.
- **M-9. Seven of sixteen JSON columns are relational-shaped; two payload columns are untyped (D10).** *verified.*
  `versions.stages`, `versions.writers`, `versions.channels`, `versions.revoke` (ISO dates in a row of integer
  dates), `approvals.sample_sets_seen`, `content_types.allowed_channels`, `approval_stages.approver_rule`. The data
  reviewer's position, which this review shares: keep row-per-round (decision 0033 is right) and narrow `versions` by
  about six columns (`version_writers`, `version_stages` tables; `revoke_*` columns). Decide per column before
  entities are written.
- **M-10. English sentences are built in the domain and stored in effects.** *verified.* Notification titles
  (`lifecycle/sunset.ts:93`, `approve.ts:139,200,210`, `revoke.ts:56,90`, `access/sweep.ts:129-175`) and
  `contractLines` in consumer-notice payloads are produced by rules and written to `notifications` and
  `consumer_notices`. The refusal design (code plus a reword-able sentence) is not applied here, so a Spring backend
  must reproduce the wording character for character or the bell and consumers diverge. Fix: store facts, word at read
  time, as `describeAuditEvent` already does.
- **M-11. Two effect vocabularies and two writers.** *verified.* `LifecycleEffect` (`review-types.ts:61-140`) and
  `AccessEffect` (`access-types.ts:124-209`), written by `effects.ts` and `access-effects.ts`. One Java `EffectWriter`
  implements both. Fix: one union, one recipients type, one writer.
- **M-12. Missing indexes for hot filters; two unbounded loads.** *verified.* `approvals` has no index (four queries
  filter on `version_id`); `comments` none (`threads.ts:105`); `memberships` is indexed only by `(user_id, team_id)`
  while 11 call sites filter on `team_id`; `audit_events` has no `template_id` index although the Activity tab filters
  on it. `queries/library.ts:71-84` loads every version of every team for any space; `audit.ts:215-235` loads the whole
  log. Fine at seed scale; not a pattern to port. B3 lists three of the four indexes.
- **M-13. The seed's id determinism is a trap the repo has fallen into four times.** *verified.* One shared PRNG
  (`seed/context.ts:118-155`) means a row added before a template re-ids everything after it; 14 template ids are
  pinned by e2e, goldens and screenshots. Workarounds: `keyedId`, "alerts built last", the `ERRORS` entry that must
  stay last, `pushPlatformOf(counter)`. Fix: literal ids in `SeedTemplate`, so a Java fixture can carry the same ones.
- **M-14. `settings` is a sequence, a platform setting and two demo switches in one JSON key-value table.**
  *verified.* `consumer_notice_seq`, `business_zone`, `clock_offset_days`, `seed_version`, `seeded_at`. Nothing marks
  which is which. Fix: a typed `platform_settings` row, a `SEQUENCE`, demo state in its own place.
- **M-15. No JSON Schema for the stored document.** *verified.* The limits (`document-check.ts`) port line by line;
  the parse step (where each node may go) exists only as ProseMirror content expressions in `src/editor/schema.ts` and
  TipTap's kits. Block ids are UUID v4 via UniqueID, unstated in the spec. Fix: generate a JSON Schema from
  `editorSchema()` at build time and test that it agrees with `parseWithSchema` on the golden documents; or decide
  that document validation stays in the BFF.
- **M-16. The golden corpus has holes a Java engine falls through.** *verified.* No `invalid_values`-only case, no
  1,000-character refusal (`maxLength` in no golden), no push or SMS field-shape refusal, no `round`-labelled preview,
  no RTL or CJK text. Of the five error codes the engine itself returns, one has no golden. Fix: add
  `error-invalid-values-only`, `error-value-too-long`, `error-push-field`, `error-sms-field`, a `round` fixture, and a
  web/email-only `characters-scripts` case.
- **M-17. `src/domain/render/types.ts` contradicts the spec in two comments, and the spec calls it its TypeScript
  form.** *verified.* `:52` says trailing hard breaks "are stripped"; spec §4/§8, `resolve.ts:419-423` and the
  `spaces-and-breaks` golden keep them. `:33-36` lists a far narrower invisible-character set than §4. Fix: rewrite the
  two comments.
- **M-18. The render spec leans on history a Java reader cannot resolve.** *verified.* §7 "before this change", §10
  "pagination rules are unchanged", §11 "(as today)", §14 a 35-row Before/Now table; pagination constants exist only in
  `pdf.tsx`. Fix: move §14 to the archive; label pagination "Node engine only".
- **M-19. The PDF lower layers depend on library internals, on caret ranges.** *verified.* `pdf-fonts.ts` patches
  react-pdf's registry and primes fontkit's private glyph cache; `pdf.tsx:80-90` byte-patches `/ModificationDate`;
  `package.json` has `@react-pdf/renderer ^4.9.0`, `pdfjs-dist ^6.4.299`. Correct and tested; a minor bump fails in
  ways only those tests explain. Fix: pin exactly and say why in a comment; split `breakLines` (`pdf-text.ts:222-329`).

**Security**

- **M-20. No security headers anywhere.** *verified.* No `proxy.ts`, no `headers()` in `next.config.ts`: no
  `Content-Security-Policy`, `frame-ancestors`, `Referrer-Policy`, `Strict-Transport-Security` on app pages. The
  static headers are trivial. A page CSP is structural under Cache Components (a nonce needs dynamic rendering), so the
  team should choose early between a hash-based CSP, `'strict-dynamic'`, or none.
- **M-21. Small ordering and oracle issues.** *verified.* The notices route answers 404 `consumer_not_found` before
  403 `consumer_mismatch`, so any consumer can enumerate consumer ids; the preview route buffers up to 1 MB before
  `getViewer()`; the persona cookie has no `httpOnly` or `secure`. Each trivial; do them with sign-in.

**Readability and maintainability**

- **M-22. Three big "contract" type files still read as the agent briefs they were.** *verified.*
  `src/domain/access-types.ts` (748 lines: header says "every Phase 6 agent codes against this file" and names
  `domain/access.ts` and `domain/platform-config.ts`, which decision 0043 removed; five concerns; `PlatformConfigDomain`
  and `AuditDomain` interfaces whose only use is `satisfies` checks), `golive-types.ts` (392: "slice S1/S2/U3", 60
  lines of signature comments restating code elsewhere), `import-types.ts`. Fix: delete the `*Domain` interfaces, move
  read models beside their queries (decision 0042), rewrite the headers.
- **M-23. The files a human will struggle with most.** *verified.* `queries/usage.ts` (559 lines, two 130-line
  functions, Maps keyed by `${a}#${b}`, one-letter loop variables), `queries/review-shared.ts` (seven concerns),
  `getReviewScreen` (four "baseline" concepts in one function), `seed/templates/build.ts` (one 370-line function),
  `editor/components/block-menu.tsx` (524 lines, eight components), `editor/components/document-editor.tsx` (a
  module-level dynamic-import cache, six refs, Activity lifecycle), `render/golden/content.ts` (788 lines, five
  concerns, named as the Java reference), `pdf-text.ts`, `pdf-fonts.ts`, `comments/thread-list.tsx`,
  `workspace/content/rail.tsx`, `session-store.ts` (fine, but budget 30 minutes). Section 5 says what to do.
- **M-24. Coordination by timing in five UI files.** *verified.* `workspace-actions.tsx:456` awaits `setTimeout(0)`
  for a status; `gutter-markers.tsx:561-570` polls 30 frames for the editor handle; `content-workspace.tsx:271-279`
  double rAF; `thread-list.tsx:142-171` a `FocusRequest` with frame deadlines in an effect with no dependency array;
  `settings/platform/ui.tsx:22-34`. Each works because of a specific commit order; each is the first thing to break on
  a React or Base UI upgrade. Fix: `session.flush()` resolves with the outcome; registrations instead of polls.
- **M-25. Three idioms for "blocked, with reason".** *verified.* `BlockedButton` (the primitive) vs a native-`disabled`
  button inside a focusable `<span>` in `settings/team/rows.tsx:232-250` and `settings/platform/ui.tsx:85-96`. The
  checklist forbids native `disabled`; `one-copy.test.ts` has no pattern for it. Fix: use the primitive; add the pattern.
- **M-26. `src/lib` breaks two stated rules.** *verified.* `serialized-writes.ts` constructs the libSQL client (so
  "only `src/server` imports the database client" is false at the factory); `fresh-database.ts` imports `vitest` in app
  source. Fix: move both under `src/server`.
- **M-27. `Date` objects cross to client components from the settings read models.** *verified.*
  `access-types.ts:61-100` (`MemberRow.addedAt: Date`); newer read models send ISO strings. Two wire shapes for one
  set of Java DTOs. Fix: ISO strings at the query boundary.

**Documentation and DX**

- **M-28. Eight stale documentation claims, one a contradiction.** *measured.*

  | Claim | Where | Reality |
  | --- | --- | --- |
  | `npm run e2e` "resets the shared demo database" | components/README.md:396-397 | It never touches it (AGENTS.md:26, architecture.md, decision 0050, `e2e/storage.ts`) |
  | `npm test` "about 10 seconds" | AGENTS.md:22, architecture.md:236 | 18.5 to 19.4 s measured |
  | e2e "about 4.5 minutes (11 with one worker)" | AGENTS.md:26, architecture.md:244 | 3.0 min measured; decision 0050 says 3.0 |
  | `save-status.tsx` imports `@/editor/lib/platform`, "not in the editor's public API" | components/README.md:355 | It is in the table and `EDITOR_PUBLIC_MODULES` |
  | "this layer's 75 files" of tests | components/README.md:378 | 106 (109 with hooks and lib) |
  | Channel fields: "today only Email's subject and preheader" | server/README.md:137 | Push and SMS fields exist (decision 0034) |
  | Platform sections: four named | app/README.md:66 | `time-zone` is a fifth |
  | `scripts`: three named; `src/lib`: two things | architecture.md:26,28 | Also `golden-import.ts`, `unicode-graphemes.ts`, `seed-reporter.ts`; also `fresh-database.ts`, `template-reads.ts` |

  Also: `access-effects.ts:144` says SQLite "enforces the cascade only with foreign_keys on"; libSQL opens with it on
  (measured) and the cascade would fire. `effects.ts:297` and `apply-patch.ts:64` say the client "has no busy
  timeout"; `createAppClient` sets 5 s. The domain README's "under a second" is 3 s. `docs:check` cannot see any of
  these; it checks paths, not statements.
- **M-29. No onboarding path for a Java developer new to the App Router.** *verified.* The reading order exists and
  the domain Vocabulary is a good glossary. Missing: a 20-minute explanation of server components, why `"use server"`
  makes a public endpoint, streaming and hydration, why `cookies()` outside Suspense is a build error, `cache()` and
  `connection()`; a "your first change" walkthrough; a README for the e2e folder; how to debug a server action;
  troubleshooting beyond `db:reset`. AGENTS.md's answer is "read `node_modules/next/dist/docs/`" (about 100 files).
- **M-30. Prose density.** *measured.* `src/server/README.md:198` is one bullet of 3,692 characters;
  `components/README.md:63` a table cell of 1,705; `domain/README.md:48` a cell of 1,003; `components/README.md:235-263`
  one 29-line paragraph. Accurate and never padded, written for grep rather than reading. Fix: a cap of about 600
  characters per bullet or cell; subsections with headings.
- **M-31. Tooling gaps beyond T4.** *measured.* No formatter (no Prettier, Biome or `.editorconfig`; lines run to
  160+ characters); POSIX-only npm scripts (`GOLDEN_UPDATE=1 …`, `E2E_WORKERS=1 …` fail in PowerShell); 286 vendored
  agent-skill files (36k lines) and 14 tracked symlinks under `.agents/` and `.claude/skills/` that a Windows checkout
  mangles; `allowedDevOrigins` in `next.config.ts` holds the owner's LAN and tailnet addresses; `public/` still has the
  five create-next-app SVGs; three git author identities.
- **M-32. The stale `.next/dev/types` trap.** *measured.* `tsconfig.json` includes `.next/dev/types/**/*.ts`; `next
  typegen` regenerates `.next/types`, not `.next/dev/types`. Any working copy that ran `next dev` before the design
  pages were removed has a red typecheck and build until `rm -rf .next/dev/types`. Fresh clones are fine. Fix: a
  `pretypecheck` step that removes it, or a README troubleshooting line.
- **M-33. Runtime paths assume the dev machine (T8), plus one T8 does not list.** *verified.* `pdf-fonts.ts:47-59`
  reads fonts from `process.cwd()/node_modules`; `import/store.ts:25` uploads from cwd; `import/isolate.ts:20` resolves
  the convert worker from `process.cwd()/src/server/import/convert-worker.mjs`, so every import fails as `unreadable`
  when deployed from a build output.

### Low (selected)

- `approve` refuses a bad `sunsetPrevious` even when nothing is Active (`approve.ts:103`); `setSunset` does not know
  about a pending revoke, the rule lives in `version-actions.tsx:76-79`; `sunsetInstant` throws on a malformed day and
  relies on the caller's `isCalendarDay`.
- `newTemplateContentType` picks a content type by `localeCompare` (`lifecycle/drafts.ts:94-97`): a business outcome
  decided by ICU collation (D11's one consequential case).
- `canonicalAction("constructor")` returns a function (`audit.ts:86-101`); use `Object.hasOwn`.
- About 100 test assertions pin English refusal sentences the repo says are free to reword.
- Five list joiners with two punctuations; `RELEASED_STATES` and `APPROVED_STATES` define the same set.
- `formatShortDate` without `now` never shows the year (17 call sites).
- The glyph-coverage cache in `pdf-fonts.ts:174` has no eviction (its sibling does); react-pdf concurrency under
  parallel requests is unverified.
- A chip inside a required heading can never follow a key rename (`required-sections.ts:100-105`).
- `@modal/[...catchAll]` makes `/[team]/[...catchAll]` a typed route, so typed routes accept any `/<team>/<anything>`
  literal; of 29 `as Route` casts, most are unnecessary and none hides a broken link today.
- No `not-found.tsx` for `/sim` or the root; Coral's `getSimHome` fans out N+1 API calls on every `/sim` page.
- `Stream` imports `ViewTransition` from `react`, which only Next's vendored React exports; by design in Next 16,
  undocumented in the file, and the reason the one streaming boundary cannot be unit-tested.
- Decision numbering skips 0040. Test fixtures live in production folders (`lifecycle/fixtures.ts` and four more).
- `happy-dom` is a runtime dependency on purpose (server import sanitizer and golden checks); confirm it is wanted.
- `npm audit`: 3 moderate in production (`sprintf-js` via `mammoth`), 9 high in dev tooling only.
- One grapheme conformance test is 7.9 s, 40% of the unit run.

## 5. Readability for humans

This dimension gets its own section because it is the owner's explicit concern and because the code was written in
nine days, largely by agents, for a team of humans to keep.

**At the file level, this is readable code.** Median file 86 lines, p90 294. Names are English words (`held`,
`waiting`, `writers`, `spokenFor`, `nowMs`); one-letter names appear only in short callbacks and in the few files
named below. No `any`, no suppressions, no TODOs, 12% comment lines (23% in the domain, 15% in components, 9% in
editor components). Every module opens with a header that states its contract, usually with examples. The small files
teach: `actions/kit.ts`, `use-action-run.ts`, `lifecycle/sunset.ts`, `permissions.ts`, `refusals.ts`, `dates.ts`,
`business-zone.ts` (with the Java equivalents in its header), `engine.ts`, `resolve.ts`, `cursor.ts`, `read-body.ts`,
`members-table.tsx`, `autosave-scheduler.ts`, `settled.ts`, `docs-check.ts`, `schema/ucomp.ts`, `ids.ts`. Every
reviewer's "models of good code" list is longer than its "struggle" list.

**At the system level, it is slow to learn, for three reasons.**

1. **The dialect.** Comments are full prose sentences that explain intent ("A re-render or a tab switch binds the same
   draft again; only a new version starts a session."), never JSDoc tags, rarely types. This is better than most code
   comments and consistent across 165k lines, but it reads at reading speed, not scanning speed, and a Java developer
   looks for `@param` and finds none. The READMEs share the voice and push it further: bullets of 1,000 to 3,700
   characters, table cells that are paragraphs. Recommendation: keep the style, cap the length, and add one paragraph
   to each README on how to read a file here (header = contract, `/** */` on exports, `//` for a decision at a line).
2. **Concentration.** About a dozen files hold the hard state and mix concerns: `content-workspace.tsx`,
   `session-store.ts`, `pdf-controller.ts`, `thread-list.tsx`, `rail.tsx`, `queries/usage.ts`, `review-shared.ts`,
   `getReviewScreen`, `seed/templates/build.ts`, `block-menu.tsx`, `document-editor.tsx`, `golden/content.ts`,
   `pdf-text.ts`, `access-types.ts`, `golive-types.ts`, `approve.ts` (186-line function), `sweepAccess` (190). Each
   is commented and tested; none is readable in ten minutes. Decision 0043 licenses splitting by concern; six of these
   fail its own test.
3. **History in reference material.** The editor README's status header and changelog, 31 "Phase N" mentions outside
   the archive, type-file headers addressed to "every Phase 6 agent", "(Sri, Oct 5)" and "slice S2" in comments,
   e2e headers "Phase 1 gate". A newcomer reads orchestration history as architecture. One hour of sweeping fixes it.

**TypeScript idioms a Java developer will trip on**, worth a paragraph in a newcomer guide: `NonNullable<Awaited<
ReturnType<typeof findVersion>>>`; `?? refuse(…)` as an expression; `team ??= teamSlug(tx, ctx)` memoizing a Promise;
function-valued refusal entries with a `.code` property; closures as state in `session-store.ts`; `useSyncExternalStore`
with a server snapshot; `key={shown.gen}` remounts; `data-slot` attributes as the e2e selector contract; two Proxy-based
files in `src/lib`; `"use client"` as a file-level boundary.

**What is honest about the docs** deserves saying: every "Don't copy" entry and every row of "Rules that live outside
`src/domain`" matched the code; the decision records (50, with dated amendments instead of rewrites) are the best any
reviewer had seen in a prototype; `docs:check` keeps 1,428 links true in 0.3 s. The staleness is in statements
`docs:check` cannot see.

## 6. Layer by layer

| Layer | Scores (arch · correct · read · tests · docs · handoff) | In one paragraph |
| --- | --- | --- |
| `src/domain` | 8 · 8 · 7 · 9 · 8 · 7 | Purity holds to grep; 1,537 tests in 3 s with the 36-cell transitions table; refusal codes provably unique with a source scan against sentence comparisons. Weak spots are the three big type files, untyped payloads (D10), stored English, `PermissionResource`. |
| `src/server` (actions, queries, drafts, import) | 7 · 8 · 7 · 8 · — · 7 | All 21 actions on one kit; `tx` never `db` inside transactions; CAS on every lifecycle write; races tested. B1/B2 still true; id = slug; `usage.ts` and `review-shared.ts` are the hard reads. |
| Data model | — · 7 · 7 · 7 · 7 · 6 | Version invariants in the database; FKs enforced at runtime (measured); hand-written migrations with prose. No CHECKs; invariants under one lock; 7 relational JSON columns; no port notes; the seed's id trap. Entity map in the data report. |
| Render | 9 · 8 · 7 · 9 · 8 · 8 | The model for the rest: a DB-free engine, a normative spec, 60 goldens, parity that proves itself, determinism across processes, 1,222 tests in 4 s. Holes in the corpus; two stale `types.ts` comments; the PDF lower layers. |
| Routes, API, simulator | 8 · 7 · 7 · — · — · 7 (security 5) | 22 synchronous pages, 19 one-screen handlers, body caps counted not declared, Coral really over HTTP. TypeScript-only contract, three error shapes, no security headers, deferred identity. |
| `src/components` | 8 · 7 · 6 · 7 · 8 · — (UX 8) | One action path; screens render server decisions; a11y engineered and e2e-measured; 1,035 tests in 6 s. Concentration in the workspace, timing coordination, untested PDF controller. |
| `src/editor` | 8 · 8 · 7 · 8 · 6 · 7 | Framework-agnostic claim holds (28 = 28 modules, portability test); model matches spec §3 row for row; 966 tests drive a real ProseMirror in 3 s. README history; the H2 assumption; no JSON Schema; two 500-line components. |
| Tests, tooling, docs | — · — · 6 · 8 · 7 · 6 (DX 6) | Seeded shuffle with replay, DB per test, goldens, principles matrix, 4 `waitForTimeout` in 50 specs. No CI, pin, env template, formatter, coverage; SQLite-bound; dense prose; no newcomer path. |

## 7. UX walkthrough

One reviewer drove the production build (port 3200, its own database) with headless Playwright as nine personas,
end to end: edit, two-writer conflict, submit, maker-checker refusal, the approver's output gate, comments, send-back,
round 2, approve with a sunset, Coral link and deliver, two-person revoke, audit CSV, then a 31-day clock jump
(sunset passed, recertification lapse, auto-suspension) and a reset. About 160 page loads and actions, 265
screenshots, `curl` against `/api/v1`, axe on 11 pages. The twelve most informative screenshots are in
[quality-review-2026-10-12/screens](quality-review-2026-10-12/screens/).

**What it found working.** Every flow completed and every state the demo script promises exists. Zero console errors
from the app's own code; zero failed requests beyond deliberate probes; **zero axe violations** on 11 pages (WCAG 2.1
AA plus best practice); **cumulative layout shift exactly 0** on seven pages across two runs, on client navigation and
on every workspace tab; the 320 px reflow holds everywhere, including a 320×256 dialog. TTFB 1 to 2 ms, first paint
32 to 72 ms, network idle under a second on every key page; a 10,000-word paste rendered in 34 ms and previewed as a
PDF in 538 ms. The consumer API answered every probe with the right status and a machine-readable body: missing values
422 with `details.missing`, in-review 409, revoked and sunset 410, 3 MB body 413, a 1,500-character value 422 with
`maxLength`, XSS values escaped, a JSON number `21.90` rendered as "21.90%". The repo's own UI rules (one black button,
status words only in `StatusBadge`, disabled with reason, tokens) held on every screen checked.

**The best interactions, specifically:** the approver's output gate (Approve greyed with "Preview PDF, Web and Email
first.", a check per channel as each renders, then the button turns black; alerts insist on Push on both phones and
SMS); consequences spelled out before commit ("Coral rendered v1 512 times in the last 30 days. Once confirmed, its
renders will fail immediately."); the two-person revoke with the starter's Confirm greyed and the reason as tooltip; the
conflict state that turns the page read-only in place with Reload; the Share ring's integration sheet, from which a
consumer team can integrate alone; the time rules lining up after the clock jump on Versions, Activity, Coral and
Members at once.

**New findings from the walkthrough** (none High; the first two deserve a decision record):

- **UX-1 (Medium). Every not-found and forbidden page answers HTTP 200.** `notFound()` runs inside the stream after
  the static shell has gone out with 200 (a Cache Components consequence), and `/api/v1/nope` answers Next's HTML.
  Dynatrace and uptime checks will never see a BFF 404. Decide the not-found cases before streaming, or record the
  decision and key monitoring on the body.
- **UX-2 (Medium). Pasting `{{any_key}}` silently creates a required Text variable per key.** Fifty unknown
  placeholders became fifty required variables in one frame with no message; a typo becomes a breaking contract change
  noticed only at Submit. Intended for the Copilot flow (`src/editor/paste/markdown.test.ts:196`). Show a one-line
  report after a paste that created variables; consider creating them optional until confirmed.
- **UX-3 (Medium). Imported variables are all typed Text, rates and dates included.** "Purchase APR" from a DOCX or
  PDF renders `21.99` rather than `21.99%` unless the author retypes each; the Copilot prompt repeats the wrong types.
  Infer from the placeholder name, or block Submit while an imported variable is "Text (unconfirmed)".
- **UX-4 (Medium). No presence signal before a two-writer conflict, and the loser's post-conflict keystrokes are gone
  after Reload.** The handling is honest (I6 is fixed) but there is no "Priya is editing" hint and no way to keep the
  unsaved text. The `writers` column already exists; show the other writer and keep the text in a disclosure.
- **UX-5 (Medium). Screens never refresh after another user acts.** Two seconds after Alex confirmed a revoke,
  Jordan's Versions tab still offered Confirm and Withdraw; the compare-and-set refuses the stale click, so no harm,
  but on a two-person flow the second person's screen is exactly where the first is looking. Refresh on window focus
  or after a notification.
- **UX-6 (Medium). A 12-column table is squeezed, not refused.** One letter per line in the editor with the rail
  open, about 6 pt in the PDF, against the repo's own rule to restrict in the editor rather than render approximately.
  Cap columns per content type at the control, or give the canvas and PDF a minimum column width.
- **UX-7 (Medium). 405 KB of web fonts on every page, and "preloaded but not used" warnings on every navigation.**
  Six `.woff2` files on every route; JS is reasonable (editor 674 KB gzip, Library 357 KB plus 329 KB prefetch). Subset
  the display face and preload only what first paint uses.
- Low: the members table hides controls for roles that may not act (the checklist says disable with reason); the
  template name is cut at 120 characters silently; the Library filter has no "Changes requested", "Superseded" or
  "Revoked" chip; comment quotes are not snapped to word boundaries; an unknown optional key in a render request is
  accepted silently; the Submit dialog takes about 3 s to open on a 55-variable, 10,000-word draft with no pending
  state; no skip-to-content link; an author can resolve a reviewer's thread during review (a policy in
  `src/domain/comments.ts`, so a product decision to record either way).

**Backlog spot-check from the outside:** N4, N8, N10, N11, N12, N13, N22, N24, N25, N27, I6, I10 and I13 all behaved
as their Fixed status says.

## 8. Decisions the Java team needs before writing entities

Consolidated from the slice reports. Each is a product or architecture decision, not a bug.

1. **Team ids.** Keep `id = slug` (with a CHECK and a decision record) or split them (H-1). Same question for
   `users.id` (slug today) vs the Entra object id.
2. **JSON column policy, per column** (M-9): which stay `NVARCHAR(MAX)` with `ISJSON`, which become tables
   (`version_writers`, `version_stages`, `approval_sample_sets_seen`), `revoke` as columns.
3. **The notice sequence** as a `SEQUENCE`; the two "one open" rules as filtered unique indexes; CHECKs on every enum
   column (H-2).
4. **Timestamps:** `DATETIME2(3)` or `BIGINT` epoch ms; ISO strings at the read-model boundary either way.
5. **Stored sentences** (M-10): facts worded at read time (recommended) or rendered strings both backends must match.
6. **Audit and notice payload shapes** (D10): a discriminated union per action and kind, before mapping to JPA.
7. **Document validation** (M-15): JSON Schema generated from the editor schema, or validation stays in the BFF and
   the Java API trusts it.
8. **JSON number source text** in `/api/v1` render values: raw token text in Jackson, or strings only.
9. **The `/api/v1` error shape:** RFC 9457 for `/api/v1`, and the preview route changes in the same PR.
10. **Consumer identity:** client credentials at a gateway; `unknown_consumer` writes no log row; rate limiting.
11. **Search paging** (`consumer-api.ts:99-155`): rank is computed in JS and cannot be a plain SQL keyset; compute it in
    SQL with a binary collation, or accept in-memory paging with a cap.
12. **Logs:** `render_log` (31k rows in 90 demo days) and `audit_events` as partitioned tables or Dynatrace / Log
    Analytics, with the relational copy kept for the Audit screen and the 30-day notice window.
13. **The PDF engine:** PDFBox or equivalent, its own line breaking under the spec's rule, its own glyph check, and the
    enterprise font coverage written into `docs/render-spec.md` first (R3).
14. **The test seam** (H-3): service interfaces in `src/server` with the Drizzle code as the local implementation and
    an HTTP one beside it, before the port starts.
15. **Test data:** literal ids in the seed spec; a Java fixture from the same declarative shape as `SeedTemplate`.

The data-model reviewer's report
([quality-review-2026-10-12/reports/data-model.md](quality-review-2026-10-12/reports/data-model.md)) carries a
complete entity map: 21 app tables and 5 simulator tables with keys, FKs, indexes and every JSON column's domain type.
It belongs in `docs/reference/` as the handoff's schema page.

## 9. Recommended order of work before handoff

Ordered by what protects the team most per hour spent.

1. **Make it green from a clean machine** (a day): a CI workflow (typecheck, lint, docs:check, test, build, e2e at
   `E2E_WORKERS=2`; about 8 to 12 minutes), `.nvmrc` 24 and `engines`, `.env.example`, Prettier or Biome with a format
   check, `cross-env` in scripts, a `pretypecheck` that removes `.next/dev/types`, stop tracking `.agents/` and
   `.claude/skills/`. Fixes T4 and M-31, M-32.
2. **The docs sweep** (a day): the eight stale claims and the contradiction (M-28); delete the editor README's status
   and changelog (H-4); the 31 phase mentions; rewrite the three type-file headers (M-22); add a Next.js newcomer
   guide under docs/guides and a README for the e2e folder (M-29); cap bullet length in the three dense READMEs (M-30);
   fix the two `types.ts` comments (M-17); label pagination Node-only and archive spec §14 (M-18).
3. **Write the port decisions down** (two days, with the Java leads in the room): a decision record each for ids
   (H-1), the JSON policy (M-9), stored sentences (M-10), and a "porting the data model" page (H-2) with the entity map.
4. **The four Medium bugs** (half a day): import `return chosen` (M-2), the retry stall and the duplicate retry (M-1),
   `requireCan` (M-3), NUL in Markdown paste (M-4). With them: security headers (M-20), the notices-route ordering and
   preview viewer-before-body (M-21), `unknown_consumer` writes no row (M-7).
5. **Split the files that fail decision 0043's own test** (three days): `content-workspace.tsx` (H-6), `usage.ts` into
   domain aggregates plus loaders, `review-shared.ts` into three, `build.ts` into emitters, `block-menu.tsx` and
   `document-editor.tsx` by concern, `golden/content.ts` into four. Tests for `pdf-controller.ts` (H-5) and
   `approval-chains.tsx`.
6. **Close the port-facing gaps in the contract** (two days): the golden cases in M-16; the H2 rule in the spec (M-6);
   the JSON Schema or the BFF-validates decision (M-15); typed payloads (D10); `PermissionResource` per action (M-8);
   one effect vocabulary (M-11); ISO strings in the access read models (M-27); the four indexes (M-12).
7. **The service seam** (B1, a week): the step that makes H-3 solvable and the Java port incremental. Rendering already
   has this shape; copy it.

Items 1 to 4 are cheap and should land before the team's first day. Items 5 to 7 can be the team's first sprints, and
make good onboarding work because each touches one layer with its README beside it.

## 10. Reading order for the walkthrough session

The follow-up the owner mentioned, reading the codebase together, should go in this order; each step has the files the
reviewers named as the best teachers of that layer.

1. `AGENTS.md`, `docs/architecture.md` ("How requests flow"), then `src/server/actions/kit.ts`.
2. `src/domain/README.md` (vocabulary, lifecycle), `lifecycle/sunset.ts` with its test, `permissions.ts`,
   `refusals.ts`, `rounds.ts`, `business-zone.ts`.
3. `src/server/actions/review.ts` (`setSunset`, then `approveVersion`), `effects.ts`, `queries/versions.ts`
   (`versionActions`), `drafts/apply-patch.ts`.
4. `src/server/db/schema/ucomp.ts` end to end, migrations 0003 and 0008, `seed/templates/types.ts`.
5. `docs/render-spec.md` §1, §5 to §9, §13; `src/domain/render/resolve.ts`; `src/server/render/engine.ts`;
   `golden/README.md`.
6. `src/contracts/api-v1.ts`, `src/domain/golive/cursor.ts`, `src/app/api/v1/templates/route.ts`,
   `queries/consumer-api.ts`.
7. `src/components/README.md`, `primitives/use-action-run.ts`, `versions/action-dialog.tsx`,
   `settings/team/members-table.tsx`, `versions/versions-content.tsx`, then `workspace/autosave/autosave-scheduler.ts`
   and `session/session-store.ts`.
8. `src/editor/README.md` "Document contract", `model/normalize.ts`, `model/document-check.ts`, `model/contract.ts`,
   `extensions/required-sections.ts`, `testing/editor.ts`.
9. `e2e/helpers/principles.ts` (the route and persona matrix is a map of the product), `e2e/storage.ts`,
   `playwright.config.ts`.

## Appendix: method

Nine reviewers ran in parallel against `main` @ 0cca665, read-only, each with the same brief and rubric, each told to
tag evidence and to spot-check the backlog's statuses in its slice: domain, server, data model, render, routes/API/
security, components, editor, tests/tooling/docs, and a UX reviewer driving the production build on port 3200 against
its own database (`data/review.db`). The orchestrator ran the five checks and the e2e suite, verified every claim in
section 1 and the High findings by reading the code, and resolved the few places reviewers disagreed (the `cn` package
import is cosmetic: `src/lib/utils.ts` re-exports the same function; H8's status is "mostly fixed"). The nine full
reports (about 280 KB, with per-file readability notes, the entity map, per-slice "read first" lists and the UX
measurements) are in [quality-review-2026-10-12/reports](quality-review-2026-10-12/reports/), the measured baseline
in [quality-review-2026-10-12/measured-baseline.md](quality-review-2026-10-12/measured-baseline.md), and twelve
screenshots in [quality-review-2026-10-12/screens](quality-review-2026-10-12/screens/). All of it is uncommitted.
