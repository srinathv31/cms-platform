# 0049. The whole-demo script runs only in the demo project

Status: Accepted
Date: 2026-10-11

## Context

`e2e/demo-script.spec.ts` plays the demo script as one story on one database state: scenarios 1 to 11 in order,
from a fresh reset. The scenario specs (`scenario-02` to `scenario-10`) already assert each step in detail, so the
script repeated them, ran to 1,300 lines, and failed now and then in the middle of a run ([N20](../handoff-review.md#n20--low-five-e2e-specs-fail-now-and-then-when-runs-share-a-machine)).
A failure there used to leave the database changed for every spec after it ([N2](../handoff-review.md#n2--medium-a-failed-demo-script-run-leaves-its-state-to-the-specs-after-it)).
What it adds is one thing the scenarios don't: that the story holds end to end, and a recording of it for the demo
media (`npm run gate:media`).

The click helpers also paced every click by 90 ms and carried the recording's branches, so every functional test paid
for the recording ([T7](../handoff-review.md#t7--medium-slow-and-brittle-test-habits)).

## Decision

- The script is not part of `npm run e2e`. `chromium` ignores it (`testIgnore` in `playwright.config.ts`); it runs in
  the opt-in `demo` project (`npx playwright test --project=demo`), where it keeps working for recording and for
  checking the story end to end before a demo. It is not deleted and not merged into the scenarios.
- Recording behavior lives in `e2e/media/`, not in the functional helpers. `tap`, `typeSlowly` and `dragRowTo` click,
  type and drag at test speed. The `demo` project's fixture (`e2e/media/stage.ts`) fills `pacing` (`e2e/media/pacing.ts`)
  with the presentation versions (`e2e/media/presentation.ts`: the mouse glides to the target, a 140 ms press, slower
  typing, a slow drag) for the length of each test.

## Alternatives considered

- **Keep it in the default run, fixed.** The flake at step 8.3 can be fixed, but the script stays the longest spec,
  and its one extra check (the story end to end) is for the people presenting, not for every change.
- **Delete it, or merge it into the scenarios.** The recording needs one continuous take on one state, which the
  scenarios (each resetting what it changes) don't give.

## Consequences

- A change that breaks only the end-to-end story, not a scenario, is not caught by `npm run e2e`. Run
  `--project=demo` before a demo, or when a change touches several scenarios' screens.
- A functional test clicks with no delay: no helper in `e2e/helpers/` pauses, and the demo project is the only place
  that does.
