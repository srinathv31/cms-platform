# Next.js App Router primer

For a developer who knows Node and React but not the App Router. It covers what you need before you read this app's
`src/app`, `src/server/actions` and `src/server/queries`: where code runs, what is public, how a page arrives, and why
the build rejects some code that runs fine in `npm run dev`. This is Next.js 16 with Cache Components on, which is
not the Next.js most tutorials teach. The authoritative text ships with the package, in
`node_modules/next/dist/docs/`; each section says which page it comes from.

## Server components are the default

A file under `src/app` or `src/components` is a server component unless its first line is `"use client"`. A server
component is an ordinary `async` function that runs on the server, once per render, and can `await` a database read
or a cookie. It sends no JavaScript to the browser. A client component is the React you already know: state, effects,
event handlers, browser APIs.

`"use client"` marks a file, not a function. Everything that file imports joins the browser bundle, so a client file
never imports `src/server`. Data crosses from server to client as props, and props must be serializable: plain
objects, arrays, strings, numbers, dates, never a function. That is why the read models in `src/server/queries` return
plain data with dates as ISO strings, and why a server component hands a client component facts, not a database row
(server and client boundary, `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md`).

## Why `"use server"` is a public endpoint

`"use server"` at the top of a file makes every exported function a server action. Next.js gives each one a URL and
the browser calls it with a POST. The call looks like a function call in your component, but anyone can send that POST
by hand with any body, signed in or not. The framework says so itself: "Server Functions are reachable via direct POST
requests, not just through your application's UI. Always verify authentication and authorization inside every Server
Function" (mutating data, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`).

So the rule in this repo is that nothing a `"use server"` file exports trusts its caller. Every action runs on
`serverAction` in [kit.ts](../../src/server/actions/kit.ts): read the request context (who is asking, or `signed_out`),
parse the input with zod, then call the backend, which checks the permission. Because the directive is a public
surface, lint allows it only in `src/server/actions/` (and the simulator's own actions file), and a file marked with
it may export only async functions, which is why shared helpers live in the unmarked `kit.ts`.

Next.js also runs a client's actions one at a time, each waiting for the last
(server actions, `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`). Autosave sends a request after every pause in typing and must not queue behind a slow action, so it is a route handler
(`PUT /api/drafts/[versionId]`), not an action. A read a screen loads on demand is a `GET` route: actions are for
mutations only.

After a mutation an action calls `refresh()` from `next/cache`, which re-renders the current page with fresh data, and
`revalidatePath()` for other routes that show the change. Route handlers can't call `refresh()`.

## Streaming and hydration

The server doesn't build a whole page and then send it. React sends HTML in pieces, split at `<Suspense>` boundaries:
the layout and every fallback first, then each suspended part as its data resolves, with a small inline script that
swaps the fallback for the real content. The browser paints this as it arrives, before any JavaScript has loaded
(streaming, `node_modules/next/dist/docs/01-app/02-guides/streaming.md`).

Hydration comes after. React loads the client components' JavaScript and attaches event handlers to the HTML it
already has. Until then a button is visible but dead, which is why the e2e helpers wait on `hydrated(page)`
([e2e/helpers/scenario.ts](../../e2e/helpers/scenario.ts)) before they click. The data client components need arrives
with the page as the RSC payload, a serialized description of the tree; on a client-side navigation only that payload
is fetched, no HTML.

This app uses one boundary component, `Stream` ([stream.tsx](../../src/components/primitives/stream.tsx)): a `Suspense`
plus a view transition, with a fallback skeleton that has the final geometry so nothing shifts. There is no
`loading.tsx` anywhere. A page looks like this:

```tsx
export default function TemplateVersionsPage({
  params,
}: PageProps<"/[team]/templates/[templateId]/versions">) {
  return (
    <Stream fallback={<VersionsSkeleton />}>
      <VersionsContent params={params} />
    </Stream>
  );
}
```

The page is synchronous. It passes the `params` promise down unawaited, and the streamed child awaits it. That split
is the whole pattern, and the next section is why.

## Why `cookies()` outside Suspense is a build error

`next.config.ts` sets `cacheComponents: true`. With it, `next build` prerenders every route into a static shell:
everything that doesn't depend on a request, plus the fallbacks of the Suspense boundaries. Anything that does depend
on a request must wait for one, so it has to sit inside a boundary. Reading `cookies()`, `headers()`, `params` or
`searchParams`, or doing an uncached fetch or database read, outside `<Suspense>` makes the build fail with "Next.js
encountered uncached or runtime data during prerendering" and names the route
(building, `node_modules/next/dist/docs/01-app/02-guides/building.md`,
caching, `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`). In `next dev` the same mistake
shows as a "blocking-route" overlay, easy to miss, and no test sees it.

That is why every read of request data in this repo happens under a `Stream`: the viewer (the `ucomp_persona` cookie),
awaited `params`, database reads and the clock. It is also why `npm run build` is the one check that enforces the
rules, and why you run it when you change a page, a layout, a route handler or anything a server component reads. If a
build error doesn't say where, `next build --debug-prerender` gives readable stack traces.

## `cache()` and `connection()`

Two helpers with confusingly similar jobs.

`cache` is React's, from `react`. It memoizes a function for the length of one server render, so several components
asking `getVersions(team, id)` share one result, and `findRequestContext` reads the cookie once for the whole page. It
is not a cross-request cache: the next request starts empty. Outside a render, in a server action or a route handler,
it doesn't memoize at all, so those entry points read the request context once at the top and pass it down
([request.ts](../../src/server/context/request.ts)). Next.js has a cross-request cache of its own, `"use cache"`.
Nothing in `src` uses it; every read happens at request time.

`connection()` comes from `next/server`. `await connection()` says "stop prerendering here; what follows needs a real
request". You need it when code reads no request API but must still run per request. This app's case is the database:
libSQL answers in microtasks, so a query that runs before any request API can finish during the prerender and be baked
into the static shell. Hence `await connection()` ahead of the clock read in
[clock.ts](../../src/server/services/local/clock.ts), and in `DemoTools`
([demo-pill-hole.tsx](../../src/components/demo/demo-pill-hole.tsx)), whose `DEMO_MODE` check would otherwise freeze the
build's value into the page. The framework's page on it is
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`.

## Where to go next

- [src/app/README.md](../../src/app/README.md) has the Cache Components rules this repo follows and the route map.
- [architecture.md](../architecture.md) walks a page, a mutation and an autosave through the code.
- [first-change.md](first-change.md) adds a field through every layer.
