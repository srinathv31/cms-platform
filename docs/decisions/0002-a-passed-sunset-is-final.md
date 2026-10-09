# 0002. A passed sunset is final

Status: Accepted
Date: 2026-10-08

## Context

A sunset date on a Superseded version stops its consumer renders from that instant (`410 version_sunset`). Consumers
are told when it's set, and once it passes they move to a newer version. Until October 2026, `setSunset` checked only
that the version was Superseded and that the new date was after today. Setting a later date on a version whose sunset
had passed made it render again, and the Versions screen offered it
([handoff review D2](../handoff-review.md#d2--high-setting-a-new-sunset-brings-a-sunset-version-back-to-life)). In a
product for regulated content, that brings withdrawn content back without review.

## Decision

- Once a version's sunset has passed, nothing sets, moves or clears it. `setSunset` in
  [lifecycle.ts](../../src/domain/lifecycle.ts) refuses with `REFUSALS.sunsetPassed`: "This version's sunset has
  passed. It can't render again." There is no path that clears a sunset.
- "Passed" is one domain predicate, `sunsetPassed` (`sunsetAt <= now`, on the demo clock): the same instant test the
  render rule uses, so the Versions screen calls a sunset passed exactly when renders start failing.
- Approving with a sunset needs no new guard: it sets one only on the version that is Active at that moment, which is
  still rendering, and the action's compare-and-set checks it's still Active.
- The Versions screen keeps Change sunset in place on such a version, disabled, with the reason in a tooltip and as
  its accessible description. The read model (`versionActions` in
  [queries/versions.ts](../../src/server/queries/versions.ts)) checks the passed sunset before the permission, so
  anyone who can see the version reads the same reason, not "You don't have access to do this."

## Alternatives considered

- **Allow moving it, with a warning.** Consumers have been told it stopped, and some have relinked; a version that
  comes back is worse than one that stays down. To ship that content again, publish it as a new version.
- **Hide the control once the sunset passes.** The project shows unavailable controls disabled with their reason,
  rather than hiding them.
- **Permission first, as for the other actions.** People without the sunset permission would then read "You don't
  have access to do this" about a date nobody can change, or the component would have to tell the two reasons apart by
  comparing sentences.

## Consequences

- The only change left for a version past its sunset is a revoke. Bringing its content back means a new version through
  review.
- Viewers and authors see a disabled Change sunset on a version whose sunset has passed, though they don't see Set
  sunset on other Superseded versions.
- Five other places still test "sunset passed" themselves (`render/version-rules.ts`, `golive/usage.ts`, and the
  `consumer-api`, `versions` and `usage` queries). [D7](../handoff-review.md#d7--medium-nothing-records-when-a-sunset-passes)
  moves them to `sunsetPassed`.
- What time of day a sunset date means is unchanged (midnight UTC); [D6](../handoff-review.md#d6--medium-a-sunset-date-means-midnight-utc)
  decides it. The predicate stays an instant comparison either way.
