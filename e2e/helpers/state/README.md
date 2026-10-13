# e2e state helper

The only e2e code that touches Stencil's data. A spec that needs a fact the screen can't give it (a version's stored
state, the audit trail, a notice in the outbox), or needs data arranged (a version in review, a moved clock), imports a
named function from `e2e/helpers/state` and never opens the database. ESLint enforces it: `@libsql/client`, Drizzle
and `@/server/db` are importable only from `db.ts` here, and the rest of the repo's e2e code imports this folder's
`index.ts` and none of its modules ([decision 0068](../../../docs/decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)).

Today every function is SQL against the worker's own SQLite file (`E2E_DATABASE_URL`, see
[e2e/storage.ts](../../storage.ts)). When Java owns the data, this folder is the one thing that changes: the same
functions go through a test endpoint or JDBC, and no spec does.

## What a function returns

Records, in camelCase, with JSON parsed, booleans as booleans and times as milliseconds since the epoch
(`records.ts`): a `VersionRecord` has `submittedBy`, `sunsetAt`, `body` as a document, `channels` as an array. A spec
never sees a column name or a JSON string. A Java implementation returns the same records, built from its API or its
tables. `records.ts` is also the list of what the helper promises to know about each thing.

Assert on the UI or `/api/v1` where you can: they survive the swap untouched. Use this folder for what only the
backend knows (a stored row, the audit trail, a counter).

## Layout

| File           | Concern                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`     | The public names. Import from here.                                                                                                      |
| `db.ts`        | The SQLite connection, `select`, `execute`, `insert`, `update`, with a retry on `SQLITE_BUSY`. The only file that imports the client.    |
| `records.ts`   | The record types, and the row-to-record and record-to-row conversion (`fromRow`, `toColumns`). The only code that knows column names.    |
| `versions.ts`  | Templates and versions: `findVersions`, `versionsOf`, `versionNumbered`, `allVersions`, `addVersionLike`, `withVersion`, `bumpDraftRev`. |
| `review.ts`    | Decisions (`approvalsOf`, `decisionsOnTemplate`) and comment threads (`commentThreads`, `commentsIn`, `addCommentThread`).               |
| `trail.ts`     | The audit log (`auditEvents`), notifications (`notificationsAbout`) and `storedTextAbout` for the privacy checks.                        |
| `consumers.ts` | Registered consumers, their notices (`consumerNotices`, `noticeSeqs`) and the render log (`renderLog`, `renderLogFor`).                  |
| `simulator.ts` | Coral's own data: links (`simLink`, `linkOffer`), deliveries (`simDeliveries`), and what a spec must put back (`rememberSimulator`).     |
| `people.ts`    | Memberships and roles (`membershipOf`, `approversOf`) and sign-in times.                                                                 |
| `platform.ts`  | Settings, a content type's approval chain and allowed channels, `withAllowedChannels`.                                                   |
| `clock.ts`     | The demo clock: `clockOffsetDays`, `setClockOffsetDays`, `demoNow`, `clockDay`. Java provides a test-only offset for it.                 |
| `templates.ts` | `removeTemplate`, `rememberTemplate` (put a template back as it was), `addTemplateLike`, `uploadsOf`.                                    |
| `fixtures.ts`  | `createSpringTravel`: Maya's Spring Travel Rewards, live as v2, which several specs build on.                                            |
| `faults.ts`    | Break one stored value so a screen throws, and put it back (the error-screen specs).                                                     |
| `reset.ts`     | `resetDemoData`: re-seeds the worker's database.                                                                                         |
| `changes.ts`   | `Changes`: everything a spec file changed, and how to put it back.                                                                       |

## Cleaning up: `Changes`

The database is shared by every spec file a worker runs (and, against a dev server, by other people's sessions), so
a spec that moves the clock, revokes a version or makes a template puts it back:

```ts
const changes = new Changes();

test.beforeAll(async () => {
  await changes.watchTemplate(templateId); // the app will revoke a version of it
  await changes.watchClock(); // a button will advance the clock
});

test.afterAll(() => changes.undo());
```

`watch…` remembers what the app is about to change; `setClockOffsetDays`, `grantRole`, `createSpringTravel`,
`ownTemplate` and the others make a change themselves and register how to undo it. `undo` runs newest first, runs every
step even when one fails, and throws the first failure. A spec that re-seeds with `resetDemoData` needs no `Changes`.

## Adding a function

Name it for what the spec asks (`approversOf(teamId)`, not `selectMembers`), return records, and put it with its
concern. Don't export `select` or `execute`, and don't take SQL as a parameter: a generic query is the thing this
folder exists to prevent. Team arguments are a team's id where the caller holds one (`SeedVersion.teamId`) and its
slug (`teamSlug`) where the spec is describing a URL.
