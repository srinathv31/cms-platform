"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { runAccessSweep } from "@/server/access-sweep";
import { advanceClock } from "@/server/clock";
import { resetDemo } from "@/server/reset";
import { runSunsetSweep } from "@/server/sunset-sweep";
import { DEFAULT_PERSONA, PERSONA_COOKIE } from "@/server/viewer";

// Demo-only tools. They are not part of the product, so there is no persona permission to check.

/** Restore the seeded demo data, return to Maya, and land on the Coral Offers library. */
export async function resetDemoAction(): Promise<void> {
  await resetDemo();
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
export async function advanceClockAction(days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Enter 1 to 3650 days");
  await advanceClock(days);
  await runAccessSweep();
  await runSunsetSweep();
  revalidatePath("/", "layout");
  refresh();
}
