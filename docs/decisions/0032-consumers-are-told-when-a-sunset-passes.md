# 0032. Consumers are told when a sunset passes

Status: Accepted
Date: 2026-10-09

## Context

[Decision 0026](0026-a-passed-sunset-is-recorded-by-a-sweep.md) made a sweep record each passed sunset in the audit
log, and chose not to send consumers a notice: they had the `sunset_scheduled` notice, and a render after the sunset
answers `410 version_sunset`. The owner decided that consumers do get a notice when a sunset passes, so that their
notices say a version stopped rendering, as they say when one is revoked. `/api/v1` has no consumers yet, so adding a
notice kind costs nothing now; later, every consumer and a Java port would have to take it. This record supersedes
0026's "No consumer notice" decision and its "A `sunset_passed` consumer notice" alternative. The rest of 0026 stands,
the author getting no notification included.

## Decision

- **A notice kind, `sunset_passed`**, named like `sunset_scheduled`, the audit action `version.sunset_passed` and
  `sunsetPassed` on a version. `sweepSunsets` returns it beside the audit row, and `runSunsetSweep` writes both
  through `writeEffects` in one transaction, so the notice takes the next `consumer_notices.seq` like any other.
- **Once.** The sweep skips a version whose audit row exists, and the row and the notices commit together, so a
  second sweep writes neither.
- **What it carries**, like the other version notices: the version number, that version's name
  ([0016](0016-the-name-is-versioned.md)), the exact instant (`sunsetAt`), its day in the business time zone and the
  zone (`sunsetDay`, `zone`, [0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)), and the
  version to move to: the Active one at the sweep, or null. The message: "Spring Travel Rewards — Terms v2 stopped
  rendering: its sunset passed on March 1, 2027. Move to v3." No contract changes: the `sunset_scheduled` notice
  carried them, and `?since=` on the template answers them.
- **`sunsetDay` and `zone` are on every `ApiNotice`**, set on both sunset kinds and null on the others.
  `sunset_scheduled` notices record the zone too (approve, the Versions tab, the seed).
- **Who is told: the rule every notice uses.** The consumers with a non-preview render of the template from 90 days
  before the event on (`recentConsumers` in `server/effects.ts`), and the event is the sunset. Not only the consumers
  that rendered that version.
- **When.** The notice is created when the sweep writes it, and `createdAt` says so; `sunsetAt` says when renders
  stopped. Until the scheduled job exists ([handoff review S4](../handoff-review.md#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep)),
  the sweep runs on Advance clock, a persona switch or an access action, so the notice can arrive days after the
  sunset. Renders fail from the instant either way.

## Alternatives considered

- **Keep 0026: no notice.** A consumer would learn that its pinned version stopped from a failed render or by reading
  the template, rather than from its notices.
- **Only the consumers that rendered that version.** Every other notice goes to the template's consumers, and a
  consumer reading one template's notices would see `sunset_scheduled` without the `sunset_passed` that closes it.
  A consumer on the Active version also learns that the old one is gone. One audience rule is one query to port.
- **Date the notice at the sunset, as the audit row is.** `createdAt` would run backwards in the outbox (a notice
  written later dated before the one ahead of it), and a consumer would read a notice dated before anyone could
  have seen it. The instant is in `sunsetAt`.
- **Count the 90 days back from the sweep.** A late sweep would miss consumers that rendered up to the sunset and
  then stopped, so who is told would depend on when the sweep ran.

## Consequences

- `/api/v1` has four notice kinds. Coral shows "v2 sunset passed" with the API's sentence.
- `EffectContext.writtenAt` lets a writer date its audit rows at the event and its notices and notifications when it
  writes them. Only the sweep sets it.
- An e2e spec that moves the clock past a sunset and runs a sweep must delete the notices as well as the audit row
  when it puts the clock back, as [e2e/sunset-passed.spec.ts](../../e2e/sunset-passed.spec.ts) does, or reset the
  database.
