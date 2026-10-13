# 0062. On MSSQL, invariants hold in the database, not in one writer

Status: Accepted
Date: 2026-10-12

## Context

Several invariants hold only because `src/lib/serialized-writes.ts` makes every write in the process take turns
([B3](../handoff-review.md#b3--medium-invariants-rely-on-sqlites-single-writer), H-2 of the
[October 12 review](../quality-review-2026-10-12.md)):

- **The notice sequence.** `takeNoticeSeqs` (`src/server/effects.ts`) reads `settings.consumer_notice_seq` and
  `MAX(seq)`, then writes. [0006](0006-page-notices-by-commit-order.md) requires `seq` in commit order, so a consumer
  paging by `seq` never skips a notice.
- **One pending access request per user and team, and one open recertification per team**: checked in TypeScript
  (`src/domain/access/requests.ts`, `recertification.ts`), with no constraint.
- **The last Team Admin**: `losesLastAdmin` (`src/domain/access/members.ts`) reads, checks, then the action writes.
- The schema has no CHECK constraints, and `settings` mixes the counter, a platform setting (`business_zone`) and
  demo state.

Azure SQL defaults to read committed snapshot isolation, where a plain `SELECT` reads the last committed row without
locking, so two instances can read the same counter or the same admin count. A `SEQUENCE` alone, which review §8 #3
suggested, removes duplicates but not the ordering problem: transaction A takes 42 and B takes 43, B commits first, a
consumer reads 43 and keeps it in its cursor, then A commits, and 42 is behind the cursor for ever.

## Decision

- **The notice sequence is a counter row updated inside the writing transaction**:
  `UPDATE notice_counter SET last = last + @n OUTPUT inserted.last`. The row lock is held to commit, so the next writer
  waits and numbers after it: commit order, no reuse, no gaps. It is 0006's "serialize notice writes", on MSSQL.
- **Filtered unique indexes** (unique over the rows a `WHERE` selects), in Flyway SQL since Hibernate can't generate
  them: `access_requests(user_id, team_id) WHERE status = 'pending'`;
  `recertifications(team_id) WHERE completed_at IS NULL`; and
  `versions(template_id, number, round) WHERE number IS NOT NULL`, since MSSQL unique indexes treat NULLs as equal.
- **Membership changes lock the team row** (`WITH (UPDLOCK, HOLDLOCK)`, or JPA `PESSIMISTIC_WRITE`), so two admins
  can't demote each other.
- **A CHECK on every enum column**: version state, membership status, roles, decisions, thread status, comment kind,
  request status, render channel, outcome and platform, notice kind, platform role.
- **`versions.rev` is JPA `@Version`**; the compare-and-set predicates stay, safe under snapshot isolation because an
  `UPDATE` reads the latest committed row and locks it.
- **`settings` splits** into a typed `platform_settings` row, the counter table, and demo state that goes with
  `DEMO_MODE` ([0051](0051-the-demo-tools-run-only-in-demo-mode.md)).
- The missing indexes of review M-12 are added. A "porting the data model" page, with the review's entity map, goes in
  the handoff package.

## Alternatives considered

- **A `SEQUENCE` for `seq`.** Not commit-ordered: breaks 0006.
- **An application lock (`sp_getapplock`) around a `SEQUENCE`.** The same effect with more parts.
- **Number notices when they're published** (insert without `seq`, one job numbers visible rows). Correct, but adds
  latency and a job.
- **An optimistic `teams.rev` bumped by every membership change.** Also safe, but the losing admin gets a conflict
  to retry where a lock would simply wait a moment.

## Consequences

- **Node now:** nothing; lane F's local implementation keeps the SQLite lock behind the same interfaces.
- **Java side:** the counter table, the indexes, the team lock and the CHECKs in Flyway; only notice-writing actions
  (approve, sunset, revoke and the sunset sweep) contend for the counter.
