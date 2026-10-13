import "server-only";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { DAY_MS } from "@/domain/dates";
import { db } from "@/server/db/client";
import { settings } from "@/server/db/schema/ucomp";

// The local implementation's clock, the demo clock: the real time plus the "advance N days" offset the demo's
// Advance clock moves. The backend owns time (decision 0072): this is the one place the system clock is read, and
// only the backend reads it (`localServices` by default, /api/v1, the seed and the reset). The BFF reads no clock:
// a read that decides by time answers `asOf`. Domain functions take `now` as an argument.

export const CLOCK_OFFSET_KEY = "clock_offset_days";

export async function getClockOffsetDays(): Promise<number> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, CLOCK_OFFSET_KEY),
  });
  return typeof row?.value === "number" ? row.value : 0;
}

export async function now(): Promise<Date> {
  // Request time only: libSQL resolves in microtasks, so without this a prerender could reach Date.now().
  await connection();
  const offset = await getClockOffsetDays();
  return new Date(Date.now() + offset * DAY_MS);
}

export async function advanceClock(days: number): Promise<number> {
  await connection();
  const next = (await getClockOffsetDays()) + days;
  await db
    .insert(settings)
    .values({ key: CLOCK_OFFSET_KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
  return next;
}
