# 0063. Instants are UTC `DATETIME2(3)`, and rows that share one are ordered by `seq`

Status: Accepted
Date: 2026-10-12

## Context

Every timestamp (29 columns) is an `integer` of epoch milliseconds read as a JavaScript `Date`
(`src/server/db/schema/ucomp.ts`), and read models turn it into an ISO string. Some instants hide in JSON as ISO
strings (`versions.revoke`, notice payloads, audit details). An action reads the clock once
(`src/server/actions/kit.ts`), so all its effects share one `at`; three readers break those ties with SQLite's
`rowid`, the insertion order: the Audit page (`src/server/queries/audit.ts`), the Activity tab (`activity.ts`) and the
bell (`notifications.ts`). Usage buckets days with `strftime` (`src/server/queries/usage.ts`): UTC days, as
[0028](0028-today-and-yesterday-are-utc-calendar-days.md) requires; a sunset's day is in the business time zone
([0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)).

MSSQL has no `rowid`, so same-millisecond rows (an approval's "superseded" and "approved") would reorder between
reads. Java's `Instant` carries nanoseconds, which `DATETIME2(3)` rounds, so a value read back can differ from the
one the domain compared. Hibernate 6 maps `Instant` to `datetimeoffset` on SQL Server unless told otherwise.

## Decision

- **An instant is `DATETIME2(3)` in UTC** (SQL Server's date and time without a zone, to the millisecond).
- **The Java `Clock` truncates to milliseconds** (`Clock.tick(base, Duration.ofMillis(1))`), and the Hibernate
  mapping for `Instant` is set explicitly.
- **Append-only tables order by `(at, seq)`**, `seq` being the identity column
  [0060](0060-template-ids-are-random-and-retried-on-a-collision.md) gives them.
- **Days are `CAST(at AS DATE)`**, UTC days per 0028; sunsets stay days in the business time zone per 0017.
- **ISO strings at every boundary**: read models, `/api/v1`, and JSON that stays JSON. Instants move out of JSON where
  [0061](0061-documents-stay-json-and-references-become-rows.md) makes them columns (the revoke record).

## Alternatives considered

- **`DATETIMEOFFSET(3)`.** An explicit offset, always +00:00 here, at two bytes more per column; the choice if the
  DBA standard requires it.
- **`BIGINT` epoch milliseconds**, as today. Unreadable in SQL tools, and every day bucket needs `DATEADD`.
- **ULIDs** (ids that sort by creation time) instead of a `seq`. They order rows too, but a second scheme beside the
  identity key the log tables already get.

## Consequences

- **Node now:** nothing; the read models already speak ISO strings.
- **Java side:** the column types, the clock, the Hibernate mapping, and `ORDER BY at DESC, seq DESC` where the
  Audit page, Activity and the bell read today.
