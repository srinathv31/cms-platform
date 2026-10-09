# 0017. A sunset date ends at 00:00 in the business time zone

Status: Accepted
Date: 2026-10-09

## Context

A sunset date is a calendar day a Superseded version stops rendering. The Versions tab and the approve dialog pick
a day, but the server stored that day's midnight UTC and judged "after today" in UTC days
([handoff review D6](../handoff-review.md#d6--medium-a-sunset-date-means-midnight-utc)). So "Sunset on March 1"
stopped renders at 7 PM Eastern on February 28, the picker's "today" rolled over at 8 PM Eastern, and nothing told a
port (the Java API, or anyone else) which rule was meant. The teams and the consumers work on US time.

## Decision

- **The rule.** A sunset date ends at 00:00 on that date in one platform business time zone. "Sunset on March 1"
  stops renders at 00:00 Eastern on March 1 (2027-03-01T05:00Z). What is stored is that instant
  (`versions.sunset_at`); the render rule and "passed" stay instant comparisons ([0002](0002-a-passed-sunset-is-final.md)).
- **The zone.** A Platform setting, Settings > Platform > Time zone (`settings.business_zone`), changed by a Platform
  Admin with an audit row. The default is `America/New_York`; no row means the default.
- **The list.** The US zones and UTC: Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii, UTC, each shown
  as "Eastern (America/New_York)". Short on purpose: these are the zones the teams work in.
- **"After today"** is judged in the zone: a sunset date must be a later day than today there, on the demo clock. At
  23:30 Eastern on October 9, October 10 is still a valid date.
- **The picker** takes its today, and so its earliest day (tomorrow), from the zone, and names it beside the
  control: "Ends at 00:00 Eastern (America/New_York)". The badge, the Versions timeline, the usage notes, the
  410 message and the notices name a sunset by its day in the zone. Every other date in the UI stays UTC.
- **Changing the zone later moves nothing.** A sunset already set keeps its instant; only dates picked afterwards
  end at 00:00 in the new zone. The settings screen says so before the change ("2 sunsets already set don't move:
  their consumers have been told when they end."): the read model sends that line as `consequences`, and the line
  for the zone picked comes from `describeZoneChange`, which `setBusinessZone` refuses with too
  ([0018](0018-settings-screens-render-decisions.md)). Audit rows and notices record the day picked and the zone
  (`sunsetDay`, `zone`), so they keep saying "March 1".
- **Existing data.** Migration `0007_sunset_business_zone` moves every stored sunset to 00:00 Eastern on its UTC
  date, except one the move would carry across "now" (a passed sunset stays passed, one still to come stays to
  come). The seed sets its sunsets the same way. Audit rows and notices written before keep their values and are
  read by the old rule (`recordedSunsetDay`: no `sunsetDay` means the UTC date of `sunsetAt`).

For a port, the whole rule is in [src/domain/business-zone.ts](../../src/domain/business-zone.ts):

| Here | Java |
| --- | --- |
| `sunsetInstant(day, zone)` | `LocalDate.parse(day).atStartOfDay(ZoneId.of(zone)).toInstant()` |
| `sunsetDay(instant, zone)` | `instant.atZone(ZoneId.of(zone)).toLocalDate()` |
| `isAfterToday(day, now, zone)` | `day.isAfter(LocalDate.ofInstant(now, ZoneId.of(zone)))` |

Where the zone's clocks skip midnight the day starts at the first instant after the gap; where they repeat it, at
the earlier one. Java's `atStartOfDay` does both. The US zones change at 02:00, so their midnight always exists once.

## Alternatives considered

- **Keep midnight UTC.** The simplest rule, and wrong by five hours for every team and consumer the platform has.
- **Each viewer's own time zone.** Two approvers in different zones would set different instants for the same date,
  and a consumer couldn't tell which.
- **Store a calendar date and a zone per version.** Exact under any later change of zone, but every reader (the render
  rule, the API, the usage numbers) would have to resolve it, and the API would still owe consumers an instant. One
  stored instant, with the day and zone in the audit row, does the same job with less.
- **Sunsets follow the zone when it changes.** Moving a sunset that consumers were told about needs a new notice for
  each, and a move to an earlier instant could withdraw a version at once, or bring back one that had passed.
- **Any IANA zone.** A long list for one setting nobody changes often, and room for a zone ahead of UTC, where a
  day's 00:00 falls on the previous UTC date. The code handles that, but nothing needs it yet.

## Consequences

- Sunsets stop at the start of the day people read, in the zone the business works in, and the port has one written
  rule with three functions to copy.
- Read models carry a sunset as its day in the zone (`sunsetDay`, YYYY-MM-DD) and the picker's calendar as
  `SunsetCalendar` (`zone`, `today`); components format a day and never meet a zone except to name it.
- After a change of zone, a sunset set before it ends at 00:00 in the old zone, and its day is read in the new one: a
  March 1 Eastern sunset reads as February 28 in Pacific, the day it stops there.
- The consumer API keeps serving an instant; [src/contracts/README.md](../../src/contracts/README.md) says what it
  means. Coral, the simulated consumer, shows the instant's UTC date, which is the same day for every zone on the list.
