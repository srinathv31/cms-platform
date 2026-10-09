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
- **Search pages the same way** (`after`, `nextCursor`, `hasMore`; `limit` 1–50 per page), in its existing order.
- **The first call** (no `after`) starts at the consumer's oldest notice.
- **`nextCursor` is always present**, on an empty or last page too. A poller keeps it and calls with it; a consumer
  that doesn't want the history pages to the end once and keeps that cursor.
- **A cursor belongs to its list**: the same consumer and `templateId`, or the same `q`. Anything else is 400
  `bad_request`, "after must be the nextCursor of an earlier page of this list." No new error code.
- **Notices page on `consumer_notices.seq`**, a number assigned inside the writing transaction (`nextNoticeSeq`),
  not on `created_at`. An action reads the clock before its transaction, so two actions can commit in the opposite
  order to their timestamps, and one action's notices all share a timestamp under random ids. A cursor on
  `(created_at, id)` would skip a notice in either case; `seq` follows the order notices become visible because
  SQLite has one writer at a time. Existing rows were numbered by `(created_at, id)`.
- **Format** (`src/domain/golive/cursor.ts`): base64url of JSON. Notices:
  `{"v":1,"list":"notices","consumer":"coral","template":null,"seq":42}`; search:
  `{"v":1,"list":"search","q":"rate","last":{"rank":1,"name":"…","id":"UC-…"}}`. Unsigned: a consumer can only read
  its own notices, so an edited cursor shows it nothing new.

## Alternatives considered

- **Keep `since` and add `hasMore`.** A timestamp still skips same-instant notices and late commits.
- **A `(created_at, id)` cursor.** No migration, but skips as above.
- **An offset cursor for search.** Simpler, but a template leaving the list shifts every later page.

## Consequences

- Consumers that keep a cursor get every notice once, in order, however many arrive between polls.
- Every insert into `consumer_notices` must take its `seq` from `nextNoticeSeq` in the same transaction.
- Another backend serving `/api/v1` must read these cursors, because consumers store them. On Postgres a sequence
  isn't commit-ordered: serialize notice writes (for example a transaction-scoped advisory lock around the insert),
  or only serve rows below the oldest open transaction.
- Search keeps its `localeCompare` name order, and its cursor compares names the same way. A port has to match it
  ([D11](../handoff-review.md#d11--low-javascript-only-behavior-that-wont-port-cleanly)).
- Coral reads every page on each load (`allNotices` in `src/simulator/queries.ts`) and keeps no cursor.
