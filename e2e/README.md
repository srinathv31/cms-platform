# `e2e`: Playwright against the production build

The end-to-end suite drives the real app in Chrome. It runs against `next start`, not the dev server, so it sees what
a deployment would, including the Cache Components rules a dev server only warns about. Every worker gets its own
server, database and uploads folder, so spec files run side by side and never touch the demo's data.

Contents: [Run it](#run-it) · [How a run is built](#how-a-run-is-built) · [What lives where](#what-lives-where) ·
[How a spec is written](#how-a-spec-is-written) · [Reading and changing data](#reading-and-changing-data) ·
[The opt-in projects](#the-opt-in-projects) · [Rules](#rules)

## Run it

```bash
npm run build            # the specs run against .next; rebuild after a change to anything the app renders
npm run e2e              # all specs, 4 workers
E2E_WORKERS=1 npx playwright test e2e/variable-rename.spec.ts   # one spec, one server
npx playwright test --ui                                          # Playwright's inspector
```

`E2E_WORKERS=1` is also how you run a single spec: with more workers Playwright starts that many servers even for one
file. A failed test keeps its trace (`trace: "retain-on-failure"`); open it with `npx playwright show-trace`.

To run against a server you started yourself (a dev server on 3000, say), set `E2E_PORT=3000`: the run then has one
worker, starts nothing, and uses whatever database that server has, so start it with the `DATABASE_URL` and
`UPLOADS_DIR` of a worker (`data/e2e-0.db`, `data/e2e-uploads-0`) and never with the demo's. The root
[README](../README.md#windows) lists the same settings for PowerShell.

## How a run is built

[playwright.config.ts](../playwright.config.ts) starts one server per worker. Worker _n_ gets:

| What       | Value                                            |
| ---------- | ------------------------------------------------ |
| Port       | `E2E_GATE_PORT + n` (3100 + _n_ by default)      |
| Database   | `data/e2e-<n>.db`, reset with `npm run db:reset` |
| Uploads    | `data/e2e-uploads-<n>`                           |
| Demo tools | On (`DEMO_MODE=1`): the specs use the Demo pill  |
| Slot       | Playwright's `TEST_PARALLEL_INDEX`               |

[storage.ts](storage.ts) turns the worker index into those names, and everything that opens the database or the uploads
folder reads them from it, so a worker's server and its specs always see the same files. The config also reads
`E2E_WORKERS` (`--workers` wins), and falls back to one worker when the data can't be split: `E2E_PORT`,
`E2E_DATABASE_URL`, `E2E_UPLOADS_DIR`, or an opt-in project.

Spec _files_ spread across the workers; the tests _inside_ one file run in order, one after another
(`fullyParallel` is off), because most files are a story whose tests build on each other. Two consequences: a file may
change the database for its own later tests, and it must put back whatever other files expect (see
[Reading and changing data](#reading-and-changing-data)). The run takes as long as its longest file plus an even share
of the rest, so the config reports files over a minute; keep a new file short or split it.
[Decision 0050](../docs/decisions/0050-each-e2e-worker-gets-its-own-server-and-database.md) records the design.

## What lives where

| Path                                | What it holds                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `*.spec.ts` at the top              | Browser specs. The `scenario-NN` files follow the demo script's scenarios; `alerts`, `coral-alerts` and `review-rounds` follow a feature end to end; the rest each pin one behavior a bug once broke.  |
| `principles-*.spec.ts`              | The UI rules, checked on every route as each persona that can see it. [helpers/principles.ts](helpers/principles.ts) lists the five checks (one primary button, status words, placeholders, axe, CLS). |
| `reflow*.spec.ts`                   | Reflow at 320px wide, for the screens and dialogs ([decision 0045](../docs/decisions/0045-stencil-targets-desktop-chrome-and-reflows-for-zoom.md)).                                                    |
| `api/`                              | HTTP specs with no browser: the consumer API, Stencil's preview route and the import route, called as a client would.                                                                                  |
| [helpers/](helpers/)                | What specs share. See below.                                                                                                                                                                           |
| [helpers/state/](helpers/state/)    | The only code that reads or writes the database. Its [README](helpers/state/README.md) lists what it offers.                                                                                           |
| [storage.ts](storage.ts)            | Per-worker ports, database and uploads names.                                                                                                                                                          |
| [media/](media/)                    | Pacing, the cursor and the stills for the opt-in recording projects.                                                                                                                                   |
| [fixtures/import/](fixtures/import) | The files the import specs upload, generated by `make-fixtures.mjs`.                                                                                                                                   |
| `perf/`, `qa/`                      | Standalone scripts (typing latency, screenshots, a prefetch probe), not part of `npm run e2e`.                                                                                                         |

The helpers, by use:

- [helpers/scenario.ts](helpers/scenario.ts): the `test` every browser spec imports (see below), `asPersona`,
  `tap`, `hydrated`, and the editor readers (`liveEditor`, `chip`, `panelRow`, `expectAutosaved`).
- [helpers/golive.ts](helpers/golive.ts) and [helpers/access.ts](helpers/access.ts): the going-live and access flows,
  Coral's pieces, the persona switcher and the settings dialog.
- [helpers/review.ts](helpers/review.ts): the review screen's Preview, which an approver pages through before Approve
  is enabled.
- [helpers/settled.ts](helpers/settled.ts): `settled(page)` waits until fonts, animations and layout have stopped,
  for checks that read sizes or colors. It replaces fixed sleeps.

## How a spec is written

A browser spec imports `test` and `expect` from [helpers/scenario.ts](helpers/scenario.ts), not from Playwright. That
`test` carries an automatic fixture that fails the test on any `console.error` or uncaught page error, so a spec
can't pass over a hydration warning. A typical story:

1. A `Changes` object ([helpers/state/changes.ts](helpers/state/changes.ts)) in `beforeAll` arranges data and
   remembers how to undo it; `afterAll` calls `changes.undo()`.
2. `asPersona(page, "maya")` sets the persona cookie (`ucomp_persona`), the stand-in for sign-in, then `page.goto`
   with a relative URL; the worker's `baseURL` points at its server.
3. `hydrated(page)` waits until React has attached its handlers before the first click.
4. The steps run as `test.step` blocks, driving the page by accessible name (`getByRole`) and by the `data-slot` and
   `data-status` attributes the components carry. Those attributes are the selector contract: grep `e2e/` before you
   rename one.
5. Facts the screen can't give (a stored row, the audit trail, a notice in the outbox) come from a named function in
   [helpers/state](helpers/state/README.md), such as `findVersion` or `auditEvents`.

[variable-rename.spec.ts](variable-rename.spec.ts) is a short complete example. An `api/` spec has no page, so it uses
Playwright's own `test` and builds a request context with the persona cookie through `asPersona` in
[api/helpers.ts](api/helpers.ts).

## Reading and changing data

A spec never opens the database. It imports named functions from `e2e/helpers/state` (its `index.ts`, not the modules
behind it), which return records in camelCase with JSON parsed. ESLint enforces it: `@libsql/client`, Drizzle and
`@/server/db` are importable only from `helpers/state/db.ts`. Today those functions are SQL on the worker's SQLite
file; when the Java API owns the data they go through a test endpoint, and no spec changes
([decision 0068](../docs/decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)). So assert through
the screen or `/api/v1` wherever either can show the fact, and use the helper only for what only the backend knows.

A worker's database is shared by every file it runs, so a spec that moves the demo clock, changes a chain, or makes a
template puts it back. `Changes` records each change and undoes them newest first. A spec that re-seeds with
`resetDemoData` needs none. Specs name seeded data by name or by the ids the seed spells out
([decision 0069](../docs/decisions/0069-seed-ids-are-literal-and-the-seed-exports-a-fixture.md)).

## The opt-in projects

`npm run e2e` runs the `chromium` project only. Two more exist and appear only when named on the command line:

- `demo`: plays the scenario specs paced for a recording (1440 by 900, a visible cursor, pauses), and the whole demo
  script, [demo-script.spec.ts](demo-script.spec.ts), which `chromium` ignores
  ([decision 0049](../docs/decisions/0049-the-demo-script-runs-only-in-the-demo-project.md)). Run it with
  `npx playwright test --project=demo`.
- `stills-1280`: the same specs at 1280 by 800, taking the stills at full speed.

`npm run gate:media` runs both and collects the video and stills ([media/collect.mjs](media/collect.mjs)); it calls
`ffmpeg`, by default Homebrew's at `/opt/homebrew/bin/ffmpeg` (`FFMPEG` names another). Both projects use one worker, because the scenario specs build on
each other's data in order.

## Rules

- Import `test` from `helpers/scenario`, and database access only from `helpers/state`.
- A spec leaves the database as it found it, or re-seeds.
- Select by role and name, then by `data-slot` or `data-status`; never by a class or a position.
- Wait for the thing you need (a web-first `expect`, `hydrated`, `settled`), not for a time.
- A new spec file is one story with a header comment that says what it proves and which finding or decision it guards.
