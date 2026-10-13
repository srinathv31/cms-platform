# `src/server/seed`: the demo dataset

The deterministic data a fresh database gets (`npm run db:reset`, the demo's Reset button, and the tests): three
teams, nine switchable people, fourteen templates in every lifecycle state, about 90 days of render history, the
notifications and access stories, and the simulator's offers and links. `buildSeed(base)`
([index.ts](index.ts)) builds every row in memory; `seedDatabase(db, { base })` inserts them in foreign-key order,
and [fixture.ts](fixture.ts) exports them as a JSON fixture. Nothing here touches the database until the insert,
so a test can build the rows and read them without one.

Contents: [Layout](#layout) · [From a template spec to rows](#from-a-template-spec-to-rows) · [Ids](#ids) ·
[The fixture](#the-fixture) · [Tests](#tests)

## Layout

| Path                                                                       | What it holds                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](index.ts)                                                       | `buildSeed`: runs the modules below in order, numbers the consumer notices, and returns the tables in foreign-key order. `seedDatabase` inserts them and returns the template ids by seed key and the row counts. |
| [context.ts](context.ts), [rng.ts](rng.ts), [time.ts](time.ts)             | `SeedCtx`: the `Sink` (one array of rows per table), `ctx.at(days)` for times, `ctx.id` and `ctx.random` for ids and random draws. `mulberry32` and `fnv1a` are the deterministic randomness.                     |
| [people.ts](people.ts), [teams.ts](teams.ts), [platform.ts](platform.ts)   | The users and personas; the teams, memberships and their audit rows; the content types, approval stages, consumers and the platform's configuration events.                                                       |
| [templates/](templates/)                                                   | The templates, one `SeedTemplate` each, and the code that turns them into rows. See below.                                                                                                                        |
| [content.ts](content.ts), [variables.ts](variables.ts)                     | Builders for the TipTap JSON the templates use (block ids are derived from the template and block key), and the variable definitions with their sample sets.                                                      |
| [history.ts](history.ts)                                                   | About 90 days of render log: daily streams, previews, a few failures and the latest renders.                                                                                                                      |
| [activity.ts](activity.ts)                                                 | Access requests, the recertification, and the notifications, stored as the runtime stores them: each kind's facts and a link by team id.                                                                          |
| [sim.ts](sim.ts)                                                           | Coral, the simulated consumer: its offers, customers, links and which notices it has read.                                                                                                                        |
| [fixture.ts](fixture.ts), [fixture.test.ts](fixture.test.ts)               | The JSON fixture a Java loader reads (`npm run seed:export`, [scripts/seed-export.ts](../../../scripts/seed-export.ts)), and its tests. See [The fixture](#the-fixture).                                          |
| [seed.test.ts](seed.test.ts), [redline-seed.test.ts](redline-seed.test.ts) | What the seed promises: shapes, ids, lifecycle states, determinism. See [Tests](#tests).                                                                                                                          |

`templates/`:

| File                                                                                                                                                                   | What it holds                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [types.ts](templates/types.ts)                                                                                                                                         | `SeedTemplate`, `SeedVersion`, `SeedApproval`, `SeedThread`: the declarative spec. Times are days before the reset (positive is the past). |
| [coral.ts](templates/coral.ts), [coral-alerts.ts](templates/coral-alerts.ts), [deposits.ts](templates/deposits.ts), [card-statements.ts](templates/card-statements.ts) | The specs: Coral Offers' five disclosures and three alerts, and three disclosures each for Deposits and Card Statements.                   |
| [build.ts](templates/build.ts)                                                                                                                                         | `buildTemplate`, and the emit functions it calls.                                                                                          |
| [checks.ts](templates/checks.ts)                                                                                                                                       | The checks on a spec (the content type's required sections and channels, rounds, send-backs). They throw, which fails the reset early.     |

## From a template spec to rows

A spec describes a template once: its versions with their states, approvals, sunset or revoke, and its comment
threads. `buildTemplate` ([build.ts](templates/build.ts)) derives every row from it, so the rows cannot disagree: a
version that is Active has an activation event, an approval, and a notice for each consumer that renders it.

```
buildTemplate(ctx, spec)
  template row + template.created
  for each version in the spec:
    emitVersion            the versions row, draft.started, its draft.edited sessions, version.submitted
    emitApprovals          approvals rows; a send-back is version.changes_requested, an approval is
                           version.activated (and version.superseded on the version it replaced)
    emitLifecycleNotices   a sunset, a revoke, and the notice each consumer gets (going Active included)
  emitThreads              comment threads, comments, and their audit events
```

A new template or a changed lifecycle goes in the spec. A new kind of row goes in an emit function.

### Events are written as the runtime writes them

The seed writes each audit event and consumer notice with the action name and the fields the transitions write
([decision 0064](../../../docs/decisions/0064-payloads-are-facts-with-one-shape-per-event.md)), so the Activity tab,
the Audit page and the consumer API read a seeded row and a live one the same way, and nothing aliases a seed
spelling. An approval is one `version.activated` by the approver (the seed's chain has one stage), with `supersedes`,
`stage` and `outputsViewed`; the replaced version gets `version.superseded`. A revoke is `version.revoked` with
`wasActive`, and its notice names the `activeVersion` consumers move to. A draft's editing sessions add up to its
`rev` (`saves`, `fields`, `since`, `rev`), and a draft copied from a version starts with `draft.started`. The access
and platform events carry the facts their builders write: `access.requested` has `userId` and `userName`,
`access.granted` its `role`, `platform.config_changed` the fields of its area and no sentence (built with
`configChanged`, one event per channel for a channel rule), and a recertification is started by its Team Admin. A
notification stores its kind's facts (names read from the rows the template builder wrote), a link placed in the
team by id (`recipientLink`), and as its body only a person's words (a submit note, a reason), as the transitions
write them ([decision 0055](../../../docs/decisions/0055-notifications-store-facts-and-are-worded-on-read.md)). `checks.ts` refuses a
spec the one-stage chain couldn't have produced: an approval exactly when it was activated, at that moment, and
replacing a version at the same moment.

## Ids

A template and each of its versions carries its id in the spec, as a literal
([decision 0069](../../../docs/decisions/0069-seed-ids-are-literal-and-the-seed-exports-a-fixture.md)):

```ts
{
  id: "UC-D6KSGY",
  key: "balance-transfer",
  versions: [{ id: "v_wmjrge009b", ref: "v1", … }],
}
```

E2E specs, golden files and screenshots name these, and the fixture a Java loader reads carries the same ones. To
add a template or a version, write any id of the right shape (`UC-` and six Crockford base32 characters; `v_` and
ten lowercase ones). The build refuses a malformed one (`checkIds`) and one used twice (`ctx.claimId`). To change a
pinned template id, edit its literal, the list in [seed.test.ts](seed.test.ts), and whatever names it.

A team's id is a literal too, and never its slug ([decision 0053](../../../docs/decisions/0053-team-ids-are-opaque-and-slugs-resolve-at-the-url.md)):
`t_coral`, `t_deposits` and `t_cards` (`TEAM_IDS` in [teams.ts](teams.ts)), with the slugs `coral-offers`,
`deposits` and `card-statements` the URLs use (`TEAM_SLUGS`). A spec, a row and a stored link (a notification's)
name a team by its id; only a URL names it by its slug. Because the two differ, code that swaps one for the other
fails a test.

Every other row's id is drawn, not written. `ctx.id(scope, prefix)` draws from a sequence named for the scope and
the prefix: `template:<key>` for a template's audit events, approvals, threads, comments and notices; `team:<id>`
for a team's memberships and events; `platform`, `activity` and `sim` for those modules. A sequence is a pure
function of its name (`mulberry32(fnv1a(name))`), so adding a row to one template moves only the later ids of the
same prefix in that template, and never another template's. A random number is drawn the same way,
`ctx.random(name)`: a template's `rev` and edit saves from `template:<key>`, the render history's from
`history:streams`, `history:latest`, `history:previews` and `history:errors`.

## The fixture

`npm run seed:export` writes the seed as one JSON file, `data/seed-fixture.json` (git ignores `data/`; `-- --out
<file>` writes elsewhere). It is for the Java side's fixture loader
([decision 0069](../../../docs/decisions/0069-seed-ids-are-literal-and-the-seed-exports-a-fixture.md)): one source for the
demo data, the `seed-*` golden cases and the e2e specs, with the same ids on both sides and nothing to port but a
loader. It holds what `seedDatabase` writes, built at a fixed reset moment (`FIXTURE_BASE`, 1 January 2026 12:00
UTC) so the file is the same on every run. About 31,000 rows, almost all of them render history.

```json
{
  "format": 1,
  "seedVersion": "3",
  "templates": { "balance-transfer": "UC-D6KSGY", "…": "…" },
  "tables": [
    {
      "name": "users",
      "rows": [{ "id": "maya", "name": "Maya Chen", "…": "…" }]
    },
    {
      "name": "versions",
      "rows": [
        { "id": "v_wmjrge009b", "created_at": { "daysAgo": 160 }, "…": "…" }
      ]
    }
  ]
}
```

- **Tables** come in the order to insert them: a row refers only to rows in tables before it. `name` is the table
  and each row's keys are the column names, as in [the schema](../db/schema/ucomp.ts) (`sim_*` is
  [the simulator's](../db/schema/sim.ts); the Coral simulator stays a Node app, so a loader may skip those). A row is
  complete: a column the seed leaves out holds the schema's default, as the database stores it, so a loader inserts
  every column as written. A column with no value is `null`. A column that holds JSON (`body`, `payload`,
  `details`, …) holds it as JSON.
- **Ids** are the ones the database gets: a template's and a version's are the spec's literals, every other row's is
  its drawn id ([Ids](#ids)). `templates` maps each seed key to its template id.
- **Time is relative to the reset**, and the file has no absolute instant or date. A marker is an object with
  exactly these keys, and a loader resolves each against the moment it loads (`resolveMarker`, which is all of the
  time logic, in [fixture.ts](fixture.ts)):

  | Marker                                                                | Stands for                                                                                                         |
  | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
  | `{ "daysAgo": 2.5 }`                                                  | The instant 2.5 days before the reset (a decimal; negative is the future): `reset - round(daysAgo * 86400000 ms)`. |
  | `{ "dayOffset": 45, "zone": "UTC" }`                                  | The calendar day 45 days after the reset's own day in that zone (negative: before), as `YYYY-MM-DD`.               |
  | `{ "dayOffset": 21, "zone": "America/New_York", "startOfDay": true }` | The first instant of that calendar day in the zone: where a sunset stops renders.                                  |

  In a timestamp column a marker is a timestamp; inside a JSON value an instant is an ISO 8601 string in UTC with
  milliseconds, and a day is `YYYY-MM-DD`. A sample set's date values are days in UTC, counted from the reset; a
  sunset is the start of a day in the business time zone, recorded in `versions.sunset_at` and in a notice's or an
  audit event's `sunsetAt` beside the `sunsetDay` it falls on, so a loader at any time of day keeps the two in step.
  `settings.seeded_at` is `{ "daysAgo": 0 }`, the reset itself.

- **Wording the fixture can't make relative.** One piece of text carries a date: the quarter label of a
  recertification (`Q1 2026`, the quarter of its `due_at` in UTC, in `recertifications.label` and its audit event).
  A loader derives it from the resolved `due_at`. Notifications store facts, an instant where a sentence would name
  a date, and the quarter is worded from the deadline when read
  ([decision 0055](../../../docs/decisions/0055-notifications-store-facts-and-are-worded-on-read.md)), so they load
  as any other row.
- **The render history is one realization.** Its times are drawn with business hours and weekdays in mind, at the
  moment the file was built; loaded at another moment, they keep their distance from the reset, not their weekday.
- **Seed version**: `seedVersion` is `SEED_VERSION` ([index.ts](index.ts)), bumped when the seed's shape changes.

`loadFixture(fixture, resetAt)` is a loader in TypeScript, the reference for the Java one: every table in order,
every marker resolved against `resetAt`, the recertification labels derived, the rows in the shape Drizzle reads
them. The in-memory fake of the service interfaces ([services/fake](../services/fake/state.ts)) is built with it, so
the contract suite's agreement test also checks the fixture.

[fixture.test.ts](fixture.test.ts) checks that the export is the same on every run, that its ids and row counts are
those of a seeded database, that every marker resolves back to the value the seed built, that loaded at the moment
it was built it is the seeded database row for row (no required column empty), that loaded at another moment (a
later quarter, another time of day) it is the seed built then but for the render times, that no absolute time is left
(a seed built a week later is the same file), and what each marker means.

## Tests

[seed.test.ts](seed.test.ts) seeds a database and checks it against what the app promises: every body passes the
document contract, every submitted version passes submit's rules, the lifecycle states agree with their rows, and
the same structure comes out whatever day the reset runs. [redline-seed.test.ts](redline-seed.test.ts) checks the
seeded drafts that the redline view compares.
