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

## How to read a file here

A file's header comment is its contract. In an interface file it says what the area promises and which refusals come in
what order; in a `local/` or `fake/` file, what it implements and what it leaves to others. A `/** */` comment
documents a method or an export: its input, its answer and its refusals in order. A `//` comment records a decision at
the line it applies to. [review.ts](review.ts) shows it: the header says what the area promises, each method's
`/** */` lists the refusals in the order they are checked, and [local/review.ts](local/review.ts) follows that order.

## Layout

| Path                                                                                                                                                                                                                                                                                                                                               | What it holds                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [types.ts](types.ts)                                                                                                                                                                                                                                                                                                                               | `Services`, one property per area, and the shapes every method shares (`ActionResult`, `ReadResult`, `Changed`).                                                                                                  |
| [results.ts](results.ts)                                                                                                                                                                                                                                                                                                                           | `ReadResult`, `ReadRefusal` (400/401/403/404/409) and `refusal()`: a read's answer. [api/reads.ts](../api/reads.ts) turns one into a route's response.                                                            |
| [options.ts](options.ts)                                                                                                                                                                                                                                                                                                                           | What an implementation is built with: its `Clock`, its `IdSource` (the template ids it draws, which a test sets to force a collision), and `TestHooks` only tests set.                                            |
| [index.ts](index.ts)                                                                                                                                                                                                                                                                                                                               | `services()`: the implementation `STENCIL_BACKEND` names ([config.ts](../config.ts)), built once. The only way the BFF reaches the backend.                                                                       |
| [review.ts](review.ts), [versions.ts](versions.ts), [templates.ts](templates.ts), [drafts.ts](drafts.ts), [comments.ts](comments.ts), [access.ts](access.ts), [platform.ts](platform.ts), [notifications.ts](notifications.ts), [audit.ts](audit.ts), [usage.ts](usage.ts), [render.ts](render.ts), [identity.ts](identity.ts), [demo.ts](demo.ts) | One interface per area: what each method promises, its input, its answer, and its refusals in order.                                                                                                              |
| [review-reads.ts](review-reads.ts), [workspace.ts](workspace.ts), [threads.ts](threads.ts), [activity.ts](activity.ts)                                                                                                                                                                                                                             | The facts of the reads with many: the review queue and screen, the workspace header and document, a template's threads, its Activity tab. Their interfaces import them.                                           |
| [refuse.ts](refuse.ts)                                                                                                                                                                                                                                                                                                                             | `refuse`, `check`, `permit`, `RefusalError`, `answerFor`: how an implementation stops a command with a refusal and undoes its writes.                                                                             |
| [template-id.ts](template-id.ts)                                                                                                                                                                                                                                                                                                                   | `withNewTemplateId`, `TemplateIdTaken`: how both implementations make a template (draw an id, insert, write again with another when the insert finds it taken, three attempts in all; decision 0060).             |
| [local/](local/)                                                                                                                                                                                                                                                                                                                                   | The local implementation: Drizzle, the domain's rules, the demo clock, the render pipeline and the scheduled jobs. Its files are listed under [Inside local, fake and contract](#inside-local-fake-and-contract). |
| [fake/](fake/)                                                                                                                                                                                                                                                                                                                                     | The in-memory fake the BFF's tests run on, over the same fixture and the same domain rules.                                                                                                                       |
| [contract/](contract/)                                                                                                                                                                                                                                                                                                                             | The contract suite: one set of behavioural cases per area, run against every implementation.                                                                                                                      |

The request context the methods take is [src/server/context/request.ts](../context/request.ts).

### Inside local, fake and contract

**`local/`**

- The kit: [command.ts](local/command.ts) (`runCommand`), [transaction.ts](local/transaction.ts) (`inTransaction`, the one write transaction), [clock.ts](local/clock.ts) (the demo clock: real time plus the offset Advance clock moves; the one place the system clock is read), and the effects writers, [effects.ts](local/effects.ts) for lifecycle transitions and [access-effects.ts](local/access-effects.ts) for access and platform changes (audit rows, notifications stored as facts and a link by team id, consumer notices).
- An area's commands in one file: [access.ts](local/access.ts), [comments.ts](local/comments.ts), [demo.ts](local/demo.ts), [drafts.ts](local/drafts.ts), [identity.ts](local/identity.ts), [notifications.ts](local/notifications.ts), [platform.ts](local/platform.ts), [render.ts](local/render.ts), [review.ts](local/review.ts), [templates.ts](local/templates.ts), [versions.ts](local/versions.ts). [index.ts](local/index.ts) (`localServices`) joins them.
- Its reads, beside the commands where they are many: the review area's in [review-reads.ts](local/review-reads.ts) and [review-screen.ts](local/review-screen.ts) (the screen in named steps); [workspace.ts](local/workspace.ts), [threads.ts](local/threads.ts), [activity.ts](local/activity.ts); [usage.ts](local/usage.ts); [library.ts](local/library.ts) (the Library and the palette) and [integration.ts](local/integration.ts) (the SHARE panel and Copilot).
- The settings reads: [access-reads.ts](local/access-reads.ts), [platform-reads.ts](local/platform-reads.ts) and [audit.ts](local/audit.ts) (the settings sections and the Audit page), over the users [users.ts](local/users.ts) loads.
- The backend's own: the render pipeline the preview and `/api/v1` run ([render/render-template.ts](local/render/render-template.ts), with the render log, [render/log.ts](local/render/log.ts)), the scheduled jobs ([sweeps.ts](local/sweeps.ts): `runScheduledJobs`, the access and sunset sweeps, which the demo and, as a lazy trigger, the access commands run), the consumer API `/api/v1` serves ([consumer-api.ts](local/consumer-api.ts); no service reads it), and an import's files ([uploads.ts](local/uploads.ts), the local stand-in for blob storage).
- The loaders the areas share: [access-facts.ts](local/access-facts.ts) (memberships, recertifications and requests as the access rules take them), [chain.ts](local/chain.ts) (a content type's chain, family and message rules; the decisions on versions), [consumer-usage.ts](local/consumer-usage.ts), [draft-row.ts](local/draft-row.ts) (a draft's `versions` row) and [find-round.ts](local/find-round.ts) (a version by number and round, or its number's head).
- More loaders: [version-rows.ts](local/version-rows.ts) (the version reads the review commands share, and their compare-and-set, `updateVersion`), [template-name.ts](local/template-name.ts) (`currentName`), [visible-template.ts](local/visible-template.ts) (`findTemplate`, `visibleTemplate`: a read's template and whether the viewer may see it), [people.ts](local/people.ts) (`loadPeople`) and [business-zone.ts](local/business-zone.ts).
- [contract-harness.ts](local/contract-harness.ts) runs the contract suite on it.

**`fake/`**

- The data: [state.ts](fake/state.ts) (the tables, loaded from the seed's fixture) and [store.ts](fake/store.ts) (a command's writes and their undo). [index.ts](fake/index.ts) joins the areas.
- The lookups the areas share: [version-rows.ts](fake/version-rows.ts) (with the compare-and-set), [chain.ts](fake/chain.ts) (a content type's chain and message rules and a version's decisions), [draft-row.ts](fake/draft-row.ts) (a draft's row), [settings.ts](fake/settings.ts) and [people.ts](fake/people.ts).
- The twins of the backend's own parts: [effects.ts](fake/effects.ts) and [access-effects.ts](fake/access-effects.ts) (the effects writers, held to the local ones by [effects.test.ts](fake/effects.test.ts)), [sweeps.ts](fake/sweeps.ts) (both scheduled jobs) and [consumer-api.ts](fake/consumer-api.ts) (the notices `/api/v1` serves).
- One file per area for its commands: [access.ts](fake/access.ts) (with `fakeCommand`, the fake's command kit), [comments.ts](fake/comments.ts), [demo.ts](fake/demo.ts), [drafts.ts](fake/drafts.ts), [identity.ts](fake/identity.ts), [notifications.ts](fake/notifications.ts), [platform.ts](fake/platform.ts), [review.ts](fake/review.ts), [templates.ts](fake/templates.ts) (which keeps an import's files in memory) and [versions.ts](fake/versions.ts).
- The reads a case observes a command through: [activity.ts](fake/activity.ts), [threads.ts](fake/threads.ts), [library.ts](fake/library.ts), [workspace.ts](fake/workspace.ts) and, in [versions.ts](fake/versions.ts), the history and Compare. [not-in-fake.ts](fake/not-in-fake.ts) (`notInFake`) is what every other read answers.
- Test support: [testing.ts](fake/testing.ts) for BFF command tests, [contract-harness.ts](fake/contract-harness.ts) for the contract suite.

**`contract/`**

- [harness.ts](contract/harness.ts) is what an implementation provides to run the suite.
- The cases are one file per area: [access.ts](contract/access.ts), [activity.ts](contract/activity.ts), [approval-chain.ts](contract/approval-chain.ts), [audit.ts](contract/audit.ts), [comments.ts](contract/comments.ts), [demo.ts](contract/demo.ts), [drafts.ts](contract/drafts.ts), [identity.ts](contract/identity.ts), [library.ts](contract/library.ts), [notifications.ts](contract/notifications.ts), [platform.ts](contract/platform.ts).
- And [review.ts](contract/review.ts), [review-reads.ts](contract/review-reads.ts), [settings.ts](contract/settings.ts), [share.ts](contract/share.ts), [sweeps.ts](contract/sweeps.ts) (the scheduled jobs), [templates.ts](contract/templates.ts), [threads.ts](contract/threads.ts), [usage.ts](contract/usage.ts), [versions.ts](contract/versions.ts) and [workspace.ts](contract/workspace.ts).
- Their runners are the `*.test.ts` beside them (a read the fake doesn't serve runs against the local implementation only), and [agreement.test.ts](contract/agreement.test.ts) compares the fake with the local implementation.

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

- **A server action** runs on the kit ([actions/kit.ts](../actions/kit.ts)): it reads the context, parses the input
  with zod, calls the service (`call`), and runs `after` (`revalidatePath`, `refresh`, `redirect` last) when it
  answered `ok`. `setSunset` in [actions/review.ts](../actions/review.ts):

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
  the service's read, and answers its `ReadResult` with `readResponse()` ([api/reads.ts](../api/reads.ts)). One rule
  for every route: nobody signed in is 401; a template, version, upload or team the viewer may not see reads as not
  there (404, decision 0052); 403 only for someone who may see it but not do this.
- **Autosave** asks `DraftService.saveAccess` before it reads the body, reads and parses it, and prepares the
  documents in the route ([drafts/prepare-patch.ts](../drafts/prepare-patch.ts)), then calls `DraftService.save`.
- **New template and Import** build and prepare the draft in the BFF (the starters, the importer) and hand it to
  `templates.create` or `templates.createImported`: the backend stores documents, it doesn't build them. What the BFF
  needs to build one comes from `templates.newTemplateType`: the content type the kind is made on, its sections and
  channels, and the backend's instant (`asOf`) the starter's sample dates are set from, since the BFF reads no clock
  ([decision 0073](../../../docs/decisions/0073-the-bff-builds-a-new-templates-draft-and-the-backend-draws-its-id.md)).
- **Stencil's preview** reads and checks the render request in the route, then asks `RenderService.preview` with the
  request's context under the request's own correlation id (the render log's, and the response's
  `X-Correlation-Id`). Its answer is the render API's (the body, or `{ error: { code, message, details } }`), which
  the route answers as `/api/v1` does. Nobody signed in is 401 `signed_out`, without asking the backend.

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
- **Lint holds the seam** ([eslint.config.mjs](../../../eslint.config.mjs)), each rule an error everywhere but in its
  own exemptions:

  | Rule                                | Only these may                                                                                                                                                            |
  | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | the database, and an implementation | talk to the database: the local implementation, `src/server/db`, the seed; import `services/local` or `fake`: [index.ts](index.ts), `/api/v1`, the seed, the reset, tests |
  | `seam/no-clock`                     | read the clock ([local/clock.ts](local/clock.ts)): the backend (the local implementation, `/api/v1`, the reset, the seed) and tests                                       |
  | `seam/no-decisions`                 | decide (`can`, `canSeeSpace` and the space rules, `check`/`permit`): `src/domain`, `services/local`, `services/fake`, [refuse.ts](refuse.ts)                              |
  | `seam/no-backend-internals`         | import the reset, the seed or `src/server/testing`: the backend's own code, the fake, the contract suite and tests                                                        |
  | the interfaces                      | import no view model or BFF module (`@/server/queries`, `render`, `import`, `starters`, `api`, `@/components`, `@/domain/{golive,import}-types`)                          |

- **A rule both implementations need lives in `src/domain`.** An `if` that would appear in both `local/` and `fake/`
  belongs in the domain first (`sunsetUnchanged`, `notificationRecipients`, `versionActions`).
- **Every compare-and-set has a contract case** through `TestHooks.beforeCompareAndSet`, and a lost one is
  `version_changed`.

`/api/v1` is the backend's own API, not the BFF's: after the port the Java API serves it to consumers directly. Its
route handlers are the local implementation's HTTP surface and may call the local implementation directly: they import its reads from [local/consumer-api.ts](local/consumer-api.ts), with `withDemoDate` (the demo clock in the response's `Date` header).

## The local implementation

Today's Drizzle code behind the interfaces, calling `src/domain` for every decision. `localServices({ clock, hooks,
ids })` builds it; `services()` builds it with the demo clock ([local/clock.ts](local/clock.ts)) and no hooks. A command runs
on `runCommand` ([local/command.ts](local/command.ts)): `authorize` reads what the input names outside a transaction
and checks the permission; then the clock, once; then `transaction` re-reads, asks the domain, writes with a
compare-and-set, and writes the effects through [local/effects.ts](local/effects.ts), all in one `inTransaction`
([local/transaction.ts](local/transaction.ts)).

## The fake

[fake/](fake/) implements the same interfaces over arrays, running the same domain rules
([decision 0068](../../../docs/decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)). Its data is
the seed's fixture, the file the Java side's loader reads ([seed/README.md](../seed/README.md#the-fixture)), built at
the test's base instant and loaded with `loadFixture`: every id, row and column default matches the database's, and
the agreement test checks the fixture as it checks the fake.

A command reads the clock, then runs synchronously inside `FakeStore.command`: JavaScript runs it to the end before
another starts, and a refusal (or a bug) undoes its writes. Read and write through the `FakeTx` it hands you.

It stays **slim**: every command is implemented in full, and a read only where a contract case must observe a command
through it: the version history and Compare (a version's name and content), the workspace's document (a draft as
stored, and an import's original), a template's activity and threads, the bell, the Library and the palette.

Every other read answers `notInFake` ([fake/not-in-fake.ts](fake/not-in-fake.ts)): the review queue and screen, the
workspace header, the base version, the SHARE panel and the Copilot prompt, the settings sections, the Audit page,
Usage, and the preview. That is the price of BFF tests without a database, and a cost the Node team keeps as the
backend changes (decision 0072 says so); the contract suite keeps it honest.

BFF tests of commands run on it ([fake/testing.ts](fake/testing.ts)):

```ts
vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock("@/server/context/request", () => import("@/server/services/fake/testing"));
const backend = fakeBackendPerTest({ base: BASE }); // a copy of the seeded fake for every test, clock at BASE
backend.as("alex"); // who is asking from here on
expect(await setSunset({ … })).toEqual({ ok: true });
```

See [actions/review.test.ts](../actions/review.test.ts). A read model's tests hand facts straight to its
shaping function ([queries/versions.test.ts](../queries/versions.test.ts)). Either checks only what the BFF adds: the
parse, the answer's shape, what refreshes, the wording and the layout. What the service decides belongs to the
contract suite.

## The contract suite

One set of behavioural cases per area ([contract/](contract/)), written against the interfaces and run against every
implementation: the fake and the local one today, the Java API (through the HTTP implementation, against a test
environment) later. A case starts from the seed, sets the backend's clock to an exact instant (`setClock`; Java's
test clock must allow it, decision 0068), acts only through the services, and compares what the reads show before and
after: never finds a write by its instant.

It observes only through what the product reads: a template's audit rows through `audit.activity`, a draft through
the workspace's document and Compare, who wrote a round by who may decide it (maker-checker), threads through
`comments.threads`, notifications through `notifications.list`, and consumer notices through `/api/v1`.

Test hooks reach what a serializing database never shows: `hooks({ beforeCompareAndSet })` commits a competing write
between a command's read and its write, and `runScheduledJobs(at)` runs the backend's scheduled jobs (the access
sweep, then the sunset sweep) at an instant. Refusals are compared by code; the sentence is the BFF's.

[contract/agreement.test.ts](contract/agreement.test.ts) compares the fake's and the local implementation's reads of
the whole seed, field for field: every template's history, activity, threads, workspace document and versions in
Compare, the Library and the palette, who everyone is and every space they may enter, and everyone's notifications.

To add a case, add it to the area's cases file; its runner runs it against both. One local harness per test file. A
case that names a seeded row other than a template or a team (a membership, a review, a request) reads its id from the
fixture every implementation loads (`seededAccess()` in [contract/access.ts](contract/access.ts)), never from an
implementation.

Where an area's own reads are local-only, a case that runs on both implementations observes its commands through
reads the fake serves: who someone is (`identity.viewer`, their memberships), the bell (`notifications.list`), the
history's decisions, and a command answering `changed: false` for a setting saved as it is. The local-only runner adds
the cases that read the settings sections, the Audit page or the review screen.

The local implementation's access commands run the scheduled jobs before they act (a lazy trigger the Java API won't
have), so a case that moves the clock past a deadline runs the jobs itself (`runScheduledJobs`) before an access
command, and the two implementations then agree.
`h.ids(source)` hands the backend the ids it draws for a new template, so a case can force a collision: a taken id is
drawn again, and a third taken one throws (`templates.create` and `createImported`, decision 0060).
A read the fake has no twin of (the settings and audit reads among them) is run against the local implementation only;
give the fake the read when a command's case must observe a change through it.

A case for a read the fake doesn't serve takes a `UsageHarness` and its runner runs the local implementation only: the Usage counts ([contract/usage.ts](contract/usage.ts)), the SHARE panel's facts and the Copilot prompt's ([contract/share.ts](contract/share.ts)). No command changes a render count, so no case needs the fake to answer them; the harness also records renders at exact instants (`h.renders.record`, a test endpoint in the Java run), because a case can't make the render API run at an instant of its choosing. The Library and the palette ([contract/library.ts](contract/library.ts)) run against both: a sunset moves a template up the Library and into Recent.

**The Java run is serial.** The Java API's contract run shares one test environment: one test clock, and one
database loaded from the seed's fixture at the run's base instant. Its cases run one after another, each from the
fixture as loaded (a test endpoint reloads it), so write no case that depends on running beside another or on
isolation the fake and SQLite happen to give. The fixture's render history is one realization of its own reset
moment (its times keep their distance from the reset, not their weekday), so a case doesn't assert counts of the
seeded history; it compares before and after.

## Adding a method

1. Type it in its area's interface: its input, its answer (facts: ids, ISO instants, days, codes, decided
   `PermissionResult`s, `Person` lists; `asOf` on a read that decides by time), and its refusals in order.
2. Put the rule it decides by in `src/domain` first, with its tests.
3. Implement it in `local/<area>.ts`: a command on `runCommand`, dated by `deps.clock`; a read that answers Not found
   for what the viewer may not see.
4. Implement a command in `fake/<area>.ts` too; a read only where a contract case must observe a command through it
   (otherwise `notInFake`).
5. Write its cases in `contract/<area>.ts`: the refusal codes in order, a before/after diff of every write, one
   compare-and-set case per guarded table, the scheduled jobs through `runScheduledJobs`.
6. Call it from the BFF (an action's `call`, a read model with a pure shaping function, or a route) and test what
   the BFF adds: on the fake for an action, on hand-built facts for a read model.
