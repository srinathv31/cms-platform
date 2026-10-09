# 0019. Reads a screen loads on demand are GET routes; only mutations are server actions

Status: Accepted
Date: 2026-10-09

## Context

Five reads that a dialog or a menu loads when it opens were `"use server"` functions: the Compare dialog's versions,
"Revert to v3", the submit summary, the Copilot prompt and the SHARE integration panel
([A6](../handoff-review.md#a6--medium-reads-are-exposed-as-server-actions)). Every export of a `"use server"` file is a
public POST endpoint that takes any input, and Next runs a client's server actions one at a time, in the same queue
as its mutations. The SHARE ring's hover prefetch could hold up Edit or Submit, and a read waited behind them. The
Compare read didn't parse its input. Nothing stopped an agent from adding `"use server"` to a query module such as
`library.ts`, which trusts its caller, and publishing it unguarded.

## Decision

- **Each read is a GET route handler** under `src/app/api/templates/[templateId]/`: `compare?from=&to=`,
  `base-version?draft=`, `submit-summary`, `copilot-prompt` and `integration`. They are internal BFF routes, not
  `/api/v1`.
- **The route is thin.** It calls `getViewer()`, then passes the viewer and the raw path and query values to its
  query in `src/server/queries/` (`server-only`). The query parses them with zod, checks the same permission as
  before, writes nothing, and returns a `ReadResult` (`src/server/api/reads.ts`): the data, or a refusal with its
  sentence and status (400 doesn't parse, 403 not permitted, 404 no such template or version, 409 nothing to read).
  `readResponse()` sends the `ActionResult` the client already read, `{ ok: false, reason }` on a refusal, with
  `Cache-Control: private, no-store`.
- **The browser calls `readTemplate()`** (`src/lib/template-reads.ts`). It returns the route's result, and throws
  when the answer isn't one (no network, an error page), which each caller shows as its own failure, as before.
- **Lint keeps it so.** `no-restricted-syntax` refuses the `"use server"` directive, at the top of a file or inside a
  function, anywhere in `src` except `src/server/actions/` and the simulator's own `src/simulator/actions.ts`.
- The Copilot prompt and the integration panel moved out of `actions/` too. They were reads, and the integration
  panel's prefetch is the queueing case the finding names.

## Alternatives considered

- **Props from the server component that renders the screen.** None of the five is needed until a dialog opens.
  Compare needs any pair of bodies; the base version's body would ride on every workspace load; the submit summary
  and the Copilot prompt must be read after the pending autosave goes out, so props would be stale.
- **Keep them as actions and add zod.** That fixes the validation, not the queue or the POST surface.
- **Answer 401 without a persona cookie.** Today a missing cookie acts as the default persona on every page
  ([S2](../handoff-review.md#s2--high-identity-fails-open-to-the-default-persona), waiting for real sign-in). A 401
  here alone would break these five for a visitor who never switched persona, on a page that otherwise works. The
  routes take the same viewer as the page, so the sign-in work's fail-closed viewer makes them refuse with
  everything else.
- **Parse in the route instead of the query.** In the query, nothing can call it with unparsed input.
- **Stable codes in the body (`ImportResponse`'s `code`).** The status already says the kind and the client shows
  only `reason`. Codes come with [I11](../handoff-review.md#i11--medium-the-ui-branches-on-exact-english-sentences).

## Consequences

- A read never waits on, or holds up, the page's server actions, and each has a URL a Spring backend can serve.
- Lint can't tell a read from a write, so a read added to `actions/` still passes it. Review watches for that.
- Internal routes answer errors in five shapes (`src/app/README.md`), the `ActionResult` one being new to them.
- The simulator's `src/simulator/actions.ts` keeps reads and writes in one `"use server"` file. Coral is a separate
  demo app that reaches Stencil only over `/api/v1`, so it is exempt.
