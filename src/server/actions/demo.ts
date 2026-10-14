"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { DEMO_ADVANCE_MAX_DAYS, demoToolsRefusal } from "@/domain/demo";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { DEMO_MODE } from "@/server/config";
import { requestContextOrRefusal } from "@/server/context/request";
import { services } from "@/server/services";
import { DEFAULT_PERSONA, PERSONA_COOKIE } from "@/server/viewer";
import { serverAction } from "./kit";

// Demo-only tools, behind the demo service (src/server/services/demo.ts). They are not part of the product, so
// there is no persona permission to check. What they check instead is the demo flag (`DEMO_MODE`, decision
// 0051): off, each answers `demo_mode_off` before it reads its input or touches anything.

/**
 * Restore the seeded demo data, return to Maya, and land on the Coral Offers library. Answers only a
 * refusal: the flag is off, or the database isn't a local file (`reset_needs_local_file`); a reset redirects.
 */
export async function resetDemoAction(): Promise<ActionResult> {
  const off = demoToolsRefusal(DEMO_MODE);
  if (off) return off;
  const context = await requestContextOrRefusal();
  if (!context.ok) return context;
  const reset = await services().demo.reset(context.context);
  if (!reset.ok) return reset;
  (await cookies()).set(PERSONA_COOKIE, DEFAULT_PERSONA, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/coral-offers/library");
}

const Days = z.number().int().min(1).max(DEMO_ADVANCE_MAX_DAYS);

/**
 * Move the demo clock forward by whole days. The backend then applies every access deadline the jump crossed
 * (recertification lapses, the 90-day flag, the 120-day suspension) and records every sunset it passed, each
 * backdated to when it was due.
 */
export async function advanceClockAction(days: number): Promise<ActionResult> {
  const off = demoToolsRefusal(DEMO_MODE);
  if (off) return off;
  return serverAction(days, {
    input: Days,
    invalid: REQUEST_REFUSALS.invalidInput("Enter 1 to 3,650 days."),
    call: (ctx, days) => services().demo.advanceClock(ctx, { days }),
    after: () => {
      revalidatePath("/", "layout");
      refresh();
    },
  }).then((result) => (result.ok ? { ok: true } : result));
}
