# 0071. Team URLs stay at the root, and the app's own segments are reserved words

Status: Accepted
Date: 2026-10-12

## Context

A team's pages live at `/[team]/…`, beside the app's own top-level segments (`api`, `sim`, `request-access`, …).
`RESERVED_SLUGS` (`src/domain/platform-config/limits.ts`) lists those segments, `validateNewTeam`
(`src/domain/platform-config/teams.ts`) refuses a team whose slug is one of them, and a test in `teams.test.ts`
reads `src/app` and fails when a top-level segment is missing from the list (prototype log, review #14). What the
list can't do is protect a team that already exists: a route added later under a word a team already holds
(`/reports`, say) shadows that team's space.

## Decision

- **Team URLs stay at the root**, `/[team]/…`; no `/t/` prefix.
- **Every top-level route segment is a reserved word**, held by the existing test, which stays.
- **A collision with an existing team is resolved by renaming that team's slug.** That is possible once the slug is
  no longer a key ([0053](0053-team-ids-are-opaque-and-slugs-resolve-at-the-url.md)): one column, with a redirect from
  the old slug if links to it matter.

## Alternatives considered

- **A `/t/{slug}` prefix.** Removes the collision for good, at the cost of every team URL, every stored link and every
  e2e path, for a case that a rename handles when it happens.

## Consequences

- **Node now (wave 2, small):** the test already enforces the reserved list; lane F keeps it passing through the
  team id change and confirms nothing else compares a slug to a route.
- **Java side:** nothing; URLs are the BFF's.
- Whoever adds a top-level route checks that no team holds its name before releasing it, and renames that team's slug
  if one does.
