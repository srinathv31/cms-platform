# 0028. "Today" and "yesterday" are UTC calendar days, counted one way

Status: Accepted
Date: 2026-10-09

## Context

Screens disagreed about which day something happened
([handoff review D9](../handoff-review.md#d9--medium-today-and-yesterday-disagree-between-screens)). The approve,
sunset and revoke dialogs counted 24-hour periods, so a render at 23:00 read "last render today" at 01:00 the next
morning, while the Usage table beside it said "yesterday". The review queue, the review header, the Activity tab's
times and comments counted days in 24-hour periods too ("1 day ago"), the bell and the Audit page counted calendar
days, and each screen had its own copy of the words
([H4](../handoff-review.md#h4--medium-formatting-helpers-are-duplicated-and-clash)). Since the business time zone
([0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)), there is also a second zone a day can be
counted in.

## Decision

- **Calendar days, never 24-hour periods.** Anything on the day before is "yesterday", even an hour ago; 23:59 two
  days back is "2 days ago". `daysBetween` in [src/domain/dates.ts](../../src/domain/dates.ts) is the one way to
  count days.
- **In UTC.** An instant counts as its UTC day: the day every date beside it shows (`formatShortDate`,
  `formatLongDate`, the Activity tab's day headings all read UTC), on the server and in the browser alike. A
  relative word and the date next to it can't name different days.
- **Except a sunset, in the business time zone.** A sunset is a day in that zone, so "sunset tomorrow" and "sunsets
  in 3 days" count that zone's days: `daysUntilSunset` passes `todayIn` and `sunsetDay` to the same `daysBetween`.
- **One set of words.** `formatAgo` says how long ago: "just now", "12 minutes ago" and "3 hours ago" earlier today,
  then "yesterday", "4 days ago", and from 30 days "2 months ago". A screen picks only how precise it is
  (`precision: "day"` reads "today" for all of today), when it switches to a date (`dateFrom`), and whether the label
  stands alone (`capitalize`). Counts go through `formatCount` and nouns through `plural`
  ([numbers.ts](../../src/domain/numbers.ts), [plural.ts](../../src/domain/plural.ts)).

## Alternatives considered

- **24-hour periods.** What the dialogs did: "today" for something the date beside it calls yesterday.
- **The viewer's own zone.** The server renders the page; the browser would then disagree with it, and two people
  would read different days for one render.
- **The business time zone for every day.** Right for sunsets, but every date on screen is UTC, so "yesterday"
  would sit beside a date of today for five hours each evening. If dates ever move to the business zone, the count
  moves with them: both live in `dates.ts`.

## Consequences

- One instant reads the same day on every screen, whatever zone the server or the viewer is in. A cross-screen test
  ([src/components/usage/format.test.ts](../../src/components/usage/format.test.ts)) holds the dialogs, the Usage
  tables, the Versions timeline, the Activity headings, the review queue and the Team settings to it.
- Strings that changed: the dialogs' "last render today" for a render late the day before now says "yesterday"
  (and "N days ago" moves by one at the same boundary). The review queue, the review header, the review rail's
  decisions, the Activity tab's times, comment times, the Library's "last edited" and the save status's "opened" say
  "yesterday" for anything on the day before, where they said "N hours ago" or "1 day ago", and count "N days ago"
  in calendar days; comments switch to a date at 14 calendar days. The bell and the Audit page say "Just now"
  (capitalized like their "Yesterday"). Counts of 1,000 or more in a few Usage notes gain a thousands separator.
- A late-evening event is "yesterday" a few minutes after midnight UTC, which for a US team is the same afternoon.
  That is what the UTC date beside it already said.
