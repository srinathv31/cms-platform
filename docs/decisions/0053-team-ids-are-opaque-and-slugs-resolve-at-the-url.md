# 0053. Team ids are opaque, and a slug is resolved to an id once, at the URL

Status: Accepted
Date: 2026-10-12

## Context

A team's id equals its slug: `createTeam` builds `{ id: slug, slug, … }` (`src/domain/platform-config/teams.ts`),
and the seed does the same (`coral-offers`). The schema has both columns, `slug` unique, and nothing ties them
([H-1 of the October 12 review](../quality-review-2026-10-12.md)). The code then uses one where the other is meant:
`getShell` in `src/server/queries/spaces.ts` passes a slug as `teamId` to `can()`; `getSidebarCards` in
`src/server/queries/access.ts` filters `access_requests.team_id`, `recertifications.team_id` and
`memberships.team_id` with slugs; `accessHref` (`server/access-effects.ts` then) and `teamPath` (`src/domain/audit.ts`)
build URLs from ids; notifications store hrefs that hold the slug (`notificationHref` in `server/effects.ts` then).
Six comments call it "the seed contract". `/api/v1` publishes it as `team.id`.

A JPA entity with a generated key (the default) would break every one of these without an error, and because the
seed sets id = slug, no test can catch it.

## Decision

- **A team's id is opaque and never equal to its slug.** The seed gives teams ids like `t_coral`, so any place that
  still swaps one for the other fails a test.
- **The slug is resolved to an id once, at the URL edge** (`requireSpace`, and the request context lane F builds).
  Below that, services, permission checks and SQL take the id; nothing compares a slug with a `team_id`.
- **Nothing stored holds a slug.** Links are stored as descriptors and built from the slug when read
  ([0055](0055-notifications-store-facts-and-are-worded-on-read.md)).
- The slug stays fixed for now (there is no rename); because it is no longer a key, a rename later changes one column
  plus a redirect, not every foreign key.

## Alternatives considered

- **Keep id = slug, enforced with a CHECK.** The smallest change, but team URLs could never follow a rename, and
  every future developer would have to know not to add a surrogate key.
- **Split the columns but keep them equal in the seed.** The code compiles and the tests pass whether or not the
  interchange is fixed.

## Consequences

- **Node now (wave 2, lane F):** about ten call sites take the id (the places above, the audit page's team fallback,
  `createTeam`), the "seed contract" comments go, and the e2e SQL that binds a slug to `team_id` changes. The
  seed's team ids change with it, agreed with lane K.
- **Java side:** `Team` has an ordinary surrogate key; `/api/v1` sends `team.id` as an opaque string (lane J's brief
  says so).
- A team URL keeps working after any future rename only if a redirect table is added then
  ([0071](0071-team-urls-stay-at-the-root-with-reserved-words.md)).
