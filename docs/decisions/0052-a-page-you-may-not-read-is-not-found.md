# 0052. A page you may not read is Not found

Status: Accepted
Date: 2026-10-12

## Context

Stencil answered "you may not read this" three ways
([M-3 of the October 12 review](../quality-review-2026-10-12.md)). A Team section of the settings modal threw
`PermissionError`, which no boundary caught, so the tab said "This tab didn't load"; the Platform sections and the
Audit page called `notFound()`; and a team the viewer can't see redirected to their default space, or to Request
access. The redirect also told anyone who typed a team's slug whether that team exists: a made-up slug was Not found,
a real one redirected. A Java or BFF port has to pick one answer, and three answers in the prototype give it three
to copy.

## Decision

- **One answer: the Not found page.** Whatever the viewer may not read shows the Not found page, the same one as for
  something that doesn't exist: a team space, a Team or Platform settings section, the Audit page. `requireCan(viewer, action, resource)`
  in `src/server/queries/require-can.ts` is the one helper: the domain's `can()` decides, and a refusal of any kind
  (no role, a guard) becomes `notFound()`. `requireSpace` asks it for `template.view` on the team (or in the
  cross-team space), which is what `canSeeSpace` answers for the team switcher and the persona switch; a test holds
  the two to the same answer for every seeded person and space.
- **The page is not a real 404.** Under Cache Components every page streams its static shell first, and the check
  runs inside `<Stream>`, so the response is already `200 OK` when `notFound()` fires. Next adds
  `<meta name="robots" content="noindex">` and renders the Not found UI. A true 404 status needs the check before
  the response streams, in `proxy.ts`, which this prototype doesn't have. A port that wants the status builds it
  there, not by copying "404" from this record.
- **Not found offers the way back.** The page's Back to library goes to `/`, which sends the viewer to their own
  space's Library, or to Request access when they have no team.
- **The persona switch keeps its redirect.** It is a demo tool that moves the viewer, not a page answering a URL: a
  switch to someone who can't see the current page still lands in their own space.
- **Routes are unchanged, and they send real statuses.** The `/api/*` route handlers (the GET routes and the audit
  export) answer with a status and a refusal code (403 not permitted, 404 not there), as decision [0019](0019-on-demand-reads-are-get-routes.md) set; a caller of a route
  already knows what it asked for.

## Alternatives considered

- **Redirect to the viewer's own space.** Friendlier for a stale link, but a page that moves you without saying why
  reads as a bug, and it tells a stranger which slugs are real.
- **403 Forbidden (Next's `forbidden()`).** Honest about the reason, but it confirms the thing exists, and it needs
  the experimental `authInterrupts` flag.
- **A sentence on the page ("You don't have access to this team").** The same oracle as 403, and a second way of
  saying it beside the controls that already explain a blocked action.

## Consequences

- A link to a team the viewer has lost reads Not found; Request access is one click away through Back to library.
- A crawler or a monitor sees `200` with `noindex` for a page the viewer may not read, not a `404`. The people who
  use the app see the right page, and an e2e check reads its heading.
- The settings modal still sends a section the viewer's group may not open back to the Library before any query
  runs (`SettingsPanel`); `requireCan` is the guard behind it.
- `assertCan` and `PermissionError` had no caller left once the reads used `requireCan` and the actions refused
  through the kit's `check()`, so they are deleted from `src/domain/permissions.ts`.
