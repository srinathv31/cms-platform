import { defineConfig, devices } from "@playwright/test";

// Scenario specs run serially from a fresh reset against the production build (`npm run demo`).
const PORT = Number(process.env.E2E_PORT ?? 3100);

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

// Only the scenario specs: `scenario-02a` (the Phase 2 gate in short form) is not a gate recording.
const SCENARIOS = /scenario-\d+\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
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
  // Only the gate port (3100, the production build) may be started here, because starting resets the
  // database. On any other E2E_PORT (the shared dev server on 3000) the server must already be up:
  // a dev server answering 500 mid-edit used to look "not running" and trigger a reset of the shared DB.
  webServer:
    PORT === 3100
      ? {
          command: `npm run db:reset && npx next start -p ${PORT}`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }
      : undefined,
});
