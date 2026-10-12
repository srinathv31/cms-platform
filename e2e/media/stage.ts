import type { Page, TestInfo } from "@playwright/test";
import { demoCursor } from "./demo";
import { pacing } from "./pacing";
import { presentation } from "./presentation";

// The `demoStage` fixture (helpers/scenario.ts runs it before every test, automatically). It does something
// only in the projects that record: nothing in `chromium`.
//   - `demo`: demo mode on (UCOMP_DEMO), the cursor on the page, and presentation pacing for clicks, typing and drags.
//   - `stills-1280`: shooting on (UCOMP_STILLS). Full speed, no cursor.

export async function demoStage(
  { page }: { page: Page },
  provide: () => Promise<void>,
  testInfo: TestInfo,
) {
  const before = {
    UCOMP_DEMO: process.env.UCOMP_DEMO,
    UCOMP_STILLS: process.env.UCOMP_STILLS,
  };
  const demo = !!testInfo.project.metadata?.demo;
  if (demo) {
    process.env.UCOMP_DEMO = "1";
    Object.assign(pacing, presentation);
  }
  if (testInfo.project.metadata?.stills) process.env.UCOMP_STILLS = "1";
  await demoCursor(page);
  await provide();
  if (demo)
    for (const key of Object.keys(pacing) as (keyof typeof pacing)[])
      delete pacing[key];
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
