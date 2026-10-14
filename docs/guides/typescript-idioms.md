# TypeScript and React idioms you meet first

The code is idiomatic TypeScript for Node and React, and it stays that way. It prefers plain functions and data to
class hierarchies, closures to private fields, and unions to exceptions, because that is what the Node and React
ecosystems read fluently, and mixing two languages' conventions is how a codebase gets messy. A developer who knows
Java will still trip on the ten patterns below, so each is explained once here with a real example. When you meet one,
read the example here, not a rewrite.

Comments follow one convention in every file. A file's header comment is its contract: what it is for, its rules, often
an example. A `/** */` comment documents an export. A `//` comment records a decision at the line it applies to. There
are almost no JSDoc `@param` tags: the types already say what a parameter is, and the sentence says why.

## 1. A type derived from a function

```ts
// src/server/services/local/version-rows.ts
export type FoundVersion = NonNullable<Awaited<ReturnType<typeof findVersion>>>;
```

Read it inside out. `typeof findVersion` is the function's type. `ReturnType` takes what it returns, a
`Promise<Row | undefined>`. `Awaited` unwraps the promise, and `NonNullable` drops the `undefined` for the case where a
row was found. The type is _derived_ from the query, so when the query's columns change, every use follows the
compiler. A hand-written interface beside it could drift.

## 2. `?? refuse(…)` as an expression

```ts
// src/server/services/local/access.ts
const team =
  (await teamNamed(tx, ref.teamId)) ?? refuse(REQUEST_REFUSALS.teamGone);
```

`a ?? b` is `a` unless it is `null` or `undefined`. `refuse` throws and is typed to return `never`, so TypeScript
knows the right side never produces a value, and narrows `team` to the non-null type on the next line. It reads as
"this, or stop the command with this answer", in one expression, with no `if (!team) throw` and no cast. The throw
becomes `{ ok: false, code, reason }` and undoes the transaction (`RefusalError` in
[refuse.ts](../../src/server/services/refuse.ts)).

## 3. `??=` to memoize a promise

```ts
// src/server/services/local/effects.ts
let audience: Promise<string[]> | undefined;
const consumerAudience = () => (audience ??= recentConsumers(tx, ctx));
```

`x ??= y` assigns `y` only when `x` is `null` or `undefined`, and evaluates to the result. Here the first call starts the
query and stores the _promise_, not the result, so later calls, even before it resolves, share it. The query runs at
most once, and only if a notice needs it. The same line appears for lazily built singletons
(`return (current ??= build(BACKEND))` in [services/index.ts](../../src/server/services/index.ts)).

## 4. A function with a property

```ts
// src/domain/lifecycle/refusals.ts
noContentType: refusal("no_content_type", (family) => `No content type makes ${…}s yet.`),
// src/server/drafts/http.ts
[REQUEST_REFUSALS.signedOut.code]: 401,
```

Functions are objects, and `refusal()` in [refusals.ts](../../src/domain/refusals.ts) uses it. A refusal whose sentence
names something (a team, a count) is a function you call to get the sentence, and it carries a `code` property you can
read without calling it, made with `Object.assign(fn, { code })`. So every entry in a refusal table has a `.code`, fixed
or worded, and a switch or a table key can branch on it. Code branches on the code, never on the sentence.

## 5. A closure as the state

```ts
// src/components/workspace/session/session-store.ts
export function createWorkspaceSession(): WorkspaceSession {
  const store = createStore<SessionState>()(() => ({ ...INITIAL_SESSION_STATE }));
  let sink: ((fields: SaveFields) => void) | null = null;
  let held: SaveFields | null = null;
  // …
  return {
    subscribe(listener) { … },
    getBinding: () => get().binding,
    save, bind, …
  };
}
```

Where Java would write a class with private fields, this returns an object of functions that close over `let`
variables. The variables are private because nothing outside can name them, and no `this` is involved. What a component
must re-render for lives in the store; what only the rules use (the autosave host's callbacks, counters) stays in the
closure, where changing it notifies no one. The same shape appears in
[autosave-scheduler.ts](../../src/components/workspace/autosave/autosave-scheduler.ts).

## 6. `useSyncExternalStore` with a server snapshot

```tsx
// src/components/workspace/session/workspace-session.tsx
return useSyncExternalStore(
  session.subscribe,
  session.getStatus,
  () => INITIAL_SESSION_STATE.status,
);
```

This is React's hook for reading a store that lives outside React (here the session above). It takes `subscribe`, a
getter for the current value, and a third function, the _server snapshot_: what to return while the server renders and
while the browser hydrates. It must match what the server sent, or hydration warns. The session starts in
`INITIAL_SESSION_STATE`, so the server and the first client render agree, and then the real value takes over.

## 7. `key` as a remount

```tsx
// src/components/workspace/content/content-workspace.tsx
<EditorScope key={shown.gen} variables={shown.variables} …>
```

In React a component's identity is its position and its `key`. Changing the key throws the old instance away and
mounts a new one, with fresh state. `shown.gen` counts how many times a revert has replaced the content, so a revert
rebuilds the editor and its fields from the new values instead of patching state inside them
([use-content-revert.ts](../../src/components/workspace/content/use-content-revert.ts)). A `key` here is not only for
lists.

## 8. `data-slot` and `data-status` as a test contract

```tsx
<div data-slot="editor" className={cn(WS.doc, "relative")}>
```

The shadcn components put a `data-slot` on their root, and Stencil's components do the same, plus `data-status` on
status badges. They have no style. Browser specs select by them
(`page.locator('[data-slot="versions"]')` in [navigation.spec.ts](../../e2e/navigation.spec.ts)), because a role and a
name don't name a region and a class is a styling detail. They are an interface: grep `e2e/` before you rename one.

## 9. A `Proxy` that wraps a client

```ts
// src/lib/serialized-writes.ts
return new Proxy(client, {
  get(target, prop) {
    switch (prop) {
      case "execute": return (stmt, args) => READ_ONLY.test(sqlOf(stmt)) ? target.execute(stmt, args) : inTurn(() => target.execute(stmt, args));
      // …
```

A `Proxy` intercepts property access on an object. `serializeWrites` returns something that looks like the libSQL
`Client` and makes every write take its turn on one lock, with no change to any caller and no subclass. The test
support in [fresh-database.ts](../../src/lib/fresh-database.ts) uses another to point a module-level `db` at a new copy
of the database for each test. Two files in `src/lib` use it; if you want one, read the header of
[serialized-writes.ts](../../src/lib/serialized-writes.ts) first.

## 10. `"use client"` is a file boundary

```tsx
// src/components/primitives/use-action-run.ts
"use client";

import { useRef, useState, useTransition } from "react";
```

The directive isn't a function annotation. It marks a file as the entry of the browser's module graph: that file and
everything it imports ship to the browser, and everything else stays on the server. So a client file never imports
`src/server`, and its props must be serializable. The same applies to `"use server"` at the top of a file, which makes
each export a public endpoint ([nextjs-primer.md](nextjs-primer.md)). Both are directives for the bundler, not types.

## Two small habits

- **Discriminated unions, not exceptions, for expected outcomes.** An action answers `{ ok: true } | { ok: false, code,
reason }` (`ActionResult`); a domain rule returns `{ ok: true, changes, effects }` or a refusal. Callers narrow on
  `ok`. Exceptions are for bugs.
- **`import type` and `satisfies`.** `import type` keeps a value import out of the bundle; `satisfies` checks a literal
  against a type without widening it.
