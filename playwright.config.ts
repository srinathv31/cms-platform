import { defineConfig, devices } from "@playwright/test";
import { E2E_EXTERNAL_PORT, E2E_SHARED_STORAGE, E2E_SLOT, e2eDatabaseUrl, e2ePort, e2eUploadsDir } from "./e2e/storage";

// Each worker runs against its own production build server (`next start`, after a db:reset), database and
// uploads folder, so spec files run side by side (decision 0050). Worker n listens on E2E_GATE_PORT + n (3100 by
// default; each parallel track sets its own with E2E_GATE_PORT so tracks never share a server) and uses
// `data/e2e-n.db` and `data/e2e-uploads-n`. Tests inside one file still run in order, one after another.

// Gate media: `npm run gate:media` runs the scenario specs in two extra projects. `demo` records the video
// (1440×900, presentation pacing, a cursor); `stills-1280` takes the 1280×800 stills at full speed. Both are
// opt-in: a bare `playwright test` runs `chromium` exactly as before and never runs the scenario specs twice.
// A project exists only when it is named on the command line (`--project=demo`). The workers load this file
// too, so the answer is parked in the environment, which they inherit.
const OPT_IN = ["demo", "stills-1280"];
const named = process.argv.flatMap((arg, i, all) =>
  arg.startsWith("--project=") ? arg.slice("--project=".length).split(",") : arg === "--project" ? (all[i + 1] ?? "").split(",") : [],
);
const requested = process.env.UCOMP_OPT_IN_PROJECTS ?? named.filter((name) => OPT_IN.includes(name)).join(",");
process.env.UCOMP_OPT_IN_PROJECTS = requested;
const wants = (name: string) => requested.split(",").includes(name);

// How many workers, and so servers: `--workers`/`-j` on the command line, else E2E_WORKERS, else 4. One worker when
// the data cannot be split: a server you started yourself (E2E_PORT), a database or uploads folder you named, or an
// opt-in project (the scenario specs build on each other's data in one order).
const fromFlag = process.argv.flatMap((arg, i, all) => {
  const inline = /^(?:--workers=|-j=?)(\d+)$/.exec(arg);
  if (inline) return [Number(inline[1])];
  return (arg === "--workers" || arg === "-j") && /^\d+$/.test(all[i + 1] ?? "") ? [Number(all[i + 1])] : [];
})[0];
const wanted = fromFlag ?? Number(process.env.E2E_WORKERS ?? 4);
if (!Number.isInteger(wanted) || wanted < 1) throw new Error(`E2E_WORKERS must be a whole number of at least 1, got "${process.env.E2E_WORKERS}".`);
const WORKERS = E2E_SHARED_STORAGE || requested !== "" ? 1 : wanted;

// Only the scenario specs and the whole demo script (Phase 7b): `scenario-02a` (the Phase 2 gate in short
// form) is not a gate recording. The demo script is for those two projects alone: `chromium` ignores it, so
// `npm run e2e` never plays it (decision 0049). Run it with `npx playwright test --project=demo`.
const DEMO_SCRIPT = /demo-script\.spec\.ts/;
const SCENARIOS = /(scenario-\d+|demo-script)\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  // Files spread across the workers; the tests inside one file keep their order (they build on each other).
  fullyParallel: false,
  workers: WORKERS,
  // The run is as long as its longest file plus an even share of the rest: name the files over a minute.
  reportSlowTests: { max: 10, threshold: 60_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    // The workers load this file too, after Playwright has set TEST_PARALLEL_INDEX in them, so each one gets its own server.
    baseURL: `http://localhost:${e2ePort(E2E_SLOT)}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: DEMO_SCRIPT, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    ...(wants("demo")
      ? [
          {
            name: "demo",
            testMatch: SCENARIOS,
            // Its own folder, so a run of `chromium` (which clears test-results/) does not take the videos,
            // and this one does not clear the other's output. `e2e/media/collect.mjs` reads it.
            outputDir: "./test-results/demo",
            // The helpers in e2e/media read this (via the demoStage fixture in e2e/helpers/scenario.ts) to switch to
            // presentation pacing: a cursor, pauses, eased mouse moves, and the 1440 stills.
            metadata: { demo: true },
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1440, height: 900 },
              video: { mode: "on" as const, size: { width: 1440, height: 900 } },
              // Playwright's trace injects scripts into the sandboxed preview frames ("Blocked script execution").
              trace: "off" as const,
            },
          },
        ]
      : []),
    ...(wants("stills-1280")
      ? [
          {
            name: "stills-1280",
            testMatch: SCENARIOS,
            outputDir: "./test-results/stills-1280",
            // No pacing, no cursor, no video: the helpers only take the pictures (`shoot`) at this size.
            metadata: { stills: true },
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1280, height: 800 },
              trace: "off" as const,
            },
          },
        ]
      : []),
  ],
  // One server per worker, all on the one `.next` build. Playwright starts only the servers it owns: on any other
  // E2E_PORT (a dev server, e.g. 3000) the server must already be up, because starting resets the database, and
  // a dev server answering 500 mid-edit used to look "not running" and trigger a reset of the shared DB. Each
  // server gets its worker's own database and uploads folder (e2e/storage.ts, which every helper reads too), so a
  // run never touches the demo's data/ucomp.db or data/uploads.
  webServer:
    E2E_EXTERNAL_PORT === undefined
      ? Array.from({ length: WORKERS }, (_, slot) => ({
          name: `stencil-${slot}`,
          command: `npm run db:reset && npx next start -p ${e2ePort(slot)}`,
          url: `http://localhost:${e2ePort(slot)}`,
          env: { DATABASE_URL: e2eDatabaseUrl(slot), UPLOADS_DIR: e2eUploadsDir(slot) },
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }))
      : undefined,
});
