# Review: data model and persistence (`data-model` slice)

Repo `main` @ 0cca665, 2026-10-12. Slice: `src/server/db/**` (schema, client, 14 migrations), `drizzle.config.ts`,
`src/lib/serialized-writes.ts`, `src/lib/fresh-database.ts`, `src/server/seed/**`, `src/server/reset.ts`,
`scripts/db-migrate.ts`, `scripts/db-reset.ts`. Judged as the schema a Java/JPA team will port to Azure SQL with
blob storage for uploads.

Evidence tags: `measured` (ran it), `verified` (read the code), `traced` (followed, not run).

## 1. Summary

This is a small, legible, well-commented schema (21 app tables, 5 simulator tables, 422 lines of Drizzle) whose
hard invariants about versions are genuinely enforced by the database: one open draft, one Active version, one
released row per number and one row per (template, number, round), all as partial unique indexes, and foreign keys
are declared on most relations and, as I measured, enforced at runtime by libSQL. The notices outbox (`seq` taken in
commit order) and the "render log never holds values" rule are correct designs and the schema comments say why.
Migrations are plain SQL with prose headers, replay from zero in every database test, and `drizzle-kit check`
passes. The seed is deterministic (measured across two base dates) and pins its template ids in a test.

The weaknesses are the ones a Java team will meet first. Several business invariants (last Team Admin, one open
recertification, one pending access request, and the notice sequence counter itself) hold only because every write
in the process takes turns on one in-memory lock; on Azure SQL with two instances they race. Sixteen JSON columns
range from the justified (TipTap bodies, variables, sample sets) to the relational-shaped (`versions.stages`,
`writers`, `channels`, `approvals.sample_sets_seen`, `approver_rule`), and two payload columns (`audit_events.details`,
`consumer_notices.payload`) are untyped. The code carries three busy-retry copies and one transaction with none,
`rowid` ordering in three queries, `strftime` day buckets, a KV `settings` row doing the job of a SEQUENCE, and
millisecond-integer timestamps. None of this is written up anywhere as a port checklist. The seed's determinism
rests on one shared PRNG, so adding a row shifts every id after it; the repo knows this and has grown four
workarounds for it, which is the sign of a maintainability trap. The backlog findings in this slice (B3, B4, B5,
D10) are all still Open and still accurate.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 2 | Correctness & robustness | 7 | Compare-and-set on `rev`, partial unique indexes, commit-ordered `seq`, FKs enforced; but four write paths with three retry copies and one with none, and invariants that depend on a single process. |
| 3 | Data model & persistence | 6 | Normalized where the product's risk is (versions, roles), constraints real; but 16 JSON columns (7 relational-shaped), no CHECK constraints, missing indexes and FKs on logs, a sequence in a KV table, and several SQLite-only semantics. |
| 6 | Readability for humans | 7 | `ucomp.ts`, `context.ts`, `types.ts`, `rng.ts`, `ids.ts` and the migration SQL are a pleasure; `build.ts` is one 370-line function with one-letter names, and `serialized-writes.ts`/`fresh-database.ts` are Proxy tricks a Java developer will not follow. |
| 7 | Test quality | 7 | 78 tests in 2.5 s, deterministic, random order, one database per test, a real pre-migration test for 0008 and a determinism test across dates; but six data-backfilling migrations are exercised only on empty tables, and nothing checks FK integrity after the two table rebuilds. |
| 8 | Documentation | 7 | Architecture "Data" and the server README "Database" are true in every claim I checked and cite decisions; but there is no entity reference, no port notes, the seed section is 1,900 words of prose, and three rationale comments are stale or false. |
| 11 | Handoff readiness (Java/MSSQL/Azure) | 6 | Tables, ids and the upload path scheme port cleanly and the blob slot is obvious; JSON strategy, the `seq` counter, filtered-index NULL semantics, timestamp type, logs-as-tables and the TypeScript-only seed all need decisions nobody has written down. |

## 3. Strengths

- **The version invariants are in the database, not in prose.** `versions_one_draft`, `versions_one_active`,
  `versions_one_released` (partial) and `versions_template_number_round` in
  `src/server/db/schema/ucomp.ts:196-211`, created by `0000_init.sql:270-273` and `0008_review_rounds.sql:15-16`.
  `startDraft` relies on the draft index for the two-people-press-Edit race (server README, "Database"). `verified`.
- **Foreign keys are enforced at runtime.** libSQL's local driver opens with `PRAGMA foreign_keys = 1`; an orphan
  insert is refused both outside and inside a write transaction (scratch script `fkcheck/fk-check.mjs`, run against
  a temp file). `measured`. The migrator turns them off only for the duration of a migration batch
  (`node_modules/@libsql/client/lib-esm/sqlite3.js:292,319`), which is what lets `0006_versioned_name.sql` and
  `0011_coral_phones.sql` rebuild tables that other tables reference. `verified`.
- **The notices outbox is designed for a consumer that must never miss a revoke.** `consumer_notices.seq` is taken
  inside the writing transaction (`takeNoticeSeqs`, `src/server/effects.ts:265-284`), unique
  (`consumer_notices_seq`), never reused (floor kept in `settings`), and the cursor carries a reset epoch
  (`settings.seeded_at`). The schema comment at `ucomp.ts:308-316` explains all of it in nine lines. `verified`.
- **`render_log` cannot hold a customer value.** No value column exists (`ucomp.ts:283-306`), and
  `seed.test.ts:652` ("holds no customer data: no value columns and no customer names") pins it. `measured` (passes).
- **Uploads already separate metadata from bytes.** `uploads` holds filename, mime, size and a relative `path`
  (`ucomp.ts:264-273`); `src/server/import/store.ts` derives every path from a checked id and fixed basenames
  (`<uploadId>/original.<ext>`, `compare.html`, `report.json`; lines 5-15, 28-37), so the client's filename never
  reaches the filesystem. Swapping `writeFile`/`readFile` for a blob client is a one-file change. `verified`.
- **Hand-written migrations with real prose.** `0003` (table rebuild, numbering by `ROW_NUMBER()`), `0004`
  (recursive CTE backfill of `writers`), `0005` (stage snapshot backfill), `0007` (DST-aware sunset move with an
  idempotence argument), `0008` (why no CHECK constraint) each open with a paragraph saying what, why and what
  stays as it was. `drizzle-kit check` reports "Everything's fine"; `_journal.json` has 14 entries matching the
  14 files. `measured`.
- **A real migration test.** `src/server/db/review-rounds-migration.test.ts` builds a database through 0007 with
  rows in the old shape, runs 0008 the way `db:migrate` runs it, and then submits through the real action. `verified`.
- **The seed is a declarative spec, checked before it inserts.** `SeedTemplate` (`seed/templates/types.ts`) is 103
  lines a human reads in five minutes; `build.ts` derives template, versions, approvals, threads, audit rows and
  notices from it so they cannot disagree, and refuses a spec that breaks the content contract (`check`,
  `checkRounds`, `checkSendBacks`, lines 23-105). Determinism across base dates is tested
  (`seed.test.ts`, "builds the same structure whatever day the reset runs"). `measured`.
- **Test isolation is right.** One migrated and seeded file per test file, an APFS clone per test
  (`src/lib/fresh-database.ts`, decision 0048), tests shuffled inside each file (`vitest.config.mts`). The slice's
  tests: 4 files, 78 tests, 2.48 s. `measured`.
- **`reset.ts` drops tables in foreign-key order** by reading `PRAGMA foreign_key_list` (lines 22-42) rather than a
  hard-coded list, so a new table cannot break reset. `verified`.
- **Readable id scheme.** `src/server/ids.ts` (47 lines): Crockford base32 without I/L/O/U, `UC-` plus six
  characters for templates, prefix plus ten for everything else, seeded variants as pure functions of a PRNG, and
  `freshTemplateId` (`src/server/templates/create.ts:45-51`) checks for a collision anyway. `verified`.

## 4. Entity map (for the handoff)

Conventions: every id is `text` (Crockford base32, `prefix_` + 10 chars; templates `UC-XXXXXX`; users and teams are
slugs like `maya`, `coral-offers`). Every timestamp (`ts`) is an `integer` of epoch milliseconds read as a JS `Date`
(29 such columns). Every JSON column is `text` holding JSON, typed in TypeScript only (16 in the app schema, 6 in
the simulator's). No CHECK constraints exist anywhere (`measured`: `0013_snapshot.json` reports 0 for every table).
FK = declared foreign key (enforced at runtime); "ref, no FK" = a column that names a row in another table without one.

### App schema (`src/server/db/schema/ucomp.ts`)

| Table | Key | FKs | Unique / partial indexes | Other indexes | JSON columns (domain type) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `settings` | `key` | — | — | — | `value` (`unknown`: number, string or ISO string by key) | Holds `clock_offset_days` (demo), `seed_version` (demo), `seeded_at` (notice-cursor epoch), `business_zone` (a real platform setting) and `consumer_notice_seq` (a sequence). |
| `users` | `id` | — | — | — | — | `platform_role` is `PlatformRole` (`platform_admin`/`auditor`) or null. `email` is not unique. |
| `teams` | `id` | — | `slug` | — | — | `app_name`, `sms_sender` nullable (decision 0034). Seed sets `id = slug`. |
| `memberships` | `id` | `user_id`→users, `team_id`→teams, `added_by`→users | `(user_id, team_id)` | — | — | `status` is `MembershipStatus` (`active`/`suspended`/`lapsed`), `status_reason` is `MembershipStatusReason`. No index led by `team_id` (11 queries filter on it). |
| `membership_roles` | `(membership_id, role)` | `membership_id`→memberships ON DELETE CASCADE | (PK) | — | — | `role` is `TeamRole` (`viewer`/`author`/`approver`/`team_admin`). Properly normalized. |
| `content_types` | `id` | — | `key` | — | `required_sections` (`RequiredSection[]`), `allowed_channels` (`Channel[]`) | `sms_footer` nullable, `sms_max_parts` default 3. |
| `approval_stages` | `id` | `content_type_id`→content_types | — | — | `approver_rule` (`ApproverRule`: `{kind:"team_role",role}` or `{kind:"user",userId}`) | `position` orders the chain; no unique on `(content_type_id, position)`. |
| `templates` | `id` | `team_id`→teams, `content_type_id`→content_types, `created_by`→users | — | `team_id` | — | No name (decision 0016). `starter_key` nullable. |
| `versions` | `id` | `template_id`→templates, `created_by`→users, `submitted_by`→users, `sunset_set_by`→users | `(template_id, number, round)`; `(template_id, number) WHERE state IN ('active','superseded','revoked')`; `(template_id) WHERE state='draft'`; `(template_id) WHERE state='active'` | `template_id` | `body` (TipTap `JSONContent`), `channel_fields` (`ChannelFields`: channel → field key → `JSONContent`), `channels` (`Channel[]`), `variables` (`Variable[]`), `sample_sets` (`SampleSet[]`), `contract_changes` (`ContractChange[]` or null), `stages` (`VersionStage[]` `{id,name}`, null on drafts), `writers` (`string[]` of user ids), `revoke` (`RevokeRecord` with ISO-string dates) | 30 columns. One row per round: `number` and `round` null while draft. `state` is `VersionState`. `rev` is the autosave/compare-and-set counter. `based_on_version_id` and `import_upload_id` are refs with no FK. `sms_footer` frozen at submit (0012). |
| `approvals` | `id` | `version_id`→versions, `actor_id`→users | — | **none** (4 queries filter on `version_id`) | `sample_sets_seen` (`string[]`) | `stage_id` is a ref with no FK, by design (comment at `ucomp.ts:219`); `stage_position`, `stage_name` denormalized from the version's `stages`. `decision` is `"approved" \| "changes_requested"`. |
| `comment_threads` | `id` | `template_id`→templates, `origin_version_id`→versions, `resolved_by`→users | — | `template_id` | — | `block_id` anchors to a TipTap block id (or `"doc"` for a whole-version thread). `status` `open`/`resolved`. |
| `comments` | `id` | `thread_id`→comment_threads ON DELETE CASCADE, `author_id`→users | — | **none** (`threads.ts:105` filters on `thread_id`) | — | `kind` `comment`/`change_request`. |
| `uploads` | `id` | `template_id`→templates (nullable), `created_by`→users | — | none (`import.ts:44` filters on `template_id`) | — | `path` is `<uploadId>/original.<docx\|pdf\|txt>` relative to the uploads root; the kind is re-derived from it by regex. |
| `consumers` | `id` | — | — | — | — | Registered consumer systems (`coral`, `deposits-online`). |
| `render_log` | `id` | **none** (`template_id`, `version_id`, `consumer_id` are refs) | — | `(template_id, at)`, `(consumer_id, at)` | — | ~31k seeded rows. `channel` is `Channel`, `platform` is `PushPlatform` or null (0013), `outcome` `ok`/`error`, `error_code` nullable. Never a value. |
| `consumer_notices` | `id` | `consumer_id`→consumers | `seq` | `(consumer_id, seq)` | `payload` (`Record<string, unknown>`; shape differs by `kind` and between seed and runtime) | `kind` is `ConsumerNoticeKind` (`new_version`/`sunset_scheduled`/`sunset_passed`/`revoked`). `template_id`, `version_id` refs with no FK. |
| `audit_events` | `id` | `actor_id`→users (nullable: null actor = system) | — | `at`, `team_id`, `(version_id, session_key)` | `details` (`Record<string, unknown>`; typed for one action only) | `team_id`, `template_id`, `version_id` refs with no FK; **no index on `template_id`** (`activity.ts:43` filters on it). `action` is a free string (16 `AuditAction` values plus access/platform actions plus 3 seed aliases). |
| `notifications` | `id` | `user_id`→users | — | `user_id` | — | `team_id` ref with no FK; `href` is a stored route string. |
| `access_requests` | `id` | `user_id`→users, `team_id`→teams, `decided_by`→users | — | `(team_id, status)`, `user_id` | — | `role` is `TeamRole`, `status` `pending`/`approved`/`denied`. No partial unique for "one pending per (user, team)". |
| `recertifications` | `id` | `team_id`→teams | — | none | — | No partial unique for "one open per team" (`completed_at IS NULL`). |
| `recert_items` | `(recert_id, user_id)` | `recert_id`→recertifications ON DELETE CASCADE, `user_id`→users, `decided_by`→users | (PK) | — | — | `decision` `keep`/`remove` or null. |

### Simulator schema (`src/server/db/schema/sim.ts`), Coral's own system

| Table | Key | FKs | Indexes | JSON columns |
| --- | --- | --- | --- | --- |
| `sim_offers` | `id` | — | — | `terms` (`{spend,bonus,months,annualFee?,endsOn?}`, null for an alert) |
| `sim_customers` | `id` | — | — | `statement` (`{minimumDue,dueDate}`), `last_purchase` (`{amount,merchant,country}`) |
| `sim_links` | `id` | `offer_id`→sim_offers | unique `offer_id` | `channels` (`SimChannel[]`), `mapping` (`Record<string,string>`) |
| `sim_deliveries` | `id` | — (`offer_id`, `customer_id`, `template_id` refs) | `(offer_id, at)`, `batch_id` | `error` (`{status,code,message}`); `output` is text (base64 PDF, HTML, or JSON) |
| `sim_notice_reads` | `notice_id` | — | — | — |

The simulator tables carry Stencil's `template_id` as plain text on purpose: Coral is a separate system reaching
Stencil only over `/api/v1`. On the Java side these tables stay with the demo, not the product.

## 5. Findings (by severity)

### High

**H1. Four business invariants and the notice sequence hold only under one process-wide lock.** `verified` +
`measured`.
Where: `src/lib/serialized-writes.ts:5-20` (the lock and why), `src/server/effects.ts:265-284` (`takeNoticeSeqs`:
`SELECT` the counter and `MAX(seq)`, then `INSERT … ON CONFLICT DO UPDATE`), schema `ucomp.ts:374-404` (no partial
unique on `access_requests(user_id, team_id) WHERE status='pending'`, none on
`recertifications(team_id) WHERE completed_at IS NULL`), domain `losesLastAdmin` (read-check-write), and
`0013_snapshot.json` (0 CHECK constraints on any table).
What happens: today a second concurrent write cannot exist inside the process, so these read-then-write sequences are
safe. Azure SQL defaults to `READ_COMMITTED_SNAPSHOT ON`; with two API instances, two `takeNoticeSeqs` calls can read
the same counter and the unique index on `seq` turns a consumer notice into a failed commit; two admins can demote
each other; two requests can both be pending.
Why it matters: the notices contract promises a consumer never skips a notice (decision 0006, A2 Fixed). That promise
currently rests on `BEGIN IMMEDIATE` plus an in-process mutex, neither of which exists on the target.
Fix: a database `SEQUENCE` for `seq` (or `UPDATE settings SET value = value + @n OUTPUT inserted.value`), filtered
unique indexes for the two "one open" rules, a `team_admin_count`-style constraint or `UPDLOCK` read for the last
admin, and CHECK constraints on `state`, `status`, `role`, `kind`, `decision`, `outcome`, `channel`, `platform`.
Backlog B3 covers most of this and is still Open.

**H2. No port notes exist for the SQLite semantics the schema and queries rely on.** `verified`.
Where: `docs/architecture.md` "Data" and `src/server/README.md` "Database" (both say what SQLite does, never what
the replacement must do); `ucomp.ts:33-34` (`timestamp_ms` integers, JSON-in-text); `ucomp.ts:198-199` ("NULLs stay
distinct"); `src/server/queries/{audit,activity,notifications}.ts` (`rowid` ordering, lines 235/45/28);
`src/server/queries/usage.ts:55` (`strftime('%Y-%m-%d', at/1000, 'unixepoch')`); `effects.ts:296-300` (`BEGIN
IMMEDIATE` as the reason compare-and-set reads are safe); `settings.consumer_notice_seq` as a sequence.
What happens: a Java developer reading only the schema will map `integer` timestamps to `BIGINT`, create
`UNIQUE(template_id, number, round)` where MSSQL treats NULL as one value (harmless only because one_draft exists),
lose the `rowid` tiebreak (MSSQL has none; the audit log's same-millisecond rows reorder), and let Hibernate's
`hbm2ddl` skip every filtered index (JPA cannot express them).
Why it matters: the schema's load-bearing parts are exactly the parts JPA annotations cannot carry.
Fix: a one-page "porting the data model" doc (or a decision record) listing: `DATETIME2(3)` (or keep epoch ms as
`BIGINT` and say so), filtered indexes as Flyway SQL with `WHERE number IS NOT NULL` added to the round index,
`SEQUENCE` for `seq`, ULID or `(at, id)` ordering instead of `rowid`, `CAST(at AS DATE)` day buckets, JSON column
policy (below), and `rev` as `@Version`.

### Medium

**M1. Four write paths, three busy-retry copies, one transaction with none, and stale rationale.** `verified`.
Where: `src/server/effects.ts:289-310` (`isBusy`, `inTransaction`), `src/server/drafts/apply-patch.ts:56-78`
(`isBusy`, `retryWhenBusy`, same code), `src/simulator/db.ts:23-41` (`withBusyRetry`, detects by regex on the
message instead of `code`), `src/server/import/create.ts:144` (`db.transaction` with no retry, acknowledged in the
server README's "Don't copy"). The comments at `effects.ts:297-298` and `apply-patch.ts:64` say "because the file
has no busy timeout", but `createAppClient` sets `timeout: BUSY_TIMEOUT_MS` (5 s) at `serialized-writes.ts:26,174`,
so the stated reason is no longer true (in-process writes now take turns; the retry covers the lock-wait timeout).
Why it matters: three copies can diverge (one already has), and the next reader learns a false model of the client.
Fix: one `inTransaction` in the db layer that all four use (B4's fix); delete the two copies; reword the comments to
say what the retry covers now (a write that waited 15 s for its turn, or a lock held by another process beyond 5 s).

**M2. Missing indexes for hot filters, and two unbounded loads.** `verified`.
Where: `approvals` has no index at all (`0013_snapshot.json`: 0 idx) while `review-shared.ts:171,253`,
`review.ts:286` and `versions.ts:201` filter on `version_id`; `comments` has none while `threads.ts:105` filters on
`thread_id`; `memberships` is indexed only by `(user_id, team_id)` while 11 call sites filter on `team_id` alone;
`audit_events` has no `template_id` index while `activity.ts:43` (a template's Activity feed) filters on it.
`audit.ts:215-235` (`loadEvents`) and `library.ts:71-84` (every version row of every team, no `WHERE`) have no
`LIMIT` or team filter.
Why it matters: harmless at demo size; at 31k render rows the Usage queries are already the slowest screen, and a
few hundred templates with audit history will make the Audit page and the Library load whole tables.
Fix: add the four indexes (one migration), filter `library.ts`'s version query by the template ids it just loaded,
and page `loadEvents`. B3 lists three of the four indexes; `audit_events(template_id)` is new.

**M3. Two payload columns are untyped and carry two spellings of the same event.** `verified`.
Where: `ucomp.ts:328` (`payload: json<Record<string, unknown>>`), `ucomp.ts:345` (`details`),
`src/domain/review-types.ts:54-60` (`AuditDetailsByAction` types exactly one of 16 actions),
`src/domain/audit.ts:86-90` (`ALIASES` map `version.revoke_confirmed`→`version.revoked`,
`comment.resolved`→`thread.resolved`, `version.stage_approved`→`version.approved`), `seed/templates/build.ts:385,484`
(the seed still writes the aliased spellings), `src/domain/golive/notices.ts` lines 3-4, 15-30 ("Seeded rows and the rows
server/effects.ts writes at runtime carry slightly different payloads … reading a payload defensively").
Why it matters: these two columns become the Java team's audit and notice DTOs. Today the shape is whatever the
writer put there, and the readers guess. D10 is Open and the description is still exact.
Fix: a discriminated `AuditDetails` union keyed by action and a `NoticePayload` union keyed by kind, in
`src/domain`, used by `writeEffects` and the seed; migrate the seed's spellings and delete `ALIASES` (D10's fix).

**M4. Seven of sixteen JSON columns are relational-shaped.** `verified`.
Where: `versions.stages` (`VersionStage[]` of `{id,name}`), `versions.writers` (`string[]` of user ids),
`versions.channels` (`Channel[]`), `approvals.sample_sets_seen` (`string[]`), `versions.revoke` (a 5-field record
with ISO strings while every other date in the row is an integer), `content_types.allowed_channels`,
`approval_stages.approver_rule` (a two-variant union). The other nine (`body`, `channel_fields`, `variables`,
`sample_sets`, `contract_changes`, `required_sections`, `details`, `payload`, `settings.value`) are documents or
free records and belong in JSON.
What happens: `writers` is the maker-checker fact (`can()` refuses anyone in it); `stages` is the frozen chain;
both are read into TypeScript and checked there, never queried in SQL, so SQLite's lack of a JSON index never hurt.
Why it matters: on MSSQL these become `NVARCHAR(MAX)` with `ISJSON` checks and `OPENJSON` when anyone asks "which
versions did Maya write" or "which in-review versions wait on stage X"; and JPA has no native JSON array type
(Hibernate 6 `@JdbcTypeCode(SqlTypes.JSON)` works but is opaque to queries).
Fix: before writing entities, decide per column. My recommendation: tables for `version_writers(version_id,
user_id)`, `version_stages(version_id, position, stage_id, name)` and `approval_sample_sets_seen`; two columns
(`revoke_*`) for the revoke record so its dates match the row's type; keep `channels` and `allowed_channels` as JSON
or a bitmask (5 values); keep `approver_rule` as two nullable columns (`rule_role`, `rule_user_id`) with a CHECK.

**M5. The `versions` table is a 30-column row-per-round god table. Where I stand.** `verified`.
Where: `ucomp.ts:143-212`.
What it mixes: draft working state (`rev`, `updated_at`, `writers`), the release identity (`number`, `round`,
`state`, `name`), the review snapshot (`stages`, `current_stage`, `submit_note`, `submitted_*`), the release
lifecycle (`activated_at`, `superseded_at`, `sunset_at`, `sunset_set_by`, `revoke`), content (`body`,
`channel_fields`, `variables`, `sample_sets`, `channels`, `sms_footer`) and provenance (`based_on_version_id`,
`import_upload_id`, `contract_changes`).
Where I stand: **row-per-round is right** (decision 0033). A round is an immutable snapshot of content as reviewed;
giving it its own row is what lets `versions_one_released` hold and lets Compare, render, and the redline all read
one shape. Splitting rounds into a child table would put the content a consumer renders one join away from the
state that says it may render, and the partial indexes would have to span two tables. What I would split is not
rounds but the two JSON arrays above (`stages`, `writers`) and the `revoke` record, plus moving `rev`/`updated_at`
semantics onto JPA's `@Version`. Approvals are already their own table. Keep the table; narrow it by ~6 columns.

**M6. `settings` is a sequence, a platform setting and two demo switches in one JSON KV.** `verified`.
Where: `ucomp.ts:37-40` (`value: json<unknown>`), keys written at `seed/index.ts:92-99` and read at
`clock.ts:11`, `business-zone.ts:14`, `effects.ts:251`, `consumer-api.ts:311`.
Why it matters: on the Java side `consumer_notice_seq` must be a `SEQUENCE` (H1), `business_zone` a typed platform
setting, `clock_offset_days` and `seed_version`/`seeded_at` demo-only and removed with the demo tools (S1 Deferred).
Nothing marks which is which except the keys' names.
Fix: a `platform_settings` table with typed columns (or one row), a SEQUENCE, and demo state in its own place.

**M7. Refs without foreign keys leave "delete a template" undefined.** `verified`.
Where: `audit_events.{team_id,template_id,version_id}`, `render_log.{template_id,version_id,consumer_id}`,
`consumer_notices.{template_id,version_id}`, `notifications.team_id`, `versions.based_on_version_id`,
`versions.import_upload_id`, `approvals.stage_id` (`ucomp.ts`, the columns without `.references`). Only `stage_id`
says why (line 219-220). The e2e cleanup helper (now `e2e/helpers/state/templates.ts`) deletes a template with nine hand-ordered
statements, including `DELETE FROM notifications WHERE href LIKE '%/<id>%'`.
Why it matters: some of these are deliberate (a log should outlive what it logs), but the schema does not say so,
and a Java team adding `@ManyToOne` everywhere will change the product's delete semantics without noticing. The
product has no delete today, so the question has been avoidable.
Fix: a comment per ref saying "no FK: outlives its target" or add the FK; record the rule in a decision.

**M8. The seed's id determinism is a trap the repo has already fallen into four times.** `verified`.
Where: `seed/context.ts:118-155` (one `mulberry32(SEED)` shared by every `ctx.id()` and `ctx.templateId()`),
`seed.test.ts:150-170` (14 template ids pinned: e2e specs, golden files and screenshots name them). The workarounds:
`ctx.keyedId` and `SeedThread.keyedIds` (`types.ts:38-43`, `build.ts:425`); "the alerts are built last, so every id
seeded before alerts existed stays the same" (`index.ts:86-87`); the `ERRORS` entry that must stay last "so every
random draw of the history before it is the same" (`history.ts:88`); `pushPlatformOf(counter)` hashed from the row
number "so adding the platform left every other draw … as it was" (`history.ts:117-124`).
Why it matters: every future seed edit carries the same constraint, and a developer who adds a template in the
middle of `coral.ts` re-ids half the dataset and breaks e2e. The seed README prose explains it; a Java team porting
the fixtures will have to reimplement `mulberry32`, `fnv1a` and Crockford mapping bit-for-bit to keep those ids.
Fix: put the id in the spec. `SeedTemplate.id: "UC-D6KSGY"` and `SeedVersion.id` as explicit fields (the test
already lists them), draw everything else from per-template keyed sequences, and drop the "built last" ordering
rules. Then a Java fixture file can carry the same literal ids.

**M9. `buildTemplate` is a 370-line function with one-letter names.** `verified`.
Where: `seed/templates/build.ts:122-495`: closures `audit`, `writersOf`, `versionOf`, `specOf` defined inside; loop
variables `v`, `a`, `c`, `e`, `s`; `history.ts:176-212` uses `o` for the row options and `t`/`v` for template and
version; `index.ts:46` uses `s` for the sink.
Why it matters: this is the file a developer must change to add a seed row, and the check-then-emit structure is
linear and good, but a ten-minute read is not possible at this length, and `v.revoke` vs `info.round` vs
`versionOf(v.basedOn)` keeps three handles on the same version.
Fix: split into `emitVersion`, `emitApprovals`, `emitLifecycleNotices`, `emitThreads`, each 40-60 lines taking
`(ctx, spec, ref)`; name loop variables (`version`, `approval`, `comment`).

### Low

**L1. A false comment about foreign keys.** `measured`.
Where: `src/server/access-effects.ts:144`: "SQLite enforces the cascade only with foreign_keys on: delete the roles
explicitly." libSQL opens with `foreign_keys = 1` and `membership_roles.membership_id` is `ON DELETE CASCADE`
(`ucomp.ts:94-96`), so the cascade would fire. The explicit delete is harmless but the reason given is wrong, and a
reader will conclude FKs are off everywhere.
Fix: delete the line or reword ("belt and braces; the FK cascades too").

**L2. Six backfilling migrations are tested only against empty tables, and no FK check follows the rebuilds.**
`verified`.
Where: `0003`, `0004`, `0005`, `0006`, `0007`, `0009`, `0012` contain `UPDATE`/`INSERT … SELECT` backfills; only
`0008` has a pre-migration test (`review-rounds-migration.test.ts`). `0006` and `0011` rebuild tables with FKs off
(`sqlite3.js:292`); nothing runs `PRAGMA foreign_key_check` after (`grep` finds none in `src`, `scripts`, `e2e`).
Why it matters: low for the demo (reset rebuilds everything), but the pattern "rebuild with FKs off, never check"
is the one a Flyway migration on real data must not copy.
Fix: `PRAGMA foreign_key_check` at the end of `db-migrate.ts` (fails on any row), and for the Java side, Flyway
`afterMigrate` integrity checks.

**L3. The two test-infrastructure files are JavaScript Proxy puzzles.** `verified`.
Where: `src/lib/serialized-writes.ts:87-168` (a `Proxy` over the libSQL client with `bound()` to defeat `#private`
fields, and a `Proxy` over each transaction); `src/lib/fresh-database.ts:30-45` (`following()`, a Proxy whose
target changes per test, with an `own` overlay for spies).
Why it matters: both are correct and well commented, and both disappear with MSSQL (JDBC pools and a real test
container replace them). But a Java developer debugging a flaky test will not follow them in ten minutes.
Fix: none needed in code; mark both files in the server README's "Testing" as "SQLite-only scaffolding, not a
pattern to port".

**L4. `uploads.kind` is derived from `path` by regex.** `verified`.
Where: `src/server/import/store.ts` lines 15, 40-42 (`STORED_PATH`, `kindOfPath`); `uploads` has no `kind` column.
Fix: a `kind` column (`docx`/`pdf`/`txt`) with a CHECK; then `path` can become an opaque blob name/ETag on Azure.

**L5. `users.email` is not unique, and `teams.id` duplicates `teams.slug`.** `verified`.
Where: `ucomp.ts:43-53`, `55-69`; seed sets ids equal to slugs (`architecture.md`, "Teams … ids equal slugs").
Why it matters: with Entra ID the user key becomes the OID and every FK to `users.id` is re-keyed; decide now
whether `users.id` stays a slug (display) with an `entra_oid` unique column, or becomes the OID.

**L6. `drizzle.config.ts` and `client.ts` keep a Turso path the target never uses.** `verified`.
Where: `drizzle.config.ts:4` (`dialect: "turso"`), `client.ts:7-9`, `DATABASE_AUTH_TOKEN`. Harmless; one line of
"dead flexibility" to ignore during the port.

**L7. `reset.ts:71` uses `new Date()` where the repo rule says `now()`.** `verified`.
Justified (the reset zeroes the clock offset, so demo time is real time) but not stated; one comment fixes it.

**L8. The Database section of the server README is 1,900 words of paragraph prose.** `verified`.
Where: `src/server/README.md:134-186`. Every sentence I checked is true, but there is no table of tables, and the
"Seed and reset" paragraph is one 14-line block. The entity map above is the shape it needs.

## 6. Backlog check

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| B3 Invariants rely on SQLite's single writer | Open | Yes | No CHECK constraints (snapshot: 0), no partial unique on recert/requests, `approvals`/`comments`/`memberships(team_id)` indexes still missing; `consumer_notices(consumer_id, created_at)` is superseded by `(consumer_id, seq)`. `measured`/`verified`. |
| B4 SQLite workarounds spread through the code | Open | Yes | `rowid` at `audit.ts:235`, `activity.ts:45`, `notifications.ts:28` (+ simulator `queries.ts:418`); `strftime` at `usage.ts:55`; three retry copies + `import/create.ts:144` without; `library.ts:71-84` loads every version; `loadEvents` has no limit. `verified`. |
| B5 Autosave conflict recovery reads the audit log | Open | Yes | `apply-patch.ts:158` still selects `auditEvents` by `versionId`+`sessionKey`. `verified`. |
| D10 Audit and notice payloads are untyped | Open | Yes, slightly improved | `AuditDetailsByAction` types one action (`version.sunset_passed`); `ALIASES` still exist; `golive/notices.ts` still reads two payload shapes. `verified`. |
| T3 Database tests depend on order | Fixed | Yes | Random order configured; 78 tests pass with seed 1791832832589; decision 0048. `measured`. |
| T5 E2E can't be pointed at its own database | Fixed | Yes, status text slightly stale | Says `data/e2e.db`; `e2e/storage.ts` lines 5, 37 now uses `data/e2e-<slot>.db` per worker (decision 0050). `verified`. |
| A2 Consumers can miss a revoke | Fixed | Yes | `seq` unique, taken in-transaction, floor in settings, epoch in cursor. `verified`. |
| N23 Render log has no push platform | Fixed | Yes | Migration 0013, `render_log.platform`, seed `pushPlatformOf`, test "names the phone of every push". `measured`. |

New, not in the backlog: H2 (no port notes), M7 (refs without FKs undocumented), M8 (seed id determinism as a
trap; the README describes it but does not list it as a problem), L1 (false FK comment), L2 (no
`foreign_key_check`), L4 (`uploads.kind`), the stale "no busy timeout" comments in M1, and the missing
`audit_events(template_id)` index in M2.

## 7. For the Java team

**Ports cleanly (keep the shape, translate the DDL).** `users`, `teams`, `memberships`, `membership_roles`,
`content_types`, `approval_stages`, `templates`, `approvals`, `comment_threads`, `comments`, `uploads`, `consumers`,
`notifications`, `access_requests`, `recertifications`, `recert_items`: text keys, FKs as declared, the unique
indexes as written. The id scheme (`src/server/ids.ts`, 47 lines, no dependencies) is a one-class port. `rev` on
`versions` is JPA's `@Version`. The upload store (`import/store.ts`) is already "metadata in a table, bytes behind an
id-derived name": replace `writeFile`/`readFile` with a `BlobClient` and keep `uploads.path` as the blob name.
`render_log` stays value-free; keep that as a code-review rule.

**Needs a decision before entities are written.**
1. JSON policy per column (M4): which stay `NVARCHAR(MAX)` + `ISJSON`, which become tables.
2. `consumer_notices.seq` as a `SEQUENCE` and the two "one open" rules as filtered unique indexes (H1); CHECK
   constraints on every enum column.
3. Timestamps: `DATETIME2(3)` vs `BIGINT` epoch ms; the TypeScript side converts to ISO at the read-model
   boundary either way (`architecture.md`, "Conventions").
4. Filtered indexes live in Flyway SQL, not annotations; add `WHERE number IS NOT NULL` to the round index because
   MSSQL unique indexes treat NULL as a value.
5. `rowid` tiebreaks become `(at DESC, id DESC)` or ULIDs; `strftime` day buckets become `CAST(at AS DATE)` (mind
   the business time zone, decision 0017).
6. Logs: `render_log` (31k rows in 90 demo days; at a real consumer's volume this is a time-series) and
   `audit_events` belong in a partitioned table or Log Analytics/Dynatrace with the relational copy kept only for
   the Audit screen and the notice window (`recentConsumers`, 30 days).
7. Users: slug ids vs Entra OIDs (L5).
8. Test data: do not port `mulberry32`. Put the literal ids in the fixture spec (M8) and build fixtures in Java from
   the same declarative shape as `SeedTemplate` (`seed/templates/types.ts` is the model to copy; `build.ts` is the
   logic to re-express).

**Read first, in this order.**
1. `src/server/db/schema/ucomp.ts` (the whole model, 422 lines, with the reasons in comments).
2. `docs/architecture.md`, "Data" and "Time, identity, and demo data".
3. `src/server/effects.ts` (`inTransaction`, `writeEffects`, `takeNoticeSeqs`: the write side every action shares).
4. `src/server/db/migrations/0008_review_rounds.sql` and `0003_consumer_notice_seq.sql` (the two migrations that
   explain the version and notice models better than any doc).
5. `src/server/seed/templates/types.ts` then `coral.ts` (what the demo data is), skipping `build.ts` until needed.

## 8. Files

**Models of good code in this slice**
- `src/server/db/schema/ucomp.ts`: grouped by area, every non-obvious column commented with its decision number,
  snake_case columns behind camelCase properties, two one-line helpers.
- `src/server/ids.ts`: 47 lines, pure, explains Crockford and the modulo argument.
- `src/server/seed/templates/types.ts`: the declarative seed shape, readable in five minutes.
- `src/server/seed/context.ts` and `seed/rng.ts`: small, named, honest about what they are.
- `src/server/db/migrations/0003_consumer_notice_seq.sql`, `0008_review_rounds.sql`: SQL with a paragraph of why.
- `src/server/reset.ts`: drops in FK order by asking the database; 86 lines.
- `src/server/db/review-rounds-migration.test.ts`: a migration tested on real old-shaped rows.

**Files a human will struggle with**
- `src/server/seed/templates/build.ts`: one 370-line function, nested closures, one-letter loop variables.
- `src/lib/serialized-writes.ts`: a Proxy over libSQL with `Reflect.get` + `bind` to reach `#private` state; the
  header is excellent, the mechanism is not something to learn from.
- `src/lib/fresh-database.ts`: a Proxy whose target moves between tests, with an overlay for spies.
- `src/server/db/migrations/0007_sunset_business_zone.sql`: US daylight-saving arithmetic in SQLite date functions,
  correct and commented, but nobody should have to verify it twice.
- `src/server/seed/seed.test.ts`: 944 lines; well named tests, but the file is a catalogue to search, not read.
- `src/server/README.md` "Database" section: true, complete, and 1,900 words with no table.
