# `src/server`: data, identity, and the server entry points

Everything that touches the database, the persona cookie, the demo clock, or the file system lives here: server
actions, read models, the Drizzle schema and client, the render pipeline, file import, autosave, and the demo seed.
Business rules do not. They live in `src/domain`, which this layer calls and which may not import it back. Pages,
route handlers, and server components call in directly. Client components call its server actions and import one pure
module, [starters/catalog.ts](starters/catalog.ts). Outside this layer, only
[scripts/db-migrate.ts](../../scripts/db-migrate.ts) and route tests import the database client.

Contents: [Rules](#rules) · [Layout](#layout) · [Anatomy of a mutation](#anatomy-of-a-mutation) ·
[Anatomy of a read](#anatomy-of-a-read) · [Database](#database) · [Clock, viewer, and the access sweep](#clock-viewer-and-the-access-sweep) ·
[Render, import, autosave, and route helpers](#render-import-autosave-and-route-helpers) · [Demo-only paths](#demo-only-paths) ·
[Copy these](#copy-these) · [Don't copy](#dont-copy) · [Testing](#testing)

## Rules

Lint-enforced by [eslint.config.mjs](../../eslint.config.mjs) for every file under `src/server`:
- No `@/editor` import: there is no barrel. Import the server-safe modules `@/editor/schema`, `@/editor/model/*`, and `@/editor/paste/*`.
- No simulator data: `@/server/db/schema/sim`, `**/schema/sim`, and `@/simulator/*` are banned. `seed/**` and `reset.ts` are exempt because they write the simulator's tables.
- `"use server"` appears only in [actions/](actions/), as a file's first line or inside a function: everywhere else in `src` (the simulator's own `src/simulator/actions.ts` aside) it is a lint error. The directive makes every export a public POST endpoint that takes any input, so server actions are for mutations only, and each parses its input with zod.
- Rules on other layers that protect this one: `src/domain` may not import `@/server/*`, and `src/simulator` may import only `@/server/db/schema/sim` from it.

Convention only (no lint rule):
- Every module that imports the `db` client, the clock, or `next/headers` is marked: `import "server-only"`, or `"use server"` in action files. Pure helpers and modules that take the database as an argument ([ids.ts](ids.ts), `seed/`, most of `import/`, [drafts/parse-patch.ts](drafts/parse-patch.ts), the web and email channels) aren't.
- [clock.ts](clock.ts) is the only reader of the current time. Read `now()` once per request, before any transaction, and pass it down as `at` or `now`. Domain functions take it as an argument.
- This layer loads facts, asks `src/domain` what may happen, and writes the answer. A new rule goes in `src/domain`.
- Inside `inTransaction`, read and write through `tx`. Writes take turns on one process-wide lock that a transaction holds until it ends, so a write through `db` inside one waits for that same transaction to end. It stalls for the 15 s turn timeout and fails as `SQLITE_BUSY`, which `inTransaction` then retries.
- A `"use server"` file may export only async functions (type exports are erased, so they're fine). That is why action helpers are private.

## Layout

| Path | What it holds |
| --- | --- |
| [actions/](actions/) | `"use server"` mutations, one file per area: [review.ts](actions/review.ts) (submit, approve, request changes, sunset, revoke), [comments.ts](actions/comments.ts), [access.ts](actions/access.ts), [platform.ts](actions/platform.ts), [templates.ts](actions/templates.ts) (`startDraft`), [create-template.ts](actions/create-template.ts), [notifications.ts](actions/notifications.ts), [persona.ts](actions/persona.ts), [demo.ts](actions/demo.ts). No reads: those are GET routes (see [Anatomy of a read](#anatomy-of-a-read)). |
| [queries/](queries/) | Read models, mostly `cache()`d `get…` functions for server components. [spaces.ts](queries/spaces.ts) (`requireSpace`, the shell) and [review-shared.ts](queries/review-shared.ts) (`requireTemplate`, people, chain and date helpers) are shared. [template-name.ts](queries/template-name.ts) (`currentName`) is the name a CMS list shows. [consumer-api.ts](queries/consumer-api.ts) serves `/api/v1`. Five reads serve the GET routes a screen calls on demand, and [palette.ts](queries/palette.ts) (`searchPalette`) the ⌘K palette's search (see below). |
| [db/](db/) | [client.ts](db/client.ts), [schema/ucomp.ts](db/schema/ucomp.ts) (app tables), [schema/sim.ts](db/schema/sim.ts) (simulator tables), [migrations/](db/migrations/). |
| [effects.ts](effects.ts) | `inTransaction` (the busy retry), `writeEffects` (audit rows, notifications, consumer notices), `takeNoticeSeqs`, `Tx`. |
| [access-effects.ts](access-effects.ts) | `applyMembershipChange` and `writeAccessEffects`: the same job for access and platform changes. |
| [access-sweep.ts](access-sweep.ts) | `runAccessSweep()` and the membership, request, and recertification fact loaders. |
| [viewer.ts](viewer.ts), [clock.ts](clock.ts), [ids.ts](ids.ts) | The persona, the demo clock, and id generation (`newId`, `newTemplateId`, seeded variants). |
| [business-zone.ts](business-zone.ts) | The business time zone sunset dates are read in: `readBusinessZone(reader)` (inside a transaction), `getBusinessZone()` (read models), `countPendingSunsets`. |
| [reset.ts](reset.ts), [seed/](seed/) | `resetDemo()` and the deterministic demo dataset, simulator rows included. |
| [templates/create.ts](templates/create.ts) | The write side of "new template plus first draft", shared by New template and Import. |
| [starters/](starters/) | Starter bodies. [catalog.ts](starters/catalog.ts) has no imports, so the client gallery can read it. |
| [drafts/](drafts/) | Autosave: patch parsing, the transactional save, the per-session audit merge, the status table. |
| [documents/prepare.ts](documents/prepare.ts) | The one way a document is made ready for storage: normalized, checked, block ids added. Autosave and import call it. |
| [render/](render/) | The render pipeline ([render-template.ts](render/render-template.ts)), the engine it runs ([engine.ts](render/engine.ts)), the document check, the render log, [channels/](render/channels/) (web, email, pdf), the [golden files](render/golden/README.md), and shared test helpers in [testing/](render/testing/). |
| [import/](import/) | File import: sniffing, converters, worker isolation, zip limits, capped body reads, upload storage. |
| [api/http.ts](api/http.ts), [api/reads.ts](api/reads.ts) | Response helpers for the `/api/v1` route handlers; `ReadResult` and `readResponse` for the on-demand read routes. |
| [testing/review-fixtures.ts](testing/review-fixtures.ts) | `tempDatabase`, `loadPersona`, `createTemplateWithDraft` for tests. |

## Anatomy of a mutation

The best current example is [actions/review.ts](actions/review.ts); its header states the shape. Trimmed from `setSunset`:

```ts
"use server";
export async function setSunset(input: { templateId: string; versionNumber: number; sunsetAt: string }): Promise<ActionResult> {
  const viewer = await getViewer();                                    // 1. identity
  const parsed = SunsetInput.safeParse(input);                         // 2. parse (zod)
  const found = parsed.success ? await findVersion(…) : undefined;     //    read only to learn the team
  const refused = check(viewer, "version.setSunset", { teamId: found?.teamId ?? null }); // 3. permission
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };
  const at = await now();                                              // 4. the clock, once
  const result = await transact(async (tx) => {                        // 5. one transaction
    const version = await loadVersion(tx, found, parsed.data.versionNumber); // re-read inside it
    const zone = await readBusinessZone(tx);                           //    and the settings it needs
    const outcome = setSunsetTransition({ version, sunsetDay, zone, now: at, … }); // 6. the domain decides
    if (!outcome.ok) refuse(outcome.reason);
    await updateVersion(tx, version, outcome.changes, at, REFUSALS.sunsetNotSuperseded); // 7. compare-and-set
    await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at)); // 8. effects
    return { ok: true };
  });
  if (result.ok) refreshAfter();                                       // 9. revalidatePath(…) + refresh()
  return result;
}
```

1. `getViewer()` returns the persona ([viewer.ts](viewer.ts)).
2. Input is parsed with zod. The record is then read outside the transaction only to learn its team.
3. `check()` wraps `assertCan` from `@/domain/permissions` and returns the refusal instead of throwing. An unknown id gives `teamId: null`, so a missing record and a forbidden one fail the same way, before any input error.
4. `now()` is read once, before the transaction.
5. `transact(run)` is `inTransaction(db, run)` plus a catch: `refuse(reason)` anywhere inside throws a `Refusal`, which rolls the whole transaction back and becomes `{ ok: false, reason }`.
6. A transition from `@/domain/lifecycle` returns `{ ok: true, changes, effects }` or `{ ok: false, reason }`. The action writes `changes`; it doesn't decide.
7. `updateVersion` updates only while `state`, `rev`, and `currentStage` still match, and bumps `rev`. A miss is refused, so a double click writes nothing. The `rev` bump also makes an autosave still in flight fail rather than land on a frozen version. When the person acts on content they were shown, the client sends the `rev` it was shown with, and the transition refuses a row that has moved on: `submitVersion` takes the submit summary's `rev`, and `submit` refuses with `REFUSALS.summaryStale` when the draft changed after the summary was read.
8. `writeEffects(tx, effects, ctx)` ([effects.ts](effects.ts)) writes audit rows, notifications (to a user or a team role, never to the actor), and consumer notices (consumers with a non-preview render in the last 90 days), all in the same transaction.
9. Only on success: `revalidatePath()` for the other routes that show the change, then `refresh()` to re-render the page the person is on. Route handlers can't call `refresh()`; they use `revalidatePath()` (`src/app/api/imports/route.ts`).

Variations today:
- The result type is `ActionResult<T>` from `@/domain/review-types` (`({ ok: true } & T) | { ok: false; reason: string }`), re-exported by `@/domain/access-types`.
- `Refusal`, `refuse`, `check`, and `transact` are private copies in [actions/review.ts](actions/review.ts), [actions/access.ts](actions/access.ts), and [actions/platform.ts](actions/platform.ts) (where `check` is `checkManage`). [actions/comments.ts](actions/comments.ts) has none of them: its permission check is the domain's (`canComment`, `canActOnThread` in `@/domain/comments`), and it calls `inTransaction` directly, returning a refusal from inside the transaction before anything is written.
- [actions/access.ts](actions/access.ts) reports bad input and a missing record before the permission check. Its `transact` runs `runAccessSweep()` first, in its own transaction, so a refusal doesn't roll the sweep back. Access and platform actions write through `applyMembershipChange` and `writeAccessEffects`; `saveApprovalChain` also calls `writeEffects` with a notification it builds itself.
- `startDraft` and `createTemplate` throw (`PermissionError` from `assertCan`, or `Error`) and end in `redirect()`. `advanceClockAction` and `switchPersona` also throw on bad input. A client sees these as a rejected promise, not a `reason`.
- [actions/notifications.ts](actions/notifications.ts) writes without a transaction; the row's owner is the permission check.

## Anatomy of a read

Pages and components never run SQL. A page renders an async server component inside `<Stream>` (`src/components/primitives/stream.tsx`, a `Suspense` boundary). That component, in `src/components` or in the page file itself, awaits `params` and calls a read model. For example, `src/app/(product)/[team]/templates/[templateId]/versions/page.tsx` renders `src/components/versions/versions-content.tsx`, which calls `getVersions()` from [queries/versions.ts](queries/versions.ts).

A read model:
- is usually wrapped in React `cache()`, so calls within one request share a result. Nothing in `src` uses `"use cache"`; every read happens at request time.
- checks access first. `requireSpace(slug)` returns 404 for an unknown team and redirects when the viewer can't see it. `requireTemplate()` and `requireReviewVersion()` return 404. They call `getViewer()`, which reads cookies, so the caller must sit inside Suspense.
- reads the time through `demoNow()` ([queries/dynamic.ts](queries/dynamic.ts)).
- returns a plain, serializable type declared in `src/domain/*-types.ts` (`VersionsData`, `MembersSection`, …). Dates are ISO strings (`iso()`, `isoOrUndefined()`), days are `YYYY-MM-DD` (`dayOf()`), and people are `Person` (`getPeople()`, `personOf()`). Permissions come decided: `can: { <action>: PermissionResult }`, so a client component can disable a control and show the reason without calling `can()`. The settings sections also carry what each action does, worded by the domain with the demo clock (`consequences: { <action>: string }`), so a screen never words a rule or works out a deadline. See `versionActions()` in [queries/versions.ts](queries/versions.ts) and `getMembersSection()` in [queries/access.ts](queries/access.ts).

Older read models use a different shape. `getWorkspaceHeader` ([queries/workspace.ts](queries/workspace.ts)) and `getLibraryRows` ([queries/library.ts](queries/library.ts)) return `Date` objects, boolean flags (`canEdit`, `canSubmit`), and preformatted strings (`lastEdited`).

Reads a screen makes on demand, when a dialog or a menu opens, are GET route handlers under `src/app/api/templates/[templateId]/`, never server actions: an action is a public POST endpoint that runs one at a time with the page's mutations, so a read would hold up Edit or Submit (or wait behind them). Each route calls `getViewer()` and passes the viewer and the raw request values to its query, which parses them with zod, checks `can()`, writes nothing, and returns a `ReadResult` ([api/reads.ts](api/reads.ts)): the data, or a refusal with its sentence and status (400 unparsable, 403 not permitted, 404 no such template or version, 409 not in a state to read). `readResponse()` sends it as the `ActionResult` the client reads, uncached. The five:

| Route (`/api/templates/[templateId]/…`) | Query | For |
| --- | --- | --- |
| `compare?from=&to=` | `loadVersionsToCompare` ([queries/compare.ts](queries/compare.ts)) | The Compare dialog, per pair of versions (`template.view`). |
| `base-version?draft=` | `getBaseVersion` ([queries/base-version.ts](queries/base-version.ts)) | "Revert to v3" (`draft.edit`). |
| `submit-summary` | `getSubmitSummary` ([queries/submit-summary.ts](queries/submit-summary.ts)) | The submit dialog, and its Refresh summary (`version.submit`). |
| `copilot-prompt` | `getCopilotPrompt` ([queries/copilot.ts](queries/copilot.ts)) | The Copilot prompt dialog (`draft.edit`). |
| `integration` | `loadIntegrationPanel` ([queries/integration.ts](queries/integration.ts)) | The SHARE panel, prefetched on hover or focus of the ring (`integration.view`). |

The ⌘K palette's search is the same kind of read: `GET /api/palette/[space]?q=&template=` calls `searchPalette` ([queries/palette.ts](queries/palette.ts)), which parses the values (a `q` longer than `PALETTE_QUERY_MAX` is a 400), refuses a space the viewer can't see with 404, and lists that space's templates for what was typed, ranked by `paletteTemplates` in [src/domain/palette.ts](../domain/palette.ts), with Recent, `canCreate`, and whether the template being viewed is theirs to see. The palette asks it when it opens and as the viewer types; no page carries templates ([decision 0024](../../docs/decisions/0024-the-palette-searches-on-the-server.md)).

The consumer API's reads in [queries/consumer-api.ts](queries/consumer-api.ts) have no viewer: `requireConsumer()` checks the `X-Consumer-Id` header.

## Database

- **Schema**: [db/schema/ucomp.ts](db/schema/ucomp.ts) holds the app's tables. JSON columns are typed with domain types, and timestamps are `timestamp_ms` integers read as `Date`. [db/schema/sim.ts](db/schema/sim.ts) holds the simulator's `sim_*` tables.
- **Names**: a template has no name column; each version has its own (`versions.name`), copied into a new draft, renamed only in the draft (autosave) and frozen at submit ([decision 0016](../../docs/decisions/0016-the-name-is-versioned.md)). Which one a reader takes:
  - customer output, the name of the version it renders or returns: the render's title, the JSON Schema title, a notice's `templateName` (the notice's own version, in `writeEffects`). Where `/api/v1` speaks of the template (search, detail `name`, the integration panel), the Active version's; with none Active, detail takes the version that still renders (`contractBaseline`), then the newest released.
  - a CMS screen about one version, that version's: the review screen, the review queue, notifications, and an audit event about a version (in the page and the CSV export). A rename shows against what customers get today: `contractBaseline` (the review screen's `liveName`, the submit summary's `baseline`).
  - every other CMS screen, the open draft's name, otherwise the newest version's, and the template id when there's no version: `pickLatest` in [queries/library.ts](queries/library.ts) over a version list, or `currentName()` ([queries/template-name.ts](queries/template-name.ts)) as a SQL column.
- **Client**: [db/client.ts](db/client.ts) exports `db` (Drizzle over libSQL, ucomp schema only), `libsql`, `Db`, and `DATABASE_URL`. The default is `file:./data/ucomp.db`. Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to use Turso. The simulator opens the same file through its own client, `src/simulator/db.ts`.
- **Migrations**: [db/migrations/](db/migrations/) holds the SQL files and `meta/` snapshots, generated from both schema files ([drizzle.config.ts](../../drizzle.config.ts)). To add one: edit the schema, run `npm run db:generate` (drizzle-kit writes the next `NNNN_*.sql`), read the SQL, then apply it with `npm run db:migrate` or `npm run db:reset`. `db:migrate` runs [scripts/db-migrate.ts](../../scripts/db-migrate.ts) with `--conditions=react-server` so `server-only` loads. Nothing migrates at app start. Tests migrate their temp databases from the same folder. If seeded rows need a new column, update `seed/`.

SQLite and libSQL specifics:
- Drizzle's `db.transaction` opens libSQL's default write transaction, `BEGIN IMMEDIATE`, so reads inside it see the `rev` the update will check.
- `createAppClient()` in [src/lib/serialized-writes.ts](../lib/serialized-writes.ts) makes every write in the process take turns on one lock, shared with the simulator's client. Plain reads don't wait. A write waits up to 15 s for its turn, then fails as `SQLITE_BUSY`. The client's busy `timeout` (`BUSY_TIMEOUT_MS`, 5 s) covers locks held by other processes, such as the e2e helpers. That file's header explains why an in-process busy collision must never happen.
- `inTransaction(db, run)` retries a transaction that fails with `SQLITE_BUSY` up to five times (15 ms, doubling). The retry re-reads, so its compare-and-set sees the other write. Use it for every write transaction.
- Partial unique indexes on `versions` (`versions_one_draft`, `versions_one_active`) enforce one open draft and one Active version per template. `startDraft` relies on this when two people press Edit at once.
- `consumer_notices.seq` numbers the outbox in commit order, and the notices API pages on it. `writeEffects` takes the next numbers with `takeNoticeSeqs(tx, count)` inside its transaction, which holds the write lock until it commits, so a notice that becomes visible later always has a higher `seq`. `created_at` can't do this: the action read the clock before its transaction, so two actions can commit in the other order. The last number taken lives in `settings.consumer_notice_seq` and only goes up, so deleting the newest notices (as e2e cleanup does) never hands their numbers out again. A unique index refuses a repeated number. Every insert into `consumer_notices` must take its `seq` this way; the seed numbers its notices 1…n by time and stores n.
- A demo reset starts the numbers again. The notice cursor carries `settings.seeded_at` as its epoch (`noticeEpoch` in [queries/consumer-api.ts](queries/consumer-api.ts)), so a cursor from before a reset is refused rather than read against the new numbers.

**Seed and reset.** `seedDatabase(db, { base })` ([seed/index.ts](seed/index.ts)) builds every row in memory ([seed/context.ts](seed/context.ts)), deterministically (`mulberry32(SEED)`, `seededId()`), with timestamps relative to `base`. It inserts in foreign-key order and returns template ids by seed key, which tests use. `resetDemo()` ([reset.ts](reset.ts)) drops every table, re-runs the migrations, seeds from the current time, zeroes the clock offset, and empties `./data/uploads`. `npm run db:reset` and `resetDemoAction` call it. A fresh clone needs `npm run db:reset` before any page can load a viewer.

**The `sim` schema** belongs to the simulator ("Coral — simulated"). In this layer only `seed/**` and `reset.ts` may import it (lint). `src/simulator/**` and `src/app/(simulator)/**` may import it and nothing else from `@/server`.

## Clock, viewer, and the access sweep

- **Clock** ([clock.ts](clock.ts)): `now()` is the real time plus `settings.clock_offset_days` days. It awaits `connection()` first, which marks the caller as request-time under Cache Components. libSQL resolves in microtasks, so without it a prerender could capture the build's `Date.now()`. `advanceClock(days)` moves the offset. [queries/clock.ts](queries/clock.ts) formats the readout the demo pill shows.
- **Business time zone** ([business-zone.ts](business-zone.ts)): `settings.business_zone`, the zone a sunset date ends at 00:00 in (decision 0017). No row, or a zone off `BUSINESS_ZONES`, reads as `America/New_York`. Actions read it inside their transaction (`readBusinessZone(tx)`); read models call `getBusinessZone()` after `demoNow()` and hand components a sunset's day (`sunsetDay`, YYYY-MM-DD) and the picker's `SunsetCalendar`, never a zone to compute with. `setBusinessZone` in [actions/platform.ts](actions/platform.ts) changes it; it moves no sunset already set.
- **Viewer** ([viewer.ts](viewer.ts)): there is no login. `getViewer()` (React `cache`) reads the `ucomp_persona` cookie and loads that user, with memberships and roles, as a `Viewer` (`@/domain/types`). A missing cookie or an unknown user falls back to `DEFAULT_PERSONA`, `"maya"`: today, every request without a valid cookie acts as Maya. `getPersonas()` lists the switchable users.
- **Access sweep** ([access-sweep.ts](access-sweep.ts)): `runAccessSweep()` applies every access deadline the demo clock has crossed (recertification lapses, the 90-day inactivity flag, the 120-day suspension), backdated, in one transaction. It checks outside a transaction first, so a sweep with nothing to do takes no write lock, and running it twice changes nothing. It runs from `advanceClockAction`, from `switchPersona` (before stamping `last_active_at`), and at the start of every action in [actions/access.ts](actions/access.ts). It doesn't run on a timer or on page reads.

## Render, import, autosave, and route helpers

- **Render** ([render/](render/)): the rules are in [docs/render-spec.md](../../docs/render-spec.md), and the product rule behind them is that every channel prints exactly what the author typed and saw: no rounding, dropping, renumbering, or rewording. `renderTemplate(input)` runs `runRender(db, input, at)` with the app database and the demo clock; [render-template.ts](render/render-template.ts)'s header lists every stage and the error it returns. Stages 1–5 (template, version, who is asking, version rules, channel) need the database. Stages 6–9 are `runEngine` in [engine.ts](render/engine.ts), which needs no database, clock, or request, so the golden files run the same code: values, the document check ([schema-check.ts](render/schema-check.ts)), resolving to a `RenderDoc` (`@/domain/render`), and a channel adapter: [web.ts](render/channels/web.ts) (one HTML document, no scripts), [email.ts](render/channels/email.ts) (subject, preheader, inline-styled HTML, text), or [pdf.tsx](render/channels/pdf.tsx) (`@react-pdf/renderer`). The PDF embeds fonts read from `node_modules` ([pdf-fonts.ts](render/channels/pdf-fonts.ts)) and refuses to render (`UnrenderableCharactersError`) when they can't draw a character, rather than substituting one. [html.ts](render/channels/html.ts) is the markup web and email share, and [look.ts](render/channels/look.ts) holds the colors all three use. [log.ts](render/log.ts) writes one `render_log` row per render that reached a known version, never the values. The route's only caller is `src/app/api/v1/templates/[templateId]/render/route.ts`; the editor preview (`src/components/preview/render-preview.ts`) and the simulator call that route.
- **Import** ([import/](import/)): `POST /api/imports?team=` (`src/app/api/imports/route.ts`) calls `importPermission()` before reading the body, reads it with `readBodyCapped()`, then calls `importTemplate()` ([import/create.ts](import/create.ts)). That sniffs the kind from the bytes, converts, runs `prepareBody()` (a document the check refuses is refused as `content`, and nothing is written), writes the files under `./data/uploads/<uploadId>/` ([store.ts](import/store.ts)), and inserts the template, draft, upload row, and audit event in one transaction, removing the folder if the transaction fails. mammoth and pdf.js run in a worker thread ([isolate.ts](import/isolate.ts) starts [convert-worker.mjs](import/convert-worker.mjs)) with a 256 MB heap and a 30 s timeout. A .docx's zip claims are checked before that ([zip-limits.ts](import/zip-limits.ts)). The worker's path is joined to `process.cwd()` and constructed through `Reflect.construct` so Turbopack leaves it unbundled; keep its imports to packages.
- **Autosave** ([drafts/](drafts/)): `PUT /api/drafts/[versionId]` is a route handler, not an action, because server actions run one at a time per client. It asks `draftAccessRefusal()` ([save-draft.ts](drafts/save-draft.ts), from the version id in the path) before reading the body, so someone who can't edit the draft is answered `not_found` or `forbidden` without a byte of it read; then it reads the body with `readBodyCapped()`. [parse-patch.ts](drafts/parse-patch.ts) checks shape and size. [save-draft.ts](drafts/save-draft.ts) reads the clock and calls `applyDraftPatch(db, …)` ([apply-patch.ts](drafts/apply-patch.ts)), which runs the body through `prepareBody()` and the email subject and preheader through `prepareField()` ([documents/prepare.ts](documents/prepare.ts)) before the transaction. A document they refuse is `invalid`, with the check's sentence. The client runs the same check before sending, so a patch it would refuse is never sent. Inside it, it answers `not_found`, `forbidden`, `not_draft`, `conflict` (a stale `rev`, unless this session wrote it), then `invalid`. It writes with a compare-and-set on `rev` and `state`, adds the saver to the version's `writers` (maker-checker), and keeps one `draft.edited` audit row per editing session ([audit-merge.ts](drafts/audit-merge.ts)). [http.ts](drafts/http.ts) maps the answer to a status. No cache refresh follows a save. The client half is `src/components/workspace/autosave/`.
- **Route helpers** ([api/http.ts](api/http.ts)): `correlationIdOf`, `baseHeaders`, `errorResponse`, `jsonResponse`, and `withDemoDate`, used by the four `/api/v1` handlers. The GET handlers read headers before touching the database so Cache Components treats them as request-time; a POST handler always is. The drafts and imports routes have their own `respond()` helpers.

Body caps, all counted in bytes as the stream is read ([import/read-body.ts](import/read-body.ts)), after a declared `Content-Length` over the cap is refused unread: import allows 10 MiB plus 64 KiB of multipart slack, autosave 2,000,000 (`MAX_BODY_SIZE`), render 1,000,000 (`MAX_BODY_BYTES`). Each answers 413 past it. Server actions cap bodies at 1 MB, which is why import is a route handler.

Each entry point has a fixed error shape: `ActionResult` (`reason`) for actions and the on-demand read routes, `DraftSaveResponse` (`error`, `message`, `rev?`) for autosave, `ImportResponse` (`code`, `reason`) for import, and `{ error: { code, message } }` for `/api/v1`. Use the one your entry point already uses.

## Demo-only paths

These stand in for things a production deployment would have. None is gated by environment today.
- [actions/demo.ts](actions/demo.ts): `resetDemoAction` (drops and reseeds the database, empties uploads, sets the cookie to Maya) and `advanceClockAction` check no permission. The demo pill that calls them renders in `src/components/app-shell/app-frame.tsx` and `src/app/(simulator)/layout.tsx` in every build.
- [actions/persona.ts](actions/persona.ts): `switchPersona` sets the cookie to any seeded persona, including the Platform Admin (`riley`) and the Auditor (`taylor`), without checking the caller.
- `/api/v1`: a consumer is identified by the `X-Consumer-Id` header alone, with no credential. A preview render acts as the cookie's persona, so Maya by default.
- The clock offset applies to every time the app reads, and `withDemoDate` puts the demo time in `/api/v1` `Date` headers.
- [import/store.ts](import/store.ts) keeps uploads in `./data/uploads`, standing in for blob storage.

## Copy these

| When you need to… | Copy | Notes |
| --- | --- | --- |
| Write a mutation that returns a result | `setSunset`, `approveVersion` in [actions/review.ts](actions/review.ts) | The shape above. Its helpers are private copies (see below). |
| Give several actions one shape | `memberAction()` in [actions/access.ts](actions/access.ts) | Five member actions share one find, check, and transaction. |
| Write a transition's side records | `writeEffects()` in [effects.ts](effects.ts), `writeAccessEffects()` in [access-effects.ts](access-effects.ts) | Always inside the caller's `tx`. |
| Build a read model with permissions | `getVersions()` and `versionActions()` in [queries/versions.ts](queries/versions.ts) | ISO strings and `can: PermissionResult`. |
| Gate a page by space or template | `requireSpace()` in [queries/spaces.ts](queries/spaces.ts), `requireTemplate()` in [queries/review-shared.ts](queries/review-shared.ts) | 404 or redirect, cached per request. |
| Serve a read a screen loads on demand | `getBaseVersion` in [queries/base-version.ts](queries/base-version.ts) with `src/app/api/templates/[templateId]/base-version/route.ts` | The query takes the viewer, parses with zod, checks `can()`, returns a `ReadResult`; the route is `getViewer()` and `readResponse()`. Add the read's name to `TemplateRead` in `src/lib/template-reads.ts`. |
| Make a database function testable | `applyDraftPatch(db, …)` in [drafts/apply-patch.ts](drafts/apply-patch.ts), `runRender(db, input, at)` in [render/render-template.ts](render/render-template.ts) | Database and time are arguments; a thin wrapper passes the real ones. |
| Insert inside the caller's transaction | `insertNewTemplate()` in [templates/create.ts](templates/create.ts) | Shared by New template and Import. |
| Add an `/api/v1` handler | `src/app/api/v1/templates/route.ts` with [api/http.ts](api/http.ts) | Headers first, `withDemoDate`, contract errors. |
| Read a request body in a route handler | `readBodyCapped()` ([import/read-body.ts](import/read-body.ts)) as `src/app/api/imports/route.ts` and `src/app/api/drafts/[versionId]/route.ts` use it | Permission before the body. Never `request.text()` or `.json()`: they buffer a chunked body whole. |
| Test an action end to end | [actions/review.test.ts](actions/review.test.ts) | Temp database, real seed, mocked clock and viewer. |

## Don't copy

- **Copied helpers.** `Refusal`, `refuse`, `check`, and `transact` are copied in three action files. Follow their shape. If another file needs them, move them to one shared server module rather than adding a copy.
- **Throwing actions.** `startDraft` and `createTemplate` throw instead of returning `ActionResult`. New actions return a result.
- **A second busy retry.** [drafts/apply-patch.ts](drafts/apply-patch.ts) has its own `isBusy` and `retryWhenBusy`, and [import/create.ts](import/create.ts) calls `db.transaction` with no retry. Use `inTransaction()`.
- **A second `draftRow`.** [actions/review.ts](actions/review.ts) keeps a private copy of `draftRow` from [templates/create.ts](templates/create.ts). Import the shared one.
- **`submitDraft`** in [actions/templates.ts](actions/templates.ts) is an alias for `submitVersion` that only a test calls. Call `submitVersion`.
- **Rules outside the domain.** The Auditor checks in `createTeam` ([actions/platform.ts](actions/platform.ts)) and `requestAccess` ([actions/access.ts](actions/access.ts)), and the published-channels filter in [queries/consumer-api.ts](queries/consumer-api.ts) are business rules in this layer. New rules go in `src/domain`.
- **Server importing components.** [actions/create-template.ts](actions/create-template.ts) imports `@/components/workspace/just-created`, and [queries/submit-summary.ts](queries/submit-summary.ts) imports from `@/components/preview/sample-sets/model` and `@/components/submit/types`. No lint rule stops this. Put shared types and constants in `src/domain`.
- **Older read-model shapes.** `getWorkspaceHeader` and `getLibraryRows` return `Date` objects and booleans. Return ISO strings and `can` results.
- **Patching a domain result.** [import/create.ts](import/create.ts) overwrites `starterKey` and the audit details on the result of `createDraft()`. Have the domain return the right result.
- **Formatting here.** [queries/format.ts](queries/format.ts) has no `server-only` because it reaches a client component through `src/components/review-queue/format-row.ts`. `DAY_MS` is redefined in several files, though `src/domain/access.ts` exports it. Date formatting belongs in `src/domain/dates.ts`.

## Testing

Tests sit beside the code as `*.test.ts`. Run them with `npx vitest run src/server`; the whole layer takes a few seconds and never touches `data/ucomp.db`. The environment is `node`; the web and email channel tests opt into happy-dom with a `// @vitest-environment happy-dom` comment. [vitest.config.mts](../../vitest.config.mts) aliases `server-only` to `scripts/empty.ts`, so tests import server modules directly.

Two ways to get a database:
- **Code that imports `db`** (actions, queries, import): mock the client module with a temp file, then migrate and seed it. Also mock the clock, the viewer, and `next/cache` (`refresh()` works only inside a real server action). From [actions/review.test.ts](actions/review.test.ts):

  ```ts
  vi.mock("@/server/db/client", async () => {
    const { tempDatabase } = await import("@/server/testing/review-fixtures");
    const temp = tempDatabase("ucomp-review-actions-");
    env.dir = temp.dir;
    return temp;
  });
  vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
  vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
  vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
  // beforeAll: migrate(db, { migrationsFolder: "./src/server/db/migrations" }); seedDatabase(db, { base: BASE });
  ```

  `loadPersona(db, id)` builds a `Viewer` the way `getViewer()` does, and `createTemplateWithDraft()` adds a fresh template.
- **Code that takes `db` as an argument** (`writeEffects`, `applyDraftPatch`, `runRender`, the seed): open a temp file and pass the handle, as [effects.test.ts](effects.test.ts) does. These tests use a raw `createClient`; `tempDatabase()` uses `createAppClient`, as the app does.

**Golden files.** [render/golden/](render/golden/README.md) freezes every channel's output for a set of documents, and checks that web, email, and PDF all show the `RenderDoc`'s content. A change that moves one byte of output fails `npm test` until someone regenerates the files with `npm run golden:update` and reads the diff. That README covers adding a case and reviewing a diff. [render/testing/](render/testing/) holds the shared fixture shape, small TipTap JSON builders, and `fresh-process.ts`, which renders in a new Node process for the determinism test.

Fixtures: [render/channels/\_\_fixtures\_\_/](render/channels/__fixtures__/) holds hand-built `RenderDoc`s. The import tests read `e2e/fixtures/import/`, generated by its `make-fixtures.mjs`.
