# 0059. Template search filters, ranks and pages in SQL

Status: Accepted
Amended 2026-10-13: the ⌘K palette's search lists its matches in this order too: rank (the score of `paletteTemplates`), then name, then id, by code point (`paletteSearch` in `src/domain/palette-search.ts`, which the templates service's `palette` answers with, in the local implementation and the fake alike; the contract suite's `templates.palette` cases pin it). `searchActiveTemplates` is in `src/server/services/local/consumer-api.ts` now: `/api/v1` is the backend's own.
Date: 2026-10-12

## Context

`GET /api/v1/templates?q=` runs `searchActiveTemplates` (`src/server/services/local/consumer-api.ts`). It loads every Active
version with its template, team, content type and variables, then in JavaScript: matches an exact id (with or
without `UC-`, any case) or every lower-cased word as a substring of the Active version's name; ranks 0 (the id),
1 (the name starts with the whole query) or 2 (the rest); sorts by `(rank, name, id)` by Unicode code point
(`compareSearchKeys` in `src/domain/golive/cursor.ts`); drops everything up to the cursor's last key; and cuts the
page. The cursor is keyset paging ("the rows after the last key I saw", not an offset), as
[0006](0006-page-notices-by-commit-order.md) decided.

The in-memory load grows with every Active template on every page. A port reaching for `OFFSET … FETCH` breaks the
stable cursor; one reaching for SQL Server full-text search matches words with stemming, not substrings; and a plain
`ORDER BY name` under the default case-insensitive collation is not code-point order.

## Decision

- **Filter, rank and page in SQL.** One `LOWER(name) LIKE '%' + @word + '%' ESCAPE '\'` per word (wildcards in the
  query escaped); `rank` as a `CASE` (0 for the exact id, 1 for `LIKE @q + '%'`, 2 otherwise) in a CTE; the keyset on
  `(rank, name, id)` written out as `OR`s; `ORDER BY rank, name, id` under a binary collation
  (`Latin1_General_100_BIN2`); `TOP (@limit + 1)` to learn `hasMore`.
- **Matching is unchanged:** every word, as a case-insensitive substring of the Active version's name, or the id.
- **0006's cursor semantics are kept.** The search cursor's inner format may change with a `v` bump, since search
  cursors are short-lived; notice cursors, which pollers store, must stay readable.

## Alternatives considered

- **Keep ranking in memory, with a cap.** A simple port with a hidden ceiling on the catalog.
- **A full-text index.** Scales, but changes what matches: a contract change to make on purpose, not a port detail.

## Consequences

- **Node now:** nothing required. Optionally, lane F's query package moves the rank rule into `src/domain`, since
  "how search ranks" is one of the rules the backlog lists outside it.
- **Java side:** the query, and `variableCount`/`requiredCount` from `OPENJSON` or from counts written at submit.
  It still scans the Active versions (a substring `LIKE` can't use an index), which is fine at thousands of templates.
- Lane J's brief states the matching rule and the order, with two caveats: a binary collation compares UTF-16 code
  units as Java's `String.compareTo` does, which differs from code-point order only outside the Basic Multilingual
  Plane (the caveat 0006 names; one probe confirms it); and SQL `LOWER` and JavaScript `toLowerCase` differ on a few
  letters (`İ`, `ß`).
- The same contract suite runs the same searches against both implementations
  ([0068](0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)).
