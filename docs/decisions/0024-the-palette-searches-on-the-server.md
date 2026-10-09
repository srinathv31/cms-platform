# 0024. The ⌘K palette searches on the server, and keeps answers per viewer

Status: Accepted
Date: 2026-10-09

## Context

The top bar read every template the viewer could see, across all their spaces, with its latest version's state,
and passed the list to the palette as props
([I12](../handoff-review.md#i12--medium-every-page-ships-the-whole-template-catalog-and-the-palette-keeps-the-last-personas-data)).
So every page and every `refresh()` carried the whole catalog in its RSC payload, and the palette then fetched
`/api/palette/{space}`, which sent the space's templates again. The browser filtered them. The palette cached that
answer by space alone and preferred it to fresh props, so after a persona switch it showed the last persona's
Recent and Actions until a refetch succeeded. With real sign-in that would be the last user's.

## Decision

- **No page carries templates.** `TopBarHole` passes the palette the viewer's id and spaces only.
- **One read, asked when the palette opens.** `GET /api/palette/[space]?q=&template=` (`searchPalette` in
  `src/server/queries/palette.ts`) answers the space's templates for what was typed, with the facts the palette
  needs beside them: `canCreate`, Recent, and whether the template being viewed (`template`) is the viewer's to see
  there. It replaces the old per-space context read, so nothing is fetched twice. It parses with zod (a `q` over
  `PALETTE_QUERY_MAX` characters is a 400), applies the same visibility as before (a space the viewer can't see is a
  404) and answers through `readResponse`, like the other on-demand reads
  ([0019](0019-on-demand-reads-are-get-routes.md)).
- **One matching rule, in the domain.** `src/domain/palette.ts` holds it: every word must appear in the name, team,
  id or status label; a name that starts with the word ranks first; recent templates win ties. `paletteTemplates`
  decides what a space lists: at rest, Recent (five) and a first page of eight by name; while searching, up to twenty
  matches. The browser ranks the palette's own rows (pages, settings, teams) with the same `rankByQuery`.
- **Asked once per opening, shown from the cache meanwhile.** The resting list is asked as the palette opens, a
  search 150 ms after typing pauses. Each opening asks again for what it shows, so Recent and the statuses are
  current, and shows the cached answer until the new one comes. While a search is on its way, the answer to the
  longest search it extends ("bal" for "bala", at least the resting list) is narrowed to what was typed with the
  same rule, so the list never shows a template that doesn't match.
- **The cache is one viewer's.** Answers are keyed by viewer, space, template being viewed and search. An answer is
  kept only if it was read for the viewer who asked (the route sends `viewerId`). `CommandPalette` mounts a new
  palette, with an empty cache, when the viewer changes.
- **No layout shift on open.** Until the first answer comes the list stays empty: the field shows at once and the
  list appears under it, so nothing on screen moves.
- **Enter still opens the best match.** The first row is selected whenever what was typed changes, as before, and
  again when the server's answer replaces a narrowed one, since it can put better matches above the row picked
  meanwhile. The keys and the commands are unchanged.

## Alternatives considered

- **Keep shipping the list, smaller.** Any per-page list grows with the catalog and is stale after a `refresh()`
  elsewhere; the point is that the page carries none.
- **Filter in SQL.** The status label and the "every word, anywhere" rule don't map onto one `LIKE`. The query reads
  the space's light rows (id, current name, team, latest state) and ranks them with the domain rule, which the
  browser shares. A production backend with a large catalog would move the word filter into the query (a full-text
  index) and keep the ranking.
- **Show the static groups (Pages, Settings, Teams) at once.** The answer's groups (Recent, Actions, Templates) come
  first in the list, so they would push those down when they arrive.
- **Clear the cache in an effect when the viewer changes.** Remounting by `key` drops the cache, the timers and
  what was typed together, and an answer that lands later has nowhere to go.
- **Keep the "a template was just made" signal (`markPaletteStale`).** Every opening asks again, so a template made
  from a starter or an import shows the first time the palette opens after it.

## Consequences

- Pages and `refresh()` payloads no longer grow with the catalog; the palette costs one small request per opening and
  one per pause in typing.
- The first opening on a page, or on a template's pages, shows an empty list for one round trip.
- At rest the palette lists Recent and eight templates; the rest are a search away.
- Real sign-in needs nothing more here: the palette follows the viewer id the top bar passes it, whatever sets it.
