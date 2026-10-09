"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { canSeeSpace, defaultSpace } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { runAccessSweep } from "@/server/access-sweep";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema/ucomp";
import { runSunsetSweep } from "@/server/sunset-sweep";
import { getPersonas, getViewer, PERSONA_COOKIE } from "@/server/viewer";

const YEAR = 60 * 60 * 24 * 365;

/** First path segment of an in-app path ("/coral-offers/library" → "coral-offers"). */
function firstSegment(path: string): string | null {
  if (!path.startsWith("/")) return null;
  return path.split("?")[0]!.split("/").filter(Boolean)[0] ?? null;
}

/**
 * Demo persona switch. There is no login: this sets the persona cookie, and counts as the persona's
 * sign-in. The access sweep runs FIRST (a member past a deadline lost access before signing in), then
 * the sign-in restarts their inactivity clock (`users.last_active_at`). The sunset sweep runs too, so
 * the audit log records any sunset the clock has passed.
 * Stay on the same URL if the new persona can see it, otherwise go to their default space. A demo
 * tool, so it checks no permission and doesn't run on the server action kit; a persona that isn't one
 * is refused.
 */
export async function switchPersona(personaId: string, currentPath: string): Promise<ActionResult> {
  const personas = await getPersonas();
  if (typeof currentPath !== "string" || !personas.some((p) => p.id === personaId)) {
    return { ok: false, ...REQUEST_REFUSALS.invalidInput() };
  }

  (await cookies()).set(PERSONA_COOKIE, personaId, {
    path: "/",
    sameSite: "lax",
    maxAge: YEAR,
  });

  await runAccessSweep();
  await runSunsetSweep();
  await db.update(users).set({ lastActiveAt: await now() }).where(eq(users.id, personaId));
  revalidatePath("/", "layout");

  const viewer = await getViewer(); // first read in this request: reflects the new cookie
  const fallback = defaultSpace(viewer);
  const home = (fallback ? `/${fallback}/library` : "/request-access") as Route;
  const segment = firstSegment(currentPath);

  if (segment === null) {
    refresh();
    return { ok: true };
  }
  if (segment === "request-access") {
    // Anyone may request access, but someone who already has a team lands in it.
    if (fallback) redirect(home);
    refresh();
    return { ok: true };
  }
  if (canSeeSpace(viewer, segment)) {
    refresh();
    return { ok: true };
  }
  redirect(home);
}
