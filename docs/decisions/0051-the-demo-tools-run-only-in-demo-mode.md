# 0051. The demo tools run only in demo mode, and the reset only on a local file

Status: Accepted
Date: 2026-10-12

## Context

The reset, the clock advance and the persona switcher were public server actions with no check at all
([S1](../handoff-review.md#s1--critical-demo-reset-and-clock-actions-are-public-and-ungated), the one Critical
finding). Anyone who could reach the app could drop every table, move the clock ten years on, or become the Platform
Admin. `resetDemo()` also ran against whatever `DATABASE_URL` named, including a remote `libsql://` database.

The tools themselves go when real sign-in lands, and the owner uses them every day until then: in `npm run dev`, in
`npm run demo` (a production build) and in the e2e suite. What a production deployment cannot carry, even for a day, is
a build where they work.

## Decision

- **One flag, `DEMO_MODE`, off unless it is set.** `src/server/config.ts` reads the environment once, typed and
  validated (`1` or `true` is on, unset, empty, `0` or `false` is off, anything else throws and names the variable),
  and exports `DEMO_MODE`. A production build with no environment set has no demo tools. The module is the one place a
  setting is read; the backend choice joins it. `src/instrumentation.ts` loads it when the server starts, so a bad value
  stops the server at boot (it prints the message and exits with code 1) instead of failing every page at its first
  request.
- **With the flag off, the three actions refuse and their controls are not there.** `resetDemoAction`,
  `advanceClockAction` and `switchPersona` answer `demo_mode_off` (`DEMO_REFUSALS` in `src/domain/demo.ts`, returned as
  an `ActionResult`) before they read their input or touch anything. The Demo pill is not rendered, in the product's
  frame or in Coral's, and the profile menu has no persona switcher (its label reads "profile", not "profile and
  persona"). They are not shown disabled with a reason: they are not a blocked action of the product but a tool that
  doesn't exist in that build.
- **`resetDemo()` refuses a database that isn't a local `file:` URL, flag or no flag** (`reset_needs_local_file`),
  before it drops anything. `npm run db:reset` prints the sentence and exits 1. The action checks the flag, the reset
  checks the database.
- **The flag is read when the server starts, not when the app is built.** One `next build` serves either way, and a
  build made for the demo cannot carry the tools into a deployment. The server actions read it when they run. The Demo
  pill is in the static shell, so it sits in a `<Stream>` with an empty fallback and `await connection()` before it
  reads the flag; otherwise the prerender would bake the build's value into the shell. The profile menu is already
  behind the viewer. The pill is fixed to the corner, so it streaming in shifts nothing.
- **Each workflow turns it on without a step of its own.** `npm run dev`: `.env.development`, committed (an exception
  in `.gitignore`), which only `next dev` reads. `npm run demo`: `cross-env DEMO_MODE=1 next start`. E2E: `DEMO_MODE`
  in `webServer.env` of `playwright.config.ts`, which the demo script project shares. Unit tests: the test mocks
  `@/server/config`, because Vitest loads no `.env` file. A `next start` run by hand needs `DEMO_MODE=1`.

## Alternatives considered

- **Remove the tools now.** The finding's other fix. The owner's demos, the scenario specs and the demo script all use
  them, and they would be rebuilt as a test-only seam. They go with real sign-in, as the backlog says.
- **Check `NODE_ENV`.** `npm run demo` and every e2e server are production builds, so it cannot tell a demo from a
  deployment.
- **Read the flag at build time** (`NEXT_PUBLIC_DEMO_MODE`, or `next build` with the variable set). One build per mode;
  the e2e suite would need a flagged build, and the artifact that is built for the demo is then one command away from
  production. Rejected.
- **On by default, off in production.** A deployment that forgets to set the variable is the failure this prevents.
- **Show the controls disabled, with a reason** (AGENTS.md, UI). That rule is for an action the product has and the
  viewer may not take. A control for a tool that is not part of the product, shown to everyone in production, is the
  problem.
- **Ignore the persona cookie when the flag is off.** It would end the fail-open to Maya for a cookie nothing sets any
  more, but it is the sign-in work's decision ([S2](../handoff-review.md#s2--high-identity-fails-open-to-the-default-persona)),
  and it changes `getViewer()` for every page.

## Consequences

- S1 is partly fixed: nothing in a build with no environment can reset the data, move the clock or change the persona.
  What remains is S2: the `ucomp_persona` cookie still decides who acts, so a cookie set by hand in the browser acts as
  that persona, flag or not. Coral, the two dev labs (`/editor-lab`, `/pdf-lab`, which already answer 404 in a
  production build) and `/api/v1`'s header-only consumer identity are as they were.
- Everything that starts a server without `npm run dev`, `npm run demo` or Playwright has no pill and no switcher
  unless it sets `DEMO_MODE=1`. The QA scripts in `e2e/qa/` say so in their usage line.
- `npm run demo` uses `cross-env`, which the Windows-readiness work adds to `package.json`.
- A database whose clock was advanced keeps its offset when the flag is turned off. Only the reset (a local file) and
  the advance change it, so a deployment's database, never seeded or advanced, has none.
- The demo flag is the first setting in `src/server/config.ts`, which the backend choice extends.
- With the flag off nothing records a sign-in. `switchPersona` is the only writer of `users.last_active_at`, and it
  now refuses, so no one's inactivity clock restarts. About four months after the seed (flag at 90 days, suspension at
  120), the first access action that runs the access sweep suspends every member a Team Admin hasn't kept, the default
  persona's included, and the app falls back to Request access. The persona switch was also one of the sweep's three
  triggers, so a flag-off deployment applies access deadlines and `sunset_passed` notices only when someone runs an
  access action. This is part of why a flag-off deployment still needs real sign-in
  ([S2](../handoff-review.md#s2--high-identity-fails-open-to-the-default-persona)) and a scheduled sweep
  ([S4](../handoff-review.md#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep)): the flag
  closes the demo tools, it doesn't make a deployment.
