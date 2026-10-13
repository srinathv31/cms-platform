# `src/server/services`: the backend seam

The service interfaces are everything the BFF (the server actions, the read models, the route handlers) asks the
backend: one interface per area, each method taking the request context first and answering an `ActionResult` (a
command) or a `ReadResult` (a read). Behind them, the backend holds the data, reads its own clock, and runs the rules
and the permission checks ([decision 0070](../../../docs/decisions/0070-rules-and-permission-checks-sit-behind-the-service-interfaces.md)).
Today the backend is this app's own code over SQLite, the **local implementation**; after the port it is the Java
API, reached through an HTTP implementation of the same interfaces. The BFF's own surface (the actions, the GET routes,
autosave, the read models' shapes) doesn't change when the backend does. Rendering already works this way
([render/engine.ts](../render/engine.ts)). [Decision 0072](../../../docs/decisions/0072-the-bff-reaches-its-backend-through-service-interfaces.md)
records the seam and the alternatives turned down.

```text
 browser ──► server action ─┐
           GET route ───────┤  BFF: parse (zod), word, lay out, refresh. Reads ONE request context:
           page (RSC) ──────┘  the viewer, a correlation id, a credential slot. No clock.
                 │  services().<area>.<method>(ctx, input)  →  facts (+ asOf), decided can, codes
                 ▼
          ┌─ interfaces (this folder) ─┐
          ▼              ▼              ▼
     local/ (today)   fake/ (tests)   http/ (later: the Java API, types generated from its OpenAPI spec)
     Drizzle + domain  arrays + domain
     its own clock     a test's clock
```

## Layout

| Path                                                                                                                                                                                                                                                                                                                                               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [types.ts](types.ts)                                                                                                                                                                                                                                                                                                                               | `Services`, one property per area, and the shapes every method shares (`ActionResult`, `ReadResult`, `Changed`, `Unsettled`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [results.ts](results.ts)                                                                                                                                                                                                                                                                                                                           | `ReadResult`, `ReadRefusal` (400/401/403/404/409) and `refusal()`: a read's answer. [api/reads.ts](../api/reads.ts) turns one into a route's response.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [options.ts](options.ts)                                                                                                                                                                                                                                                                                                                           | What an implementation is built with: its `Clock`, and `TestHooks` only tests set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [index.ts](index.ts)                                                                                                                                                                                                                                                                                                                               | `services()`: the implementation `STENCIL_BACKEND` names ([config.ts](../config.ts)), built once. The only way the BFF reaches the backend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [review.ts](review.ts), [versions.ts](versions.ts), [templates.ts](templates.ts), [drafts.ts](drafts.ts), [comments.ts](comments.ts), [access.ts](access.ts), [platform.ts](platform.ts), [notifications.ts](notifications.ts), [audit.ts](audit.ts), [usage.ts](usage.ts), [render.ts](render.ts), [identity.ts](identity.ts), [demo.ts](demo.ts) | One interface per area: what each method promises, its input, its answer, and its refusals in order. A result whose facts aren't settled yet is `Unsettled<"P4a: …">`, naming the package that settles it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [refuse.ts](refuse.ts)                                                                                                                                                                                                                                                                                                                             | `refuse`, `check`, `permit`, `RefusalError`, `answerFor`: how an implementation stops a command with a refusal and undoes its writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [not-moved.ts](not-moved.ts)                                                                                                                                                                                                                                                                                                                       | `notMoved`, `notMovedArea`: what a method answers while its area still runs outside the seam (it throws; nothing calls it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [local/](local/)                                                                                                                                                                                                                                                                                                                                   | The local implementation: [command.ts](local/command.ts) (`runCommand`, the command kit), [transaction.ts](local/transaction.ts) (`inTransaction`, the one write transaction), the effects writers ([effects.ts](local/effects.ts) for lifecycle transitions, [access-effects.ts](local/access-effects.ts) for access and platform changes: audit rows, notifications stored as facts and a link by team id, consumer notices), one file per area ([access.ts](local/access.ts), [demo.ts](local/demo.ts), [identity.ts](local/identity.ts), [notifications.ts](local/notifications.ts), [platform.ts](local/platform.ts), [review.ts](local/review.ts), [versions.ts](local/versions.ts)), the scheduled jobs ([sweeps.ts](local/sweeps.ts): `runScheduledJobs`, the access and sunset sweeps, which the demo and, as a lazy trigger, the access commands run), [index.ts](local/index.ts) (`localServices`), and [contract-harness.ts](local/contract-harness.ts) for the contract suite. The loaders the areas share: [access-facts.ts](local/access-facts.ts) (memberships, recertifications and requests as the access rules take them), [chain.ts](local/chain.ts) (a content type's chain, family and message rules; the decisions on versions), [consumer-usage.ts](local/consumer-usage.ts), [find-round.ts](local/find-round.ts) (a version by number and round, or its number's head), [template-name.ts](local/template-name.ts) (`currentName`) and [business-zone.ts](local/business-zone.ts); BFF code that hasn't moved still imports some of them, on the ratchet. The version reads and compare-and-set the review commands share are in [version-rows.ts](../version-rows.ts) until the last legacy review action moves (plan P1). |
| [fake/](fake/)                                                                                                                                                                                                                                                                                                                                     | The in-memory fake: [state.ts](fake/state.ts) (the tables, loaded from the seed's fixture), [store.ts](fake/store.ts) (a command's writes and their undo), the lookups each area shares ([version-rows.ts](fake/version-rows.ts), with the compare-and-set; [settings.ts](fake/settings.ts)), [effects.ts](fake/effects.ts) and [access-effects.ts](fake/access-effects.ts) (the effects writers' twins, held to the local ones by [effects.test.ts](fake/effects.test.ts)), [sweeps.ts](fake/sweeps.ts) (both scheduled jobs), [consumer-api.ts](fake/consumer-api.ts) (the notices `/api/v1` serves), one file per area ([access.ts](fake/access.ts) with the access facts and `fakeCommand`, the fake's command kit; [platform.ts](fake/platform.ts); [demo.ts](fake/demo.ts); …), [index.ts](fake/index.ts), and the test support: [testing.ts](fake/testing.ts) for BFF command tests, [contract-harness.ts](fake/contract-harness.ts) for the contract suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [contract/](contract/)                                                                                                                                                                                                                                                                                                                             | The contract suite: [harness.ts](contract/harness.ts) (what an implementation provides to run it), the cases per area ([access.ts](contract/access.ts), [demo.ts](contract/demo.ts), [identity.ts](contract/identity.ts), [notifications.ts](contract/notifications.ts), [platform.ts](contract/platform.ts), [review.ts](contract/review.ts), [sweeps.ts](contract/sweeps.ts) for the scheduled jobs, [versions.ts](contract/versions.ts)), their runners (`*.test.ts`), and [agreement.test.ts](contract/agreement.test.ts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The request context the methods take is [src/server/context/request.ts](../context/request.ts).

## The request context

`findRequestContext()` reads, once per request, who is asking (the viewer: the sign-in stand-in in
[viewer.ts](../viewer.ts) reads the persona cookie and asks `identity.viewer` whom it names), a correlation id, and a
credential slot an HTTP implementation will fill with the user's token for the Java API (the sign-in work decides
how). It is the one reader of the persona cookie: a service never
reads a cookie or the viewer itself. A server action or a route reads it once at its top and passes it down (outside a
render, React's `cache` doesn't memoize).

It carries **no time**. The backend dates its own writes by its own clock, and a read that decides anything by time
(a sunset passed, renders in the last 30 days, today in the business zone, `can`) answers the instant it decided at,
`asOf`, which the BFF words its dates from.

It **fails closed**: with no viewer there is no context. An action answers `signed_out`, a read route 401, a page goes to
the sign-in hook (`signInRequired()` in [context/sign-in.ts](../context/sign-in.ts), the one place real sign-in plugs
in). With `DEMO_MODE` off, a missing or unknown persona cookie is signed out; only the demo falls back to Maya.

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
  them out with a pure function (labels, sentences, people, grouping); it decides nothing. `getVersions` in
  [queries/versions.ts](../queries/versions.ts) over `VersionService.history`, shaped by `versionsData(history)`.
  Call services from a `cache`d read model with primitive arguments, so one render asks once.
- **A GET route** (a read a screen makes on demand) reads `requestContextOrRefusal()` (401 without a viewer), calls
  the service's read, and answers its `ReadResult` with `readResponse()` ([api/reads.ts](../api/reads.ts)).
- **Autosave** reads the body and prepares the documents in the route, then calls `DraftService.save`. **New template
  and Import** build and prepare the draft in the BFF (the starters, the importer) and hand it to `templates.create`
  or `templates.createImported`: the backend stores documents, it doesn't build them.

A refusal crosses the seam as `{ ok: false, code, reason }`. The code is the contract
([decision 0025](../../../docs/decisions/0025-refusals-carry-stable-codes.md)); the reason is the BFF's sentence,
which the HTTP implementation will word from the code (and the facts the Java API sends with it).

## The rules

- **Facts only across the seam**: ids, ISO instants, `YYYY-MM-DD` days, codes, decided `PermissionResult`s, `Person`
  lists for the ids a screen names. No English but a refusal's reason, no app URLs. Lint forbids the interface files
  from importing the BFF's view models and modules (`@/server/queries`, `@/domain/{golive,import}-types`, …).
- **Teams by id.** A URL names a team by its slug; `identity.space` resolves it to the team's id once, at the edge,
  and every service, check and query below takes the id (decision 0053). A team's id is never its slug (the seed's are
  `t_coral`, `t_deposits`, `t_cards`), so a swap fails a test.
- **Four lint rules hold the seam**, each an error everywhere but in its own exemptions, with a ratchet in
  [eslint.config.mjs](../../../eslint.config.mjs) listing the files still waiting for their package, where it only
  warns. Delete a file's line when you clear it; integration empties all four.

  | Rule                                | Only these may                                                                                                                                                            | Ratchet             |
  | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
  | the database, and an implementation | talk to the database: the local implementation, `src/server/db`, the seed; import `services/local` or `fake`: [index.ts](index.ts), `/api/v1`, the seed, the reset, tests | `SEAM_NOT_YET`      |
  | `seam/no-clock`                     | read the clock (`@/server/clock`, `queries/dynamic`): the backend (the local implementation, `/api/v1`, the reset, the seed) and tests                                    | `CLOCK_NOT_YET`     |
  | `seam/no-decisions`                 | decide (`can`, `canSeeSpace` and the space rules, `requireCan`, the kit's `check`/`permit`): `src/domain`, `services/local`, `services/fake`, [refuse.ts](refuse.ts)      | `DECIDES_NOT_YET`   |
  | `seam/no-backend-internals`         | import the reset, the seed or `src/server/testing`: the backend's own code, the fake, the contract suite and tests                                                        | `INTERNALS_NOT_YET` |

- **A rule both implementations need lives in `src/domain`.** An `if` that would appear in both `local/` and `fake/`
  belongs in the domain first (`sunsetUnchanged`, `notificationRecipients`, `versionActions`).
- **Every compare-and-set has a contract case** through `TestHooks.beforeCompareAndSet`, and a lost one is
  `version_changed`.

`/api/v1` is the backend's own API, not the BFF's: after the port the Java API serves it to consumers directly. Its
route handlers are the local implementation's HTTP surface and may call the local implementation directly.

## The local implementation

Today's Drizzle code, moved behind the interfaces, calling `src/domain` for every decision. `localServices({ clock,
hooks })` builds it; `services()` builds it with the demo clock ([clock.ts](../clock.ts)) and no hooks. A command runs
on `runCommand` ([local/command.ts](local/command.ts)): `authorize` reads what the input names outside a transaction
and checks the permission; then the clock, once; then `transaction` re-reads, asks the domain, writes with a
compare-and-set, and writes the effects through [local/effects.ts](local/effects.ts), all in one `inTransaction`
([local/transaction.ts](local/transaction.ts)).

## The fake

[fake/](fake/) implements the same interfaces over arrays, running the same domain rules
([decision 0068](../../../docs/decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)). Its data is
the seed's fixture, the file the Java side's loader reads ([seed/README.md](../seed/README.md#the-fixture)), built at
the test's base instant and loaded with `loadFixture`: every id, row and column default matches the database's, and
the agreement test checks the fixture as it checks the fake. A command reads the clock, then runs synchronously inside
`FakeStore.command`: JavaScript runs it to the
end before another starts, and a refusal (or a bug) undoes its writes. Read and write through the `FakeTx` it hands you.

It stays **slim**: every command is implemented in full, and a read only where a contract case must observe a command.
That is the price of BFF tests without a database, and a cost the Node team keeps as the backend changes (decision
0072 says so); the contract suite keeps it honest.

BFF tests of commands run on it ([fake/testing.ts](fake/testing.ts)):

```ts
vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock("@/server/context/request", () => import("@/server/services/fake/testing"));
const backend = fakeBackendPerTest({ base: BASE }); // a copy of the seeded fake for every test, clock at BASE
backend.as("alex"); // who is asking from here on
expect(await setSunset({ … })).toEqual({ ok: true });
```

See [actions/review.fake.test.ts](../actions/review.fake.test.ts). A read model's tests hand facts straight to its
shaping function ([queries/versions.test.ts](../queries/versions.test.ts)). Either checks only what the BFF adds: the
parse, the answer's shape, what refreshes, the wording and the layout. What the service decides belongs to the
contract suite.

## The contract suite

One set of behavioural cases per area ([contract/](contract/)), written against the interfaces and run against every
implementation: the fake and the local one today, the Java API (through the HTTP implementation, against a test
environment) later. A case starts from the seed, sets the backend's clock to an exact instant (`setClock`; Java's
test clock must allow it, decision 0068), acts only through the services, and compares what the reads show before and
after: never finds a write by its instant. It reads consumer notices through `/api/v1`, and what no read serves yet
(audit rows) through the probe, which answers facts and goes when `audit.activity` moves. Test hooks reach
what a serializing database never shows: `hooks({ beforeCompareAndSet })` commits a competing write between a command's
read and its write, and `runScheduledJobs(at)` runs the backend's scheduled jobs (the access sweep, then the sunset
sweep) at an instant. Refusals are compared by code; the sentence is the BFF's.
[contract/agreement.test.ts](contract/agreement.test.ts) compares the fake's and the local implementation's reads of
the whole seed, field for field: every template's history, and who everyone is and every space they may enter.

To add a case, add it to the area's cases file; its runner runs it against both. One local harness per test file. A
case that names a seeded row other than a template or a team (a membership, a review, a request) reads its id from the
fixture every implementation loads (`seededAccess()` in [contract/access.ts](contract/access.ts)), never from an
implementation. Where an area's own reads haven't moved, a case observes its commands through the reads that have:
who someone is (`identity.viewer`, their memberships), the bell (`notifications.list`), and a command answering
`changed: false` for a setting saved as it is.

The local implementation's access commands run the scheduled jobs before they act (a lazy trigger the Java API won't
have), so a case that moves the clock past a deadline runs the jobs itself (`runScheduledJobs`) before an access
command, and the two implementations then agree.

**The Java run is serial.** The Java API's contract run shares one test environment: one test clock, and one
database loaded from the seed's fixture at the run's base instant. Its cases run one after another, each from the
fixture as loaded (a test endpoint reloads it), so write no case that depends on running beside another or on
isolation the fake and SQLite happen to give. The fixture's render history is one realization of its own reset
moment (its times keep their distance from the reset, not their weekday), so a case doesn't assert counts of the
seeded history; it compares before and after.

## Moving an area behind the seam

1. Settle its interface: replace each `Unsettled<…>` with a facts type beside the interface (ids, ISO instants, days,
   codes, decided `PermissionResult`s, `Person` lists; `asOf` on a read that decides by time).
2. Move a rule the server code still writes into `src/domain` first.
3. Move its Drizzle code into `local/<area>.ts`, commands on `runCommand`, dated by `deps.clock`.
4. Write `fake/<area>.ts`: every command; a read only where a contract case must observe a command.
5. Write the cases in `contract/<area>.ts` (+ runner): the refusal codes in order, a before/after diff of every write,
   one compare-and-set case per guarded table, the scheduled jobs through `runScheduledJobs`.
6. Point the action (`call`), the read model (a pure shaping function over the facts) or the route at `services()`;
   port the BFF's own tests; delete the old code and its database tests; delete the files you cleared from the four
   ratchets; replace the area's `notMoved` entries in `local/index.ts` and `fake/index.ts`.

| Area                                              | Behind the seam                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| identity                                          | `viewer`, `space`, `shell`                                           |
| notifications                                     | `list`, `markRead`, `markAllRead`                                    |
| review                                            | `setSunset`                                                          |
| versions                                          | `history`                                                            |
| access                                            | every command; the scheduled jobs (`runScheduledJobs`)               |
| platform                                          | every command                                                        |
| demo                                              | `reset`, `advanceClock`, `clockReadout`, `personas`, `switchPersona` |
| templates, drafts, comments, audit, usage, render | not yet                                                              |
