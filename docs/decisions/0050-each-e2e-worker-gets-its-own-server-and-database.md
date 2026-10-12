# 0050. Each e2e worker gets its own server and database

Status: Accepted
Date: 2026-10-11

## Context

The whole suite (379 tests) ran one test at a time, about 11 minutes, because every spec file shared one Next server
and one database (`workers: 1`). Several specs change data that the specs after them expect untouched: they advance
the demo clock, change the approval chain, or create templates, and put it back in `afterAll` (`resetDemoData()`,
`removeTemplate()`). Running two files at once on one database would let one file's clock advance or half-built
template show up in another's assertions.

## Decision

- **`E2E_WORKERS` sets the worker count, 4 by default.** `--workers` on the command line wins. Spec files spread
  across the workers; the tests inside one file keep running in order (`fullyParallel` stays off), because most
  files are a story whose tests build on each other.
- **One `next start` per worker, all on the one `.next` build.** `playwright.config.ts` gives `webServer` one entry
  per worker. Entry `n` runs `npm run db:reset && npx next start -p <E2E_GATE_PORT + n>` with
  `DATABASE_URL=file:data/e2e-n.db` and `UPLOADS_DIR=data/e2e-uploads-n`.
- **A worker finds its own server by its index.** Playwright sets `TEST_PARALLEL_INDEX` in each worker process
  before it loads the config, and a worker that Playwright restarts after a failure keeps its index.
  `e2e/storage.ts` turns the index into the port, database URL and uploads folder; the config (loaded again in
  every worker) sets `use.baseURL` from it, so specs keep using relative URLs and `test.info().project.use.baseURL`.
  `E2E_DATABASE_URL` and `E2E_UPLOADS_DIR` are still exported from `e2e/storage.ts` and are now the current
  worker's, so `openDb()`, `resetDemoData()` and the cleanup helpers needed no change. No spec changed.
- **One worker, one server when the data cannot be split:** `E2E_PORT` (a server you started yourself), an
  explicit `E2E_DATABASE_URL` or `E2E_UPLOADS_DIR`, and the opt-in `demo` and `stills-1280` projects (the scenario
  specs build on each other's data in one order). `E2E_WORKERS=1` is the same mode on purpose.

## Alternatives considered

- **One server, a database per request.** The server would pick a database from a header or cookie the worker
  sends. That changes app code (the database client, the clock, the uploads folder, the simulator's own handle on
  the file) to serve a test setup, and the app runs unlike production while it is tested. Rejected: the prototype's
  server and database are one process and one file, and we test it as it is.
- **A database per spec file, with one shared server.** The server reads one `DATABASE_URL` for its lifetime.
- **`fullyParallel`.** Tests in one file depend on each other's data, and the specs that reset in `afterAll` would
  reset under the tests of their own file.
- **Retries to cover collisions.** A spec that fails only in parallel shares something it should not; the fix is in
  the spec or its helper.

## Consequences

- **Time:** on a 12-core machine, the 379 tests took 11.0 minutes with `E2E_WORKERS=1` and 4.3 minutes at 4
  workers, then 3.0 minutes at 4 workers (twice) once `principles.spec.ts` (2.7 minutes on its own) was split into
  five `principles-*.spec.ts` files of under a minute each. The longest file is now `phase-1.spec.ts` (1.1 minutes).
  The config prints files over a minute
  (`reportSlowTests`); a file that grows past a quarter of the run is worth splitting, as more workers don't help it.
- **Cost:** each worker is one more Node server (`next start`, 250 to 570 MB resident during a run, plus about 90 MB for the `npm exec` that wraps it)
  and one more Chromium, plus one more `db:reset` before the run starts. Four workers need about 3 GB and four
  busy cores; on a machine shared with other work, set `E2E_WORKERS=2`. Playwright starts the servers one after
  another before the first test, a few seconds each.
- Starting the servers takes the same time for one spec file as for the whole suite: use `E2E_WORKERS=1` or
  `--workers=1` to start one.
- `data/e2e.db` and `data/e2e-uploads` (the single-worker names before this) are no longer used. `data/` is
  git-ignored; delete them by hand.
- `E2E_GATE_PORT` is the first port of a range: a run with N workers uses `E2E_GATE_PORT` to `E2E_GATE_PORT + N - 1`.
  Tracks that run side by side keep ports at least 10 apart.
- A spec cannot rely on another file having run before it, or on another file not running at the same time. The
  clock and every other piece of state are in the worker's own database, so nothing outside it is shared except
  files the specs write themselves under `test-results/`.
