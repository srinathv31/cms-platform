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
- A `"use server"` file may export only async functions (type exports are erased, so they're fine). That is why an action file's own helpers are private, and why the helpers every action shares live in [actions/kit.ts](actions/kit.ts), which isn't `"use server"`.

## Layout

| Path | What it holds |
| --- | --- |
| [actions/](actions/) | `"use server"` mutations, one file per area: [review.ts](actions/review.ts) (submit, approve, request changes, sunset, revoke), [comments.ts](actions/comments.ts), [access.ts](actions/access.ts), [platform.ts](actions/platform.ts), [templates.ts](actions/templates.ts) (`startDraft`), [create-template.ts](actions/create-template.ts), [notifications.ts](actions/notifications.ts), [persona.ts](actions/persona.ts), [demo.ts](actions/demo.ts). [kit.ts](actions/kit.ts) is the server action kit they run on (`serverAction`, `check`, `permit`, `refuse`), not an action itself. No reads: those are GET routes (see [Anatomy of a read](#anatomy-of-a-read)). |
| [queries/](queries/) | Read models, mostly `cache()`d `get…` functions for server components. [spaces.ts](queries/spaces.ts) (`requireSpace`, the shell) and [review-shared.ts](queries/review-shared.ts) (`requireTemplate`, people, chain and ISO date helpers) are shared. [template-name.ts](queries/template-name.ts) (`currentName`) is the name a CMS list shows. [consumer-api.ts](queries/consumer-api.ts) serves `/api/v1`. Five reads serve the GET routes a screen calls on demand, and [palette.ts](queries/palette.ts) (`searchPalette`) the ⌘K palette's search (see below). |
| [db/](db/) | [client.ts](db/client.ts), [schema/ucomp.ts](db/schema/ucomp.ts) (app tables), [schema/sim.ts](db/schema/sim.ts) (simulator tables), [migrations/](db/migrations/). |
| [effects.ts](effects.ts) | `inTransaction` (the busy retry), `writeEffects` (audit rows, notifications, consumer notices; a null actor is the system), `takeNoticeSeqs`, `Tx`. |
| [access-effects.ts](access-effects.ts) | `applyMembershipChange` and `writeAccessEffects`: the same job for access and platform changes. |
| [access-sweep.ts](access-sweep.ts) | `runAccessSweep()` and the membership, request, and recertification fact loaders. |
| [sunset-sweep.ts](sunset-sweep.ts) | `runSunsetSweep()`: one `version.sunset_passed` audit row, and a `sunset_passed` notice to each of the template's consumers, for each sunset the clock has passed. |
| [viewer.ts](viewer.ts), [clock.ts](clock.ts), [ids.ts](ids.ts) | The persona, the demo clock, and id generation (`newId`, `newTemplateId`, seeded variants). |
| [business-zone.ts](business-zone.ts) | The business time zone sunset dates are read in: `readBusinessZone(reader)` (inside a transaction), `getBusinessZone()` (read models), `countPendingSunsets`. |
| [reset.ts](reset.ts), [seed/](seed/) | `resetDemo()` and the deterministic demo dataset, simulator rows included. |
| [templates/create.ts](templates/create.ts) | The write side of "new template plus first draft", shared by New template and Import. |
| [starters/](starters/) | Starters for each kind of template: document bodies, and alerts' push and SMS ([alerts.ts](starters/alerts.ts)). [catalog.ts](starters/catalog.ts) has only a type import, so the client gallery can read it. |
| [drafts/](drafts/) | Autosave: patch parsing, the transactional save, the per-session audit merge, the status table. |
| [documents/prepare.ts](documents/prepare.ts) | The one way a document is made ready for storage: normalized, checked, block ids added. Autosave and import call it. |
| [render/](render/) | The render pipeline ([render-template.ts](render/render-template.ts)), the engine it runs ([engine.ts](render/engine.ts)), the document check, the render log, [channels/](render/channels/) (web, email, pdf, push, sms), the [golden files](render/golden/README.md), and shared test helpers in [testing/](render/testing/). |
| [import/](import/) | File import: sniffing, converters, worker isolation, zip limits, capped body reads, upload storage. |
| [api/http.ts](api/http.ts), [api/reads.ts](api/reads.ts) | Response helpers for the `/api/v1` route handlers; `ReadResult` and `readResponse` for the on-demand read routes. |
| [testing/review-fixtures.ts](testing/review-fixtures.ts) | `tempDatabase`, `loadPersona`, `createTemplateWithDraft` for tests. |

## Anatomy of a mutation

Every action runs on the server action kit, `serverAction` in [actions/kit.ts](actions/kit.ts): the action
declares its steps, and the kit runs them in one order. The kit is a plain `server-only` module, not `"use server"`,
so its helpers are shared instead of copied into each action file. Trimmed from `setSunset` in
[actions/review.ts](actions/review.ts):

```ts
"use server";
export async function setSunset(input: { templateId: string; versionNumber: number; sunsetAt: string }): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {                                          // 1. getViewer()
    input: SunsetInput,                                                 // 2. parse (zod)
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(input.templateId, input.versionNumber); //    read only to learn the team
      check(viewer, "version.setSunset", { teamId: found?.teamId ?? null });  // 3. permission
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      if (!isCalendarDay(input.sunsetAt)) refuse(REQUEST_REFUSALS.invalidDate);
      return found;
    },                                                                  // 4. now(), once
    transaction: async (tx, { viewer, input, found, now: at }) => {     // 5. one transaction
      const version = await loadVersion(tx, found, input.versionNumber); //    re-read inside it
      const zone = await readBusinessZone(tx);                          //    and the settings it needs
      const outcome = setSunsetTransition({ version, sunsetDay: input.sunsetAt, zone, now: at, … }); // 6. the domain decides
      if (!outcome.ok) refuse(outcome);
      await updateVersion(tx, version, outcome.changes, at, REFUSALS.sunsetNotSuperseded); // 7. compare-and-set
      await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at)); // 8. effects
      wrote = true;
      return { ok: true };
    },
    after: () => {                                                      // 9. revalidatePath(…) + refresh()
      if (wrote) refreshAfter();
    },
  });
}
```

1. `getViewer()` returns the persona ([viewer.ts](viewer.ts)).
2. The input is parsed with zod. Input that doesn't parse is refused with `REQUEST_REFUSALS.invalidInput()` ("Check the form and try again."), or with the action's own refusal (`invalid`): access actions give the parser's first problem, `markNotificationRead` answers `notification_gone`.
3. `authorize` reads the record outside the transaction, only to learn its team and people, then checks: `check(viewer, action, resource)` asks `can()` from `@/domain/permissions`, and `permit(result)` takes a domain rule's answer (`canComment`, `canActOnThread`). An unknown id gives `teamId: null`, so a missing record and a forbidden one fail the same way. Then it refuses what the request can't be: the record is gone, a note is too long, a date isn't one. It returns what the transaction needs (`found`).
4. `now()` is read once, before the transaction, and handed to every step after it.
5. `transaction` runs inside `inTransaction(db, …)`, retried when SQLite is busy. `refuse(refusal)` anywhere in `authorize` or the transaction throws a `RefusalError`, which rolls the transaction back and becomes `{ ok: false, code, reason }`; a transaction that returns a refusal is rolled back the same way. Anything else thrown is a bug and propagates. Every refusal is an entry from a domain table ([domain/refusals.ts](../domain/refusals.ts)): what the action itself checks before the rule runs (input, a record that's gone, a compare-and-set that missed) comes from `REQUEST_REFUSALS`.
6. A transition from `@/domain/lifecycle` returns `{ ok: true, changes, effects }` or `{ ok: false, code, reason }`. The action writes `changes`; it doesn't decide.
7. `updateVersion` updates only while `state`, `rev`, and `currentStage` still match, and bumps `rev`. A miss is refused, so a double click writes nothing. The `rev` bump also makes an autosave still in flight fail rather than land on a frozen version. When the person acts on content they were shown, the client sends the `rev` it was shown with, and the transition refuses a row that has moved on: `submitVersion` takes the submit summary's `rev`, and `submit` refuses with `REFUSALS.summaryStale` (code `summary_stale`) when the draft changed after the summary was read.
8. `writeEffects(tx, effects, ctx)` ([effects.ts](effects.ts)) writes audit rows, notifications (to a user or a team role, never to the actor), and consumer notices (consumers with a non-preview render of the template from 90 days before `ctx.at` on), all in the same transaction. `ctx.at` is when it happened and dates the audit rows; `ctx.writtenAt`, which only the sunset sweep sets, dates the notifications and notices when it's later.
9. `after` runs only once the transaction committed with `ok`: `revalidatePath()` for the other routes that show the change, then `refresh()` to re-render the page the person is on, and `redirect()` last (`startDraft`, `createTemplate`). Next's redirect passes through the kit untouched. Route handlers can't call `refresh()`; they use `revalidatePath()` (`src/app/api/imports/route.ts`).

The result type is `ActionResult<T>` from `@/domain/review-types` (`({ ok: true } & T) | Refused`, where `Refused` is `{ ok: false; code; reason }`), re-exported by `@/domain/access-types`. The browser runs actions with `useActionRun` (`src/components/primitives/use-action-run.ts`).

Variations today:
- [actions/access.ts](actions/access.ts) runs its actions through `accessAction`, the kit plus two things: `runAccessSweep()` and `runSunsetSweep()` run once the check has passed, each in its own transaction, so a refusal doesn't roll a sweep back (and the pages refresh when one changed something, whatever the answer); and a request, membership or review that's gone is refused with its own sentence before the permission check, since a colleague acting first deletes it. Access and platform actions write through `applyMembershipChange` and `writeAccessEffects`; `saveApprovalChain` also calls `writeEffects` with a notification it builds itself.
- `startDraft` and `createTemplate` answer a refusal (a newer version in review, a viewer who can't edit or create) and redirect on success. `createTemplate` takes the kind the author chose (`family`, Document or Alert) with a starter of that kind, and reads the content type the domain picks for it and a fresh template id inside its transaction (`newTemplateType(family, tx)`, `freshTemplateId(tx)`); Import always makes a document, and reads them through `db`.
- [actions/demo.ts](actions/demo.ts) and [actions/persona.ts](actions/persona.ts) are demo tools: no permission to check, and the modules they call write in their own transactions, so they don't run on the kit. Input they can't use is answered with `invalid_input`.

## Anatomy of a read

Pages and components never run SQL. A page renders an async server component inside `<Stream>` (`src/components/primitives/stream.tsx`, a `Suspense` boundary). That component, in `src/components` or in the page file itself, awaits `params` and calls a read model. For example, `src/app/(product)/[team]/templates/[templateId]/versions/page.tsx` renders `src/components/versions/versions-content.tsx`, which calls `getVersions()` from [queries/versions.ts](queries/versions.ts).

A read model:
- is usually wrapped in React `cache()`, so calls within one request share a result. Nothing in `src` uses `"use cache"`; every read happens at request time.
- checks access first. `requireSpace(slug)` returns 404 for an unknown team and redirects when the viewer can't see it. `requireTemplate()` and `requireReviewVersion()` return 404. They call `getViewer()`, which reads cookies, so the caller must sit inside Suspense.
- reads the time through `demoNow()` ([queries/dynamic.ts](queries/dynamic.ts)).
- returns a plain, serializable type declared in `src/domain/*-types.ts` (`VersionsData`, `MembersSection`, …). Dates are ISO strings (`iso()`, `isoOrUndefined()`), days are `YYYY-MM-DD` (`utcDay()` from `@/domain/dates`), and people are `Person` (`getPeople()`, `personOf()`). Permissions come decided: `can: { <action>: PermissionResult }`, so a client component can disable a control and show the reason without calling `can()`, and tell one refusal from another by its `code`. The settings sections also carry what each action does, worded by the domain with the demo clock (`consequences: { <action>: string }`), so a screen never words a rule or works out a deadline. See `versionActions()` in [queries/versions.ts](queries/versions.ts) and `getMembersSection()` in [queries/access.ts](queries/access.ts).

Older read models use a different shape. `getWorkspaceHeader` ([queries/workspace.ts](queries/workspace.ts)) and `getLibraryRows` ([queries/library.ts](queries/library.ts)) return `Date` objects, boolean flags (`canEdit`, `canSubmit`), and preformatted strings (`lastEdited`).

Reads a screen makes on demand, when a dialog or a menu opens, are GET route handlers under `src/app/api/templates/[templateId]/`, never server actions: an action is a public POST endpoint that runs one at a time with the page's mutations, so a read would hold up Edit or Submit (or wait behind them). Each route calls `getViewer()` and passes the viewer and the raw request values to its query, which parses them with zod, checks `can()`, writes nothing, and returns a `ReadResult` ([api/reads.ts](api/reads.ts)): the data, or a refusal with its code, its sentence and a status (400 unparsable, 403 not permitted, 404 no such template or version, 409 not in a state to read). `readResponse()` sends it as the `ActionResult` the client reads, uncached. The five:

| Route (`/api/templates/[templateId]/…`) | Query | For |
| --- | --- | --- |
| `compare?from=&to=` | `loadVersionsToCompare` ([queries/compare.ts](queries/compare.ts)) | The Compare dialog, per pair of versions: the template's family, and each version's name, body, channel fields and SMS footer (`template.view`). |
| `base-version?draft=` | `getBaseVersion` ([queries/base-version.ts](queries/base-version.ts)) | "Revert to v3" (`draft.edit`). |
| `submit-summary` | `getSubmitSummary` ([queries/submit-summary.ts](queries/submit-summary.ts)) | The submit dialog, and its Refresh summary (`version.submit`). |
| `copilot-prompt` | `getCopilotPrompt` ([queries/copilot.ts](queries/copilot.ts)) | The Copilot prompt dialog (`draft.edit`). |
| `integration` | `loadIntegrationPanel` ([queries/integration.ts](queries/integration.ts)) | The SHARE panel, prefetched on hover or focus of the ring (`integration.view`). |

The ⌘K palette's search is the same kind of read: `GET /api/palette/[space]?q=&template=` calls `searchPalette` ([queries/palette.ts](queries/palette.ts)), which parses the values (a `q` longer than `PALETTE_QUERY_MAX` is a 400), refuses a space the viewer can't see with 404, and lists that space's templates for what was typed, ranked by `paletteTemplates` in [src/domain/palette.ts](../domain/palette.ts), with Recent, `canCreate`, and whether the template being viewed is theirs to see. The palette asks it when it opens and as the viewer types; no page carries templates ([decision 0024](../../docs/decisions/0024-the-palette-searches-on-the-server.md)).

The consumer API's reads in [queries/consumer-api.ts](queries/consumer-api.ts) have no viewer: `requireConsumer()` checks the `X-Consumer-Id` header.

## Database

- **Schema**: [db/schema/ucomp.ts](db/schema/ucomp.ts) holds the app's tables. JSON columns are typed with domain types, and timestamps are `timestamp_ms` integers read as `Date`. [db/schema/sim.ts](db/schema/sim.ts) holds the simulator's `sim_*` tables.
- **Channel fields**: a version's short fields of its own per channel (today only Email's subject and preheader) live in one JSON column, `versions.channel_fields`, keyed by channel and then by field key, `{ "email": { "subject": <doc>, "preheader": <doc> } }`, a field with no value left out. The registry in `src/domain/channel-fields.ts` declares them; the seed, the read models, autosave, submit and render all loop over it, and nothing here names a field. The workspace and a draft patch hold them flat, one key per field id (`"email.subject"`).
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

The platform ([seed/platform.ts](seed/platform.ts)) has two content types, each with a one-stage chain: Disclosure
(documents: PDF, Web and Email, three required sections) and Alert (messages: Push and SMS, no sections, the SMS
footer "Coral Offers: Reply STOP to opt out, HELP for help." and a 3-part budget). Every seeded team has an app name
and a fictional short code its messages come from, so no preview shows the fallback: Coral Offers sends as "Coral"
from 26725, Deposits as "Deposits Online" from 33767, and Card Statements as "Card Center" from 22737
([seed/teams.ts](seed/teams.ts)). The submit action reads the content type's footer and budget with
`loadMessageRules` ([queries/review-shared.ts](queries/review-shared.ts)), and freezes the footer into the version
(`versions.sms_footer`, migration 0011): render, the review screen, Compare and Coral print a submitted version's own
footer, and only a draft takes the content type's as it stands (`smsFooterOf`). The template's family comes from its
content type too (`loadFamily`, `contentTypeFamily`), never a version's channels. The
workspace's and the review screen's read models carry them and the team's senders (`messageRules`, `senders`) for
the message composer and the phone preview, which render in the browser
([decision 0035](../../docs/decisions/0035-message-previews-resolve-in-the-browser.md)); the workspace's also says
which family the template is (`family`), which picks the editor or the composer.

The templates are declared in [seed/templates/](seed/templates/), one `SeedTemplate` each, and `buildTemplate`
([seed/templates/build.ts](seed/templates/build.ts)) derives every row from it: the template, its versions,
approvals, comment threads, audit events and consumer notices. A template names its content type (`contentType`,
Disclosure unless it says Alert), and the build checks each version against it: the required sections in order, and
only channels the type allows. Coral Offers has five disclosures ([coral.ts](seed/templates/coral.ts)), one in each
lifecycle state, and three alerts ([coral-alerts.ts](seed/templates/coral-alerts.ts)): Payment Due Reminder (v1
Active, rendered by Coral as push and SMS every day), Card Used Abroad (v1 waiting for an approver) and Rate Change
Heads-up (a draft that pairs with the Rate Change Notice letter). An alert's body is one empty paragraph; its push
and SMS are channel fields, and every seeded alert passes submit's message rules with its own sample sets
(`seed.test.ts`). Deposits ([deposits.ts](seed/templates/deposits.ts)) and Card Statements
([card-statements.ts](seed/templates/card-statements.ts)) have three disclosures each. The alerts are built last, so
the ids seeded before them stay the same. [seed/history.ts](seed/history.ts) writes about 90 days of renders (about
31,000 rows: daily streams, previews, a few failures and the latest renders), and
[seed/activity.ts](seed/activity.ts) the notifications, access requests and recertification.

**The `sim` schema** belongs to the simulator ("Coral — simulated"). In this layer only `seed/**` and `reset.ts` may import it (lint). `src/simulator/**` and `src/app/(simulator)/**` may import it and nothing else from `@/server`.

## Clock, viewer, and the access sweep

- **Clock** ([clock.ts](clock.ts)): `now()` is the real time plus `settings.clock_offset_days` days. It awaits `connection()` first, which marks the caller as request-time under Cache Components. libSQL resolves in microtasks, so without it a prerender could capture the build's `Date.now()`. `advanceClock(days)` moves the offset. [queries/clock.ts](queries/clock.ts) formats the readout the demo pill shows.
- **Business time zone** ([business-zone.ts](business-zone.ts)): `settings.business_zone`, the zone a sunset date ends at 00:00 in (decision 0017). No row, or a zone off `BUSINESS_ZONES`, reads as `America/New_York`. Actions read it inside their transaction (`readBusinessZone(tx)`); read models call `getBusinessZone()` after `demoNow()` and hand components a sunset's day (`sunsetDay`, YYYY-MM-DD) and the picker's `SunsetCalendar`, never a zone to compute with. `setBusinessZone` in [actions/platform.ts](actions/platform.ts) changes it; it moves no sunset already set.
- **Viewer** ([viewer.ts](viewer.ts)): there is no login. `getViewer()` (React `cache`) reads the `ucomp_persona` cookie and loads that user, with memberships and roles, as a `Viewer` (`@/domain/types`). A missing cookie or an unknown user falls back to `DEFAULT_PERSONA`, `"maya"`: today, every request without a valid cookie acts as Maya. `getPersonas()` lists the switchable users.
- **Access sweep** ([access-sweep.ts](access-sweep.ts)): `runAccessSweep()` applies every access deadline the demo clock has crossed (recertification lapses, the 90-day inactivity flag, the 120-day suspension), backdated, in one transaction. It checks outside a transaction first, so a sweep with nothing to do takes no write lock, and running it twice changes nothing. It runs from `advanceClockAction`, from `switchPersona` (before stamping `last_active_at`), and in every action in [actions/access.ts](actions/access.ts), once its permission check has passed and before its transaction. It doesn't run on a timer or on page reads.
- **Sunset sweep** ([sunset-sweep.ts](sunset-sweep.ts)): `runSunsetSweep()` writes a `version.sunset_passed` audit row and a `sunset_passed` consumer notice, through `writeEffects` with a null actor, for each sunset the demo clock has passed that no row records yet (`sweepSunsets` in `@/domain/lifecycle` decides). Each row is dated at its sunset and names the day in the business time zone. The notice carries the same instant, day and zone and the template's Active version, goes to the consumers that rendered the template from 90 days before the sunset on, takes the next `seq`, and is created when the sweep runs (`writtenAt`), so it can arrive after the sunset. Like the access sweep it checks outside a transaction first, writes in one transaction, changes nothing the second time, and runs from the same three places, after it. It only records: whether a version renders is `sunsetPassed` at render time. The scheduled job that should call both sweeps comes with real sign-in ([handoff review S4](../../docs/handoff-review.md#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep), [decision 0026](../../docs/decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md), [decision 0032](../../docs/decisions/0032-consumers-are-told-when-a-sunset-passes.md)).

## Render, import, autosave, and route helpers

- **Render** ([render/](render/)): the rules are in [docs/render-spec.md](../../docs/render-spec.md), and the product rule behind them is that every channel prints exactly what the author typed and saw: no rounding, dropping, renumbering, or rewording. `renderTemplate(input)` runs `runRender(db, input, at)` with the app database and the demo clock; [render-template.ts](render/render-template.ts)'s header lists every stage and the error it returns. Stages 1–5 (template, version, who is asking, version rules, channel) need the database. Stages 6–9 are `runEngine(input, target, at)` in [engine.ts](render/engine.ts), which needs no database, clock, or request, so the golden files run the same code. The target is the channel and, for a push, its platform (`renderTarget` in `src/domain/render/errors.ts` refuses a push without one, a platform on another channel, and an encoding on push or SMS). For a document channel: values, the document check ([schema-check.ts](render/schema-check.ts)), resolving to a `RenderDoc` (`@/domain/render`) and the channel's own fields to text (the registry in `src/domain/channel-fields.ts`, each field by its shape), and a channel adapter: [web.ts](render/channels/web.ts) (one HTML document, no scripts), [email.ts](render/channels/email.ts) (subject, preheader, inline-styled HTML, text), or [pdf.tsx](render/channels/pdf.tsx) (`@react-pdf/renderer`). For a message channel the body is never read: values, the field check, then [push.ts](render/channels/push.ts) or [sms.ts](render/channels/sms.ts), each a thin call into `renderMessage` (`src/domain/render/message.ts`), the function the browser preview runs too. It resolves the fields, adds the content type's SMS footer, measures the push's payload or the SMS's parts, and refuses past the limit with 422 `push_payload_too_large` or `sms_too_long`, which the route doesn't log as a failure. The PDF embeds fonts read from `node_modules` ([pdf-fonts.ts](render/channels/pdf-fonts.ts)) and refuses to render (`UnrenderableCharactersError`) when they can't draw a character, rather than substituting one. [html.ts](render/channels/html.ts) is the markup web and email share, and [look.ts](render/channels/look.ts) holds the colors all three use. [log.ts](render/log.ts) writes one `render_log` row per render that reached a known version, never the values. The route's only caller is `src/app/api/v1/templates/[templateId]/render/route.ts`; the editor preview (`src/components/preview/render-preview.ts`) and the simulator call that route. Everything here that differs by channel is a `switch` ending in `assertNever` (`src/domain/assert-never.ts`) or a `Record<Channel, …>`: the engine's adapter, the route's response, the file extension.
- **Import** ([import/](import/)): `POST /api/imports?team=` (`src/app/api/imports/route.ts`) calls `importPermission()` before reading the body, reads it with `readBodyCapped()`, then calls `importTemplate()` ([import/create.ts](import/create.ts)). That sniffs the kind from the bytes, converts, runs `prepareBody()` (a document the check refuses is refused as `content`, and nothing is written), writes the files under `./data/uploads/<uploadId>/` ([store.ts](import/store.ts)), and inserts the template, draft, upload row, and audit event in one transaction, removing the folder if the transaction fails. mammoth and pdf.js run in a worker thread ([isolate.ts](import/isolate.ts) starts [convert-worker.mjs](import/convert-worker.mjs)) with a 256 MB heap and a 30 s timeout. A .docx's zip claims are checked before that ([zip-limits.ts](import/zip-limits.ts)). The worker's path is joined to `process.cwd()` and constructed through `Reflect.construct` so Turbopack leaves it unbundled; keep its imports to packages.
- **Autosave** ([drafts/](drafts/)): `PUT /api/drafts/[versionId]` is a route handler, not an action, because server actions run one at a time per client. It asks `draftAccessRefusal()` ([save-draft.ts](drafts/save-draft.ts), from the version id in the path) before reading the body, so someone who can't edit the draft is answered `not_found` or `forbidden` without a byte of it read; then it reads the body with `readBodyCapped()`. [parse-patch.ts](drafts/parse-patch.ts) checks shape and size. [save-draft.ts](drafts/save-draft.ts) reads the clock and calls `applyDraftPatch(db, …)` ([apply-patch.ts](drafts/apply-patch.ts)), which runs the body through `prepareBody()` and each channel field the patch names (by id, `"email.subject"`; null clears one) through `prepareField(doc, field)` ([documents/prepare.ts](documents/prepare.ts)) before the transaction, looping over the registry (`src/domain/channel-fields.ts`): normalized for its shape (an SMS keeps its line breaks) and checked in its channel's words. A document they refuse is `invalid`, with the check's sentence. The client runs the same check before sending, so a patch it would refuse is never sent. Inside it, it answers `not_found`, `forbidden`, `not_draft`, `conflict` (a stale `rev`, unless this session wrote it), then `invalid`. It lays the channel fields over the version's stored `channel_fields` (read in the transaction, so the fields the patch doesn't name are kept), writes with a compare-and-set on `rev` and `state`, adds the saver to the version's `writers` (maker-checker), and keeps one `draft.edited` audit row per editing session ([audit-merge.ts](drafts/audit-merge.ts)). [http.ts](drafts/http.ts) maps the answer to a status. No cache refresh follows a save. The client half is `src/components/workspace/autosave/`.
- **Route helpers** ([api/http.ts](api/http.ts)): `correlationIdOf`, `baseHeaders`, `errorResponse`, `jsonResponse`, and `withDemoDate`, used by the four `/api/v1` handlers. The GET handlers read headers before touching the database so Cache Components treats them as request-time; a POST handler always is. The drafts and imports routes have their own `respond()` helpers.

Body caps, all counted in bytes as the stream is read ([import/read-body.ts](import/read-body.ts)), after a declared `Content-Length` over the cap is refused unread: import allows 10 MiB plus 64 KiB of multipart slack, autosave 2,000,000 (`MAX_BODY_SIZE`), render 1,000,000 (`MAX_BODY_BYTES`). Each answers 413 past it. Server actions cap bodies at 1 MB, which is why import is a route handler.

Each entry point has a fixed error shape: `ActionResult` (`code`, `reason`) for every action and the on-demand read routes, `DraftSaveResponse` (`error`, `message`, `rev?`) for autosave, `ImportResponse` (`code`, `reason`) for import, and `{ error: { code, message } }` for `/api/v1`. Use the one your entry point already uses.

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
| Write a mutation | `serverAction` in [actions/kit.ts](actions/kit.ts), as `setSunset` and `approveVersion` in [actions/review.ts](actions/review.ts) use it | The shape above. Test a new kit step in [actions/kit.test.ts](actions/kit.test.ts). |
| Give several actions one shape | `memberAction()` in [actions/access.ts](actions/access.ts) | Five member actions share one find, check, and transaction, on `accessAction`. |
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

- **A second busy retry.** [drafts/apply-patch.ts](drafts/apply-patch.ts) has its own `isBusy` and `retryWhenBusy`, and [import/create.ts](import/create.ts) calls `db.transaction` with no retry. Use `inTransaction()`.
- **A second `draftRow`.** [actions/review.ts](actions/review.ts) keeps a private copy of `draftRow` from [templates/create.ts](templates/create.ts). Import the shared one.
- **`submitDraft`** in [actions/templates.ts](actions/templates.ts) is an alias for `submitVersion` that only a test calls. Call `submitVersion`.
- **Rules outside the domain.** The Auditor checks in `createTeam` ([actions/platform.ts](actions/platform.ts)) and `requestAccess` ([actions/access.ts](actions/access.ts)), and the published-channels filter in [queries/consumer-api.ts](queries/consumer-api.ts) are business rules in this layer. New rules go in `src/domain`.
- **Server importing components.** [actions/create-template.ts](actions/create-template.ts) imports `@/components/workspace/just-created`, and [queries/submit-summary.ts](queries/submit-summary.ts) imports from `@/components/preview/sample-sets/model` and `@/components/submit/types`. No lint rule stops this. Put shared types and constants in `src/domain`.
- **Older read-model shapes.** `getWorkspaceHeader` and `getLibraryRows` return `Date` objects and booleans. Return ISO strings and `can` results.
- **Patching a domain result.** [import/create.ts](import/create.ts) overwrites `starterKey` and the audit details on the result of `createDraft()`. Have the domain return the right result.

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
