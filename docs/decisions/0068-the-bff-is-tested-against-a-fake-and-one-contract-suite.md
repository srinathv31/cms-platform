# 0068. The BFF is tested against a fake, and one contract suite runs against every implementation

Status: Accepted
Amended 2026-10-13: the Java API's test clock must be settable to an exact instant, not only offset, and its
fixture loader must take the base instant the seed was built on ([0069](0069-seed-ids-are-literal-and-the-seed-exports-a-fixture.md)):
contract cases pin the backend's clock and compare state before and after, never find a write by its instant
([0072](0072-the-bff-reaches-its-backend-through-service-interfaces.md)). The fake implements every command and only
the reads a case needs to observe one; BFF read-model tests run on facts, not on the fake.
Date: 2026-10-12

## Context

The server's tests run the real actions against a copy of a seeded SQLite file per test
([0048](0048-every-database-test-gets-its-own-database.md)), and 36 of 50 e2e spec files assert through raw SQL
(`e2e/helpers/golive.ts`, `e2e/scenario-03.spec.ts` among them; H-3 of the
[October 12 review](../quality-review-2026-10-12.md)). The e2e suite travels in time by moving
`settings.clock_offset_days`. When the server code becomes a BFF over Spring, those tests lose the database they
assert on. What survives untouched: the domain, editor-model, component and render golden tests, and every e2e
assertion made through the UI or `/api/v1`. The owner's direction (`to-do.md` item 3): the service seam first, then
fakes for the BFF and contract tests for SQLite and Java.

## Decision

- **Service interfaces** (lane F) with today's Drizzle code as the local implementation.
- **An in-memory fake** of those interfaces that runs the real `src/domain` transitions over in-memory state, so it
  behaves, not just answers.
- **One behavioral contract suite runs against the fake, the Drizzle implementation and, later, the Java API** in a
  test environment. It covers the places implementations most often disagree: concurrent compare-and-set, notice
  order, search order, refusal codes.
- **The BFF's own tests** (actions, routes, read-model shaping) run against the fake.
- **E2E state checks go through one swappable helper module** (a `state.ts` beside the e2e helpers): SQL today, a
  test endpoint or JDBC later. Checks move to the UI or `/api/v1` where they can.
- **The Java API provides a test-only clock offset**, settable only in demo and test environments, so the
  time-travel specs (sunsets, recertification, inactivity) keep working.

## Alternatives considered

- **Mocks per test** (`vi.mock` of each service call). Fast, but tests check call shapes, not behavior, and keep
  passing while the backend drifts.
- **Keep the SQLite tests until the port, then rewrite them.** The cost lands on the Java team's first sprints, with no
  test of the BFF meanwhile.

## Consequences

- **Node now (wave 2, lane F):** the interfaces, the fake, the contract suite run against the fake and Drizzle, and
  the server tests moved onto the fake; the database tests stay as the contract suite's Drizzle run. The e2e helper
  module is introduced where specs assert through SQL.
- **Java side:** runs the contract suite against its API in its pipeline, and provides the test clock.
- The fake stays honest only because the same suite runs against it; a behavior added to Drizzle and not to the fake
  fails there.
