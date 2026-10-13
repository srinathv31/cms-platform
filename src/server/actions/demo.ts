"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { demoToolsRefusal } from "@/domain/demo";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { runAccessSweep } from "@/server/access-sweep";
import { advanceClock } from "@/server/clock";
import { DEMO_MODE } from "@/server/config";
import { resetDemo } from "@/server/reset";
import { runSunsetSweep } from "@/server/sunset-sweep";
import { DEFAULT_PERSONA, PERSONA_COOKIE } from "@/server/viewer";

// Demo-only tools. They are not part of the product, so there is no persona permission to check, and
// they don't run on the server action kit: each calls modules that write in their own transactions. What
// they check instead is the demo flag (`DEMO_MODE`, decision 0051): off, each answers `demo_mode_off` before
// it reads its input or touches anything.

/**
 * Restore the seeded demo data, return to Maya, and land on the Coral Offers library. Answers only a
 * refusal: the flag is off, or the database isn't a local file (`resetDemo`); a reset redirects.
 */
export async function resetDemoAction(): Promise<ActionResult> {
  const off = demoToolsRefusal(DEMO_MODE);
  if (off) return off;
  const reset = await resetDemo();
  if (!reset.ok) return reset;
  (await cookies()).set(PERSONA_COOKIE, DEFAULT_PERSONA, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/coral-offers/library");
}

/**
 * Move the demo clock forward by whole days, then apply every access deadline the jump crossed
 * (recertification lapses, the 90-day flag, the 120-day suspension) and record every sunset it passed,
 * each backdated to when it was due.
 */
export async function advanceClockAction(days: number): Promise<ActionResult> {
  const off = demoToolsRefusal(DEMO_MODE);
  if (off) return off;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return {
      ok: false,
      ...REQUEST_REFUSALS.invalidInput("Enter 1 to 3,650 days."),
    };
  }
  await advanceClock(days);
  await runAccessSweep();
  await runSunsetSweep();
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}
