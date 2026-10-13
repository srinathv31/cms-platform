# `src/server/services`: the backend seam

The service interfaces are everything the BFF (the server actions, the read models, the route handlers) asks the
backend: one interface per area, each method taking the request context first and answering an `ActionResult` (a
command) or a `ReadResult` (a read). Behind them, the backend holds the data and runs the rules and the permission
checks ([decision 0070](../../../docs/decisions/0070-rules-and-permission-checks-sit-behind-the-service-interfaces.md)).
Today the backend is this app's own code over SQLite, the **local implementation**; after the port it is the Java
API, reached through an HTTP implementation of the same interfaces. The BFF's own surface (the actions, the GET routes,
autosave, the read models' shapes) doesn't change when the backend does. Rendering already works this way
([render/engine.ts](../render/engine.ts)).

```text
 browser ──► server action ─┐
           GET route ───────┤  BFF: parse (zod), word, lay out, refresh. Reads the request context once.
           page (RSC) ──────┘
                 │  services().<area>.<method>(ctx, input)
                 ▼
          ┌─ interfaces (this folder) ─┐
          ▼              ▼              ▼
     local/ (today)   fake/ (tests)   http/ (later: the Java API, types generated from its OpenAPI spec)
     Drizzle + domain  arrays + domain
```

## Layout

| Path                                                                                                                                                                                                                                                                                                                                                                     | What it holds                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [types.ts](types.ts)                                                                                                                                                                                                                                                                                                                                                     | `Services`, one property per area, and the shapes every method shares (`ActionResult`, `ReadResult`, `Changed`).                                                                                                                                                                                                                                                                                       |
| [index.ts](index.ts)                                                                                                                                                                                                                                                                                                                                                     | `services()`: the implementation `STENCIL_BACKEND` names ([config.ts](../config.ts)), built once. The only way the BFF reaches the backend.                                                                                                                                                                                                                                                            |
| [review.ts](review.ts), [versions.ts](versions.ts), [templates.ts](templates.ts), [drafts.ts](drafts.ts), [comments.ts](comments.ts), [access.ts](access.ts), [platform.ts](platform.ts), [notifications.ts](notifications.ts), [audit.ts](audit.ts), [usage.ts](usage.ts), [render.ts](render.ts), [identity.ts](identity.ts), [clock.ts](clock.ts), [demo.ts](demo.ts) | One interface per area, with what each method promises: its input, its answer, and its refusals in order.                                                                                                                                                                                                                                                                                              |
| [refuse.ts](refuse.ts)                                                                                                                                                                                                                                                                                                                                                   | `refuse`, `check`, `permit`, `RefusalError`, `answerFor`: how an implementation stops a command with a refusal and undoes its writes.                                                                                                                                                                                                                                                                  |
| [not-moved.ts](not-moved.ts)                                                                                                                                                                                                                                                                                                                                             | `notMoved`, `notMovedArea`: what a method answers while its area still runs outside the seam (it throws; nothing calls it).                                                                                                                                                                                                                                                                            |
| [local/](local/)                                                                                                                                                                                                                                                                                                                                                         | The local implementation: [command.ts](local/command.ts) (`runCommand`, the command kit), [review.ts](local/review.ts), [versions.ts](local/versions.ts), [version-rows.ts](local/version-rows.ts) (the version reads and the compare-and-set the review commands share), [index.ts](local/index.ts), and [contract-harness.ts](local/contract-harness.ts) for the contract suite.                     |
| [fake/](fake/)                                                                                                                                                                                                                                                                                                                                                           | The in-memory fake: [state.ts](fake/state.ts) (the tables, seeded from the same seed), [store.ts](fake/store.ts) (a command's writes and their undo), [rows.ts](fake/rows.ts), [effects.ts](fake/effects.ts), one file per area, [index.ts](fake/index.ts), and the test support: [testing.ts](fake/testing.ts) for BFF tests, [contract-harness.ts](fake/contract-harness.ts) for the contract suite. |
| [contract/](contract/)                                                                                                                                                                                                                                                                                                                                                   | The contract suite: [harness.ts](contract/harness.ts) (what an implementation provides to run it), the cases per area ([review.ts](contract/review.ts), [versions.ts](contract/versions.ts)), and their runners (`*.test.ts`).                                                                                                                                                                         |

The request context the methods take is [src/server/context/request.ts](../context/request.ts).

## The request context

`findRequestContext()` reads, once per request, who is asking (the viewer), the request's instant (`now`, on the
demo clock), a correlation id, and a credential slot an HTTP implementation will fill with the user's token for the
Java API (the sign-in work decides how). It is the one place the BFF reads the persona and the clock: a service never
reads a cookie, the viewer or the time itself.

It fails closed: with no viewer there is no context. An action answers `signed_out`, a read route 401, a page the Not
found page (`requestContextOrRefusal`, `requireRequestContext`). It never stands in a default person; the persona
cookie's fallback to Maya is the sign-in stand-in's (handoff review S2) and goes with real sign-in.

## How the BFF calls a service

- **A server action** runs on the kit ([actions/kit.ts](../actions/kit.ts)) with `call` instead of `authorize` and
  `transaction`: the kit reads the context, parses the input with zod, calls the service, and runs `after`
  (`revalidatePath`, `refresh`, `redirect`) when it answered `ok`. `setSunset` in [actions/review.ts](../actions/review.ts):

  ```ts
  return serverAction(input, {
    input: SunsetInput,
    call: (ctx, { templateId, versionNumber, sunsetAt }) =>
      services().review.setSunset(ctx, {
        templateId,
        versionNumber,
        sunsetDay: sunsetAt,
      }),
    after: ({ changed }) => {
      if (changed) refreshAfter();
    },
  }).then(withoutChanged);
  ```

- **A read model** (a page's data) reads `requireRequestContext()`, asks the service for facts, and words and lays
  them out: labels, sentences, people, grouping. It decides nothing. `getVersions` in
  [queries/versions.ts](../queries/versions.ts) over `VersionService.history`.
- **A GET route** (a read a screen makes on demand) reads `requestContextOrRefusal()`, calls the service's read, and
  answers its `ReadResult` with `readResponse()` ([api/reads.ts](../api/reads.ts)).
- **Autosave** reads the body and prepares the documents in the route, then calls `DraftService.save`.

A refusal crosses the seam as `{ ok: false, code, reason }`. The code is the contract
([decision 0025](../../../docs/decisions/0025-refusals-carry-stable-codes.md)); the reason is the BFF's sentence,
which the HTTP implementation will word from the code (and the facts the Java API sends with it).

## The local implementation

Today's Drizzle code, moved behind the interfaces, calling `src/domain` for every decision. A command runs on
`runCommand` ([local/command.ts](local/command.ts)): `authorize` reads what the input names outside a transaction and
checks the permission; `transaction` re-reads, asks the domain transition, writes with a compare-and-set, and writes
the effects through [effects.ts](../effects.ts), all in one `inTransaction`. It dates everything by the context's
`now`.

Only the local implementation, [db/](../db/) and the seed import Drizzle or the database client. A lint rule
(`@typescript-eslint/no-restricted-imports` in [eslint.config.mjs](../../../eslint.config.mjs)) warns everywhere
else; its warnings are the list of what hasn't moved yet. Schema row types may be imported as types.

`/api/v1` is the backend's own API, not the BFF's: after the port the Java API serves it to consumers directly. Its
route handlers are the local implementation's HTTP surface and will call the local implementation directly.

## The fake

[fake/](fake/) implements the same interfaces over arrays, running the same domain rules
([decision 0068](../../../docs/decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)). Its data is
the seed, built in memory in the order `seedDatabase` builds it, so the template ids and everything else match the
database's. A command runs synchronously inside `FakeStore.command`: JavaScript runs it to the end before another
starts, and a refusal (or a bug) undoes its writes. Read and write through the `FakeTx` it hands you.

BFF tests run on it ([fake/testing.ts](fake/testing.ts)):

```ts
vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock("@/server/context/request", () => import("@/server/services/fake/testing"));
const backend = fakeBackendPerTest({ base: BASE }); // a copy of the seeded fake for every test
backend.as("alex"); // the request context from here on
expect(await setSunset({ … })).toEqual({ ok: true });
```

See [actions/review.fake.test.ts](../actions/review.fake.test.ts) and [queries/versions.test.ts](../queries/versions.test.ts).
A BFF test checks what the BFF adds: the parse, the answer's shape, what refreshes, the wording and the layout. What
the service decides belongs to the contract suite.

## The contract suite

One set of behavioural cases per area ([contract/](contract/)), written against the interfaces and run against every
implementation: the fake and the local one today, the Java API (through the HTTP implementation, against a test
environment) later. A case starts from the seed, acts only through the services, travels in time by asking for a
context at a later instant (`harness.as(userId, at)`; the Java API's test-only clock offset), and reads what a command
wrote that no read serves yet (audit rows, consumer notices, notifications) through the probe. It covers what
implementations get wrong: the refusal codes and their order, a double click at the same moment, notices numbered in
commit order, and every decided `can`. [contract/agreement.test.ts](contract/agreement.test.ts) compares the fake's and
the local implementation's reads of the whole seeded world, field for field.

To add a case, add it to the area's cases file; both runners pick it up. To run the suite against another
implementation, give it a `ContractHarness` ([contract/harness.ts](contract/harness.ts)).

## Moving an area behind the seam

1. Type its interface (already done for every area) and settle its read results as facts: ids, ISO instants, days,
   codes, decided `PermissionResult`s, `Person` lists. No English but a refusal's reason; the BFF words the rest.
2. Move its Drizzle code into `local/<area>.ts`, with the command steps on `runCommand` and the decisions from
   `src/domain`. A rule still written in the server code moves into `src/domain` first.
3. Write `fake/<area>.ts` over the fake's state, with the same steps and the same domain calls.
4. Port its tests: what the service decides into `contract/<area>.ts` (run by `contract/<area>.test.ts`), what the
   BFF adds into a test on the fake beside the action or read model.
5. Point the action (`call`), the read model or the route at `services()`, delete the old code, and replace the area's
   `notMoved`/`notMovedArea` entries in `local/index.ts` and `fake/index.ts`.

| Area                                                                                                      | Behind the seam      |
| --------------------------------------------------------------------------------------------------------- | -------------------- |
| review                                                                                                    | `setSunset`          |
| versions                                                                                                  | `history`            |
| identity, clock, templates, drafts, comments, access, platform, notifications, audit, usage, render, demo | not yet (typed only) |
