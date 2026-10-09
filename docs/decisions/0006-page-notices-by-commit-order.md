# 0006. Page notices and search with an opaque cursor, notices in commit order

Status: Accepted
Date: 2026-10-08

## Context

`GET /api/v1/consumers/{id}/notices` returned the newest notices first, filtered by `since` (a time) and cut at
`limit`, with no way to ask for more. A consumer polling with `since=lastSeen` that had more than `limit` new notices
lost the oldest ones, and one of them could be a revoke ([A2](../handoff-review.md#a2--high-consumers-polling-notices-can-silently-miss-a-revoke)).
Template search stopped at 50 results. Coral is the only caller today, so the contract can still change, and a Java
team would port it as it stands. This supersedes the `since` entry under
[Consumer API (S1)](prototype-log.md#consumer-api-s1) in the prototype log.

## Decision

The owner chose to replace the contract now, as a breaking change.

- **Notices come oldest first**, in the order Stencil wrote them. A call takes `after`, an opaque cursor, and
  `limit` (1–200, default 50). The response adds `nextCursor` and `hasMore`. `since` is removed.
- **Search pages the same way** (`after`, `nextCursor`, `hasMore`; `limit` 1–50 per page), in its existing order,
  with names and ids now compared by Unicode code point instead of the server's locale.
- **The first call** (no `after`) starts at the consumer's oldest notice.
- **`nextCursor` is always present**, on an empty or last page too. A poller keeps it and calls with it; a consumer
  that doesn't want the history pages to the end once and keeps that cursor.
- **A cursor belongs to its list**: the same consumer and `templateId`, or the same `q`. Anything else is 400
  `bad_request`, "after must be the nextCursor of an earlier page of this list." No new error code.
- **Notices page on `consumer_notices.seq`**, a number assigned inside the writing transaction (`takeNoticeSeqs`),
  not on `created_at`. An action reads the clock before its transaction, so two actions can commit in the opposite
  order to their timestamps, and one action's notices all share a timestamp under random ids. A cursor on
  `(created_at, id)` would skip a notice in either case; `seq` follows the order notices become visible because
  SQLite has one writer at a time. Existing rows were numbered by `(created_at, id)`.
- **A number is never handed out twice.** The last one taken is kept in `settings.consumer_notice_seq` and only goes
  up. `max(seq) + 1` would reuse the numbers of deleted notices (e2e cleanup deletes a template's notices), and a
  consumer whose cursor is already past them would never see the notice that reused one.
- **A reset changes the epoch.** A demo reset starts the numbers again, so the notice cursor carries
  `settings.seeded_at`, which the seed rewrites. A cursor from before a reset is 400 `bad_request`, "after is from
  before the notices were reset. Start again without after.", instead of silently skipping the new notices.
- **Format** (`src/domain/golive/cursor.ts`): base64url of JSON. Notices:
  `{"v":1,"list":"notices","consumer":"coral","template":null,"epoch":"2026-10-08T…Z","seq":42}`; search:
  `{"v":1,"list":"search","q":"rate","last":{"rank":1,"name":"…","id":"UC-…"}}`. Unsigned: a consumer can only read
  its own notices, so an edited cursor shows it nothing new.

## Alternatives considered

- **Keep `since` and add `hasMore`.** A timestamp still skips same-instant notices and late commits.
- **A `(created_at, id)` cursor.** No migration, but skips as above.
- **`max(seq) + 1` for the next number.** No counter row, but reuses deleted numbers.
- **An offset cursor for search.** Simpler, but a template leaving the list shifts every later page.

## Consequences

- Consumers that keep a cursor get every notice once, in order, however many arrive between polls.
- Every insert into `consumer_notices` must take its `seq` from `takeNoticeSeqs` in the same transaction.
- Another backend serving `/api/v1` must read these cursors, because consumers store them. On Postgres a sequence
  isn't commit-ordered: serialize notice writes (for example a transaction-scoped advisory lock around the insert),
  or only serve rows below the oldest open transaction. Its epoch must change whenever the numbering restarts.
- Search order no longer depends on the machine's locale. Java's `String.compareTo` matches it except for
  characters outside the Basic Multilingual Plane, where a port compares `codePoints()`.
- Coral reads every page on each load (`allNotices` in `src/simulator/queries.ts`), at most 50 pages, and keeps no
  cursor. An answer that wouldn't end is an error, not a loop.
