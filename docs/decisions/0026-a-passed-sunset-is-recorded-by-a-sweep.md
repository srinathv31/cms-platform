# 0026. A passed sunset is recorded by a sweep, in the audit log only

Status: Accepted
Date: 2026-10-09

## Context

A sunset stops a Superseded version's consumer renders at an instant ([0002](0002-a-passed-sunset-is-final.md),
[0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)). The audit log recorded the sunset being
set, but nothing recorded it passing, so the log never said when a version stopped rendering. The build plan's audit
list has "sunset set or passed". The "passed" test itself was written out in five places (the render rule, the
consumer API, the Versions and Usage read models, the Usage notes)
([handoff review D7](../handoff-review.md#d7--medium-nothing-records-when-a-sunset-passes)). Nothing runs at the
instant a sunset passes: the render rule reads the clock when a consumer asks.

## Decision

- **One predicate.** `sunsetPassed(version, now)` in [lifecycle.ts](../../src/domain/lifecycle.ts) (`sunsetAt <= now`)
  is the only test of a passed sunset. The render rule, the consumer API, the Versions and Usage screens, the zone
  change's count of pending sunsets and the sweep all call it.
- **A sweep records it.** `sweepSunsets` (domain) finds each version whose sunset has passed and has no
  `version.sunset_passed` audit row yet, and returns that row. `runSunsetSweep()`
  ([src/server/sunset-sweep.ts](../../src/server/sunset-sweep.ts)) writes them in one transaction. Running it twice
  writes nothing the second time.
- **What the row says.** The actor is the system (null), as for the access sweep. The row is dated at the
  sunset, however late the sweep runs, as the access sweep backdates its lapses. Its details are typed
  (`SunsetPassedDetails`): the version number, the instant, the sunset's day in the business time zone at the
  sweep, and that zone. That's the day the Versions screen shows. Activity and Audit read "v1 stopped rendering: its
  sunset passed on March 1, 2027." under the action "Sunset passed".
- **Only a sunset that ended renders.** A version revoked at or before its sunset had already stopped rendering, so
  its sunset isn't recorded. One revoked after its sunset passed is.
- **When it runs.** Where the access sweep runs: Advance clock, a persona switch, and the start of every access
  action. There is no timer. The scheduled job belongs to the sign-in work
  ([handoff review S4](../handoff-review.md#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep)),
  which calls `runSunsetSweep()` beside `runAccessSweep()`.
- **No consumer notice, no notification.** The `sunset_scheduled` notice gave every consumer that renders the version
  the exact instant, with the Active version to move to, and the author's notification gave the day. A render after
  it answers `410 version_sunset` naming the Active version, and `/api/v1` reports `sunsetPassed` on the version.

## Alternatives considered

- **A `sunset_passed` consumer notice.** It would add a notice kind to the `/api/v1` contract that every consumer, and
  a Java port, must handle. It would also arrive whenever a sweep happens to run, after the fact, so no consumer could
  act on it. Revokes get a notice because nobody can know about one in advance; a sunset is announced when it's set.
- **A notification to the author or the team.** The author was told the day when the sunset was set, and the
  Versions tab shows "Sunset passed". A second notice of a date they chose would be noise.
- **Date the row when the sweep runs.** The log would say a version stopped rendering on whatever day someone
  happened to switch persona. The row's job is to say when it stopped.
- **The day the sunset was set with, from its `version.sunset_set` row.** That day only differs after a change of
  zone, and then the Versions screen shows the day in the new zone. The record names the same day the screen does.
- **Make "sunset passed" a version state.** Renders already stop on time without a write, and a state the sweep has to
  catch up on would make rendering depend on when the sweep last ran.

## Consequences

- The audit log and the Activity tab show when each version stopped rendering, and an auditor can filter by "Sunset
  passed".
- Until the scheduled job exists, the row appears only after a sweep trigger runs. Renders stop on time either way:
  the render rule doesn't read the record.
- An e2e spec that moves the clock past a sunset and runs a sweep leaves a `version.sunset_passed` row. It must delete
  it when it puts the clock back, as [e2e/sunset-passed.spec.ts](../../e2e/sunset-passed.spec.ts) does, or reset the
  database.
- `EffectContext.actorId` may be null (the system), so `writeEffects` serves the sweep as it serves the actions.
- `AuditEffect` is now one type per action. `version.sunset_passed` has a typed payload (`AuditDetailsByAction`); the
  other actions' details are still open records until [D10](../handoff-review.md#d10--medium-audit-and-notice-payloads-are-untyped).
