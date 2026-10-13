# `src/server/seed`: the demo dataset

The deterministic data a fresh database gets (`npm run db:reset`, the demo's Reset button, and the tests): three
teams, nine switchable people, fourteen templates in every lifecycle state, about 90 days of render history, the
notifications and access stories, and the simulator's offers and links. `seedDatabase(db, { base })`
([index.ts](index.ts)) builds every row in memory, then inserts them in foreign-key order. Nothing here touches
the database until that last step, so a test can build the rows and read them without one.

Contents: [Layout](#layout) · [From a template spec to rows](#from-a-template-spec-to-rows) ·
[Tests](#tests)

## Layout

| Path                                                                       | What it holds                                                                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](index.ts)                                                       | `seedDatabase`: runs the modules below in order, numbers the consumer notices, inserts everything, returns the template ids by seed key and the row counts.     |
| [context.ts](context.ts), [rng.ts](rng.ts), [time.ts](time.ts)             | `SeedCtx`: the `Sink` (one array of rows per table), `ctx.at(days)` for times, ids and random draws. `mulberry32` and `fnv1a` are the deterministic randomness. |
| [people.ts](people.ts), [teams.ts](teams.ts), [platform.ts](platform.ts)   | The users and personas; the teams, memberships and their audit rows; the content types, approval stages, consumers and the platform's configuration events.     |
| [templates/](templates/)                                                   | The templates, one `SeedTemplate` each, and the code that turns them into rows. See below.                                                                      |
| [content.ts](content.ts), [variables.ts](variables.ts)                     | Builders for the TipTap JSON the templates use (block ids are derived from the template and block key), and the variable definitions with their sample sets.    |
| [history.ts](history.ts)                                                   | About 90 days of render log: daily streams, previews, a few failures and the latest renders.                                                                    |
| [activity.ts](activity.ts)                                                 | Access requests, the recertification, and the notifications.                                                                                                    |
| [sim.ts](sim.ts)                                                           | Coral, the simulated consumer: its offers, customers, links and which notices it has read.                                                                      |
| [seed.test.ts](seed.test.ts), [redline-seed.test.ts](redline-seed.test.ts) | What the seed promises: shapes, ids, lifecycle states, determinism. See [Tests](#tests).                                                                        |

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
    emitVersion            the versions row, its draft.edited sessions, version.submitted
    emitApprovals          approvals rows and one audit event per decision
    emitLifecycleNotices   going Active, a sunset, a revoke: the audit event and a notice per consumer
  emitThreads              comment threads, comments, and their audit events
```

A new template or a changed lifecycle goes in the spec. A new kind of row goes in an emit function.

## Tests

[seed.test.ts](seed.test.ts) seeds a database and checks it against what the app promises: every body passes the
document contract, every submitted version passes submit's rules, the lifecycle states agree with their rows, and
the same structure comes out whatever day the reset runs. [redline-seed.test.ts](redline-seed.test.ts) checks the
seeded drafts that the redline view compares.
