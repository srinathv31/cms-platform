# `src/server/seed`: the demo dataset

The deterministic data a fresh database gets (`npm run db:reset`, the demo's Reset button, and the tests): three
teams, nine switchable people, fourteen templates in every lifecycle state, about 90 days of render history, the
notifications and access stories, and the simulator's offers and links. `seedDatabase(db, { base })`
([index.ts](index.ts)) builds every row in memory, then inserts them in foreign-key order. Nothing here touches
the database until that last step, so a test can build the rows and read them without one.

Contents: [Layout](#layout) · [From a template spec to rows](#from-a-template-spec-to-rows) · [Ids](#ids) ·
[Tests](#tests)

## Layout

| Path                                                                       | What it holds                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](index.ts)                                                       | `seedDatabase`: runs the modules below in order, numbers the consumer notices, inserts everything, returns the template ids by seed key and the row counts.                                   |
| [context.ts](context.ts), [rng.ts](rng.ts), [time.ts](time.ts)             | `SeedCtx`: the `Sink` (one array of rows per table), `ctx.at(days)` for times, `ctx.id` and `ctx.random` for ids and random draws. `mulberry32` and `fnv1a` are the deterministic randomness. |
| [people.ts](people.ts), [teams.ts](teams.ts), [platform.ts](platform.ts)   | The users and personas; the teams, memberships and their audit rows; the content types, approval stages, consumers and the platform's configuration events.                                   |
| [templates/](templates/)                                                   | The templates, one `SeedTemplate` each, and the code that turns them into rows. See below.                                                                                                    |
| [content.ts](content.ts), [variables.ts](variables.ts)                     | Builders for the TipTap JSON the templates use (block ids are derived from the template and block key), and the variable definitions with their sample sets.                                  |
| [history.ts](history.ts)                                                   | About 90 days of render log: daily streams, previews, a few failures and the latest renders.                                                                                                  |
| [activity.ts](activity.ts)                                                 | Access requests, the recertification, and the notifications.                                                                                                                                  |
| [sim.ts](sim.ts)                                                           | Coral, the simulated consumer: its offers, customers, links and which notices it has read.                                                                                                    |
| [seed.test.ts](seed.test.ts), [redline-seed.test.ts](redline-seed.test.ts) | What the seed promises: shapes, ids, lifecycle states, determinism. See [Tests](#tests).                                                                                                      |

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
`access.granted` its `role`, `platform.config_changed` the fields of its area (built with `configChanged`, one
event per channel for a channel rule), and a recertification is started by its Team Admin. `checks.ts` refuses a
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

Every other row's id is drawn, not written. `ctx.id(scope, prefix)` draws from a sequence named for the scope and
the prefix: `template:<key>` for a template's audit events, approvals, threads, comments and notices; `team:<id>`
for a team's memberships and events; `platform`, `activity` and `sim` for those modules. A sequence is a pure
function of its name (`mulberry32(fnv1a(name))`), so adding a row to one template moves only the later ids of the
same prefix in that template, and never another template's. A random number is drawn the same way,
`ctx.random(name)`: a template's `rev` and edit saves from `template:<key>`, the render history's from
`history:streams`, `history:latest`, `history:previews` and `history:errors`.

## Tests

[seed.test.ts](seed.test.ts) seeds a database and checks it against what the app promises: every body passes the
document contract, every submitted version passes submit's rules, the lifecycle states agree with their rows, and
the same structure comes out whatever day the reset runs. [redline-seed.test.ts](redline-seed.test.ts) checks the
seeded drafts that the redline view compares.
