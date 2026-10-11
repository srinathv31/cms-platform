# 0038. `/api/v1` sends a sunset with its day and zone, not as an instant alone

Status: Accepted
Date: 2026-10-11

## Context

A sunset ends at 00:00 on its date in the business time zone ([0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)),
and the API sent it as that instant. A consumer that wanted the day had to convert the instant itself, in a zone it
wasn't told, or take its UTC date: right for every zone on today's list (UTC and the US zones are all behind or at
UTC), but the day before for a zone ahead of UTC. Coral did the second, and said so in 0017's consequences. Only the
`sunset_scheduled` and `sunset_passed` notices carried the day and the zone ([0032](0032-consumers-are-told-when-a-sunset-passes.md));
the version list and the 410 `version_sunset` gave the instant alone
([handoff review N15](../handoff-review.md#n15--low-coral-drops-a-mapping-on-a-rename-and-dates-a-sunset-in-utc)).

## Decision

- **Wherever the API sends a sunset it sends the day and the zone beside the instant, under the notices' names.**
  `ApiVersionSummary` gets `sunsetDay` (`YYYY-MM-DD`) and `zone` (an IANA id), both null with no sunset. The
  `details` of a `version_sunset` error get `sunsetDay` and `zone` beside `at`. The notices already had them.
- **A version's and an error's day is read in the zone in force now**, the same as the 410's message and every
  read model in Stencil. A notice keeps the day and zone it recorded when it was written. After a change of zone
  the two can differ for a sunset set before it; 0017 already accepts that a March 1 Eastern sunset reads as
  February 28 in Pacific, the day it stops there.
- **It is an addition.** `sunsetAt` and `at` stay as they were; nothing a consumer reads moved.
- **Coral shows `sunsetDay`**, never the UTC date of the instant.

## Alternatives considered

- **Send the zone once, on the template.** The zone is one platform setting, but a version's day is what the
  consumer shows, and a notice already carries both. Beside the instant it can't be misread or separated.
- **Send the zone as an offset.** An offset is right only for the instant: "March 1" in a zone with daylight saving
  is a day, not an offset.
- **Store the day and zone per version** (0017 declined this too). It would let a version report the zone its
  sunset was set under, at the cost of every reader resolving it.
- **Leave it to the consumer**, with the contract saying "convert `sunsetAt` in the business zone". The consumer
  doesn't know the zone, and each would write the conversion again.

## Consequences

- A consumer in any zone shows the day people in the business read, and can show a zone beside it.
- A port copies two fields, `sunsetDay(instant, zone)` from 0017's table and the zone it read.
- Coral's version of the day is the API's. It has no date logic of its own for a sunset.
