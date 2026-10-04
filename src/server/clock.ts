import "server-only";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { settings } from "./db/schema/ucomp";

// Demo clock: real current time + an "advance N days" offset (Sri, Oct 4).
// This is the ONLY place that reads the system clock. Domain functions take `now` as an argument.

const DAY_MS = 86_400_000;
export const CLOCK_OFFSET_KEY = "clock_offset_days";

export async function getClockOffsetDays(): Promise<number> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, CLOCK_OFFSET_KEY) });
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
