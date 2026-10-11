# 0048. Every database-backed test gets its own database

Status: Accepted
Date: 2026-10-11

## Context

The database-backed tests (actions, queries, sweeps, the `/api/v1` routes, the simulator) migrated and seeded one
temporary database in `beforeAll` and ran every test on it. Several files were written as stories: each test built
on what the one before it left behind (a template submitted in test 1, sent back in test 6, approved in test 11). So
a shuffled run failed dozens of tests, a single `-t` run failed too, and an agent adding a test copied the pattern
([T3](../handoff-review.md#t3--high-database-backed-unit-tests-depend-on-order)). Cleaning up by hand in
`try/finally` was the other half of the habit, and a test that forgot to left its writes for the next one.

## Decision

- **One seeded file per test file, one copy per test.** `seededDatabasePerTest()` (and `freshDatabasePerTest()`, for
  a build that isn't the seed) migrates and fills a database once, closes it, and gives each test, and each hook that
  runs before it, a clone of that file ([src/lib/fresh-database.ts](../../src/lib/fresh-database.ts)). The copy is
  deleted when the next test's replaces it. No test cleans up.
- **The exported `db` follows the test.** The mocked `@/server/db/client` exports stand-ins (proxies) that read
  through to the current copy on every access, so a file keeps `db` in a variable, as it always did, and code under
  test that imported `db` at load time sees the same copy the test does. A spy a test puts on `db` goes with the copy.
- **A test builds the state it needs.** Where a test used to be step N of a story, it calls small helpers for steps 1
  to N-1 (`submitted()`, `sentBack()`, `approved()`, each calling the one before), through the real actions.
- **Tests run in a random order.** `vitest.config.mts` shuffles the tests inside each file, and a custom reporter
  repeats the seed, with the command that replays it, at the bottom of a failed run. Files keep Vitest's order:
  each runs in an isolated worker, so their order can't matter, and a random file order costs about a second of
  wall time by starting the slow files late.
- **The mechanism lives in `src/lib`, UCOMP's wrapper in `src/server/testing`.** The simulator may not import
  `src/server` (lint), and its tests need the same thing on the `sim` schema, so the schema-agnostic part is shared and
  `review-fixtures.ts` adds UCOMP's schema, seed and personas.

## Alternatives considered

- **Roll back a transaction per test.** The code under test opens its own transactions (`inTransaction`, with a
  retry on busy), and a rollback would not undo what a committed transaction wrote.
- **Reseed in `beforeEach`.** Seeding takes about 400 ms; a copy of the 6 MB file and a new connection take about
  2 ms (an APFS clone, a plain copy elsewhere).
- **An in-memory database.** The app opens files with `createAppClient` (a write lock, a busy timeout), and some
  tests open a second connection to the same file on purpose. A file keeps the test close to the real thing.
- **Swap `db` through a getter on the mocked module.** It would follow each access too, but only for code that reads
  `db` through the module namespace. The tests keep `db` in a variable, so a proxy covers both.
- **Shuffle the files too.** Slower, and it tests nothing: a file can't see another's database.

## Consequences

- A test can't depend on another's writes, and any test can run alone. One that tries fails the first run, in any
  order, instead of failing now and then.
- Each test costs a file copy and a new connection. The suite takes about the same time as before.
- A test must not leave work in flight (an un-awaited write) for the next test's copy to race with. The previous
  copy is closed when the next test starts.
- Test files that only read use the fixture too, so adding a write to one can't make it order-dependent. Three keep
  their own setup: [apply-patch.test.ts](../../src/server/drafts/apply-patch.test.ts) refills its tables before each
  test, [serialized-writes.test.ts](../../src/lib/serialized-writes.test.ts) makes a file per test, and
  [seed.test.ts](../../src/server/seed/seed.test.ts) seeds a database for each scenario it checks.
