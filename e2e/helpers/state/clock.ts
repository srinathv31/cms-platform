import { setSetting, setting } from "./platform";

// The demo clock: real time plus an offset in whole days (`settings.clock_offset_days`), which the Demo drawer's
// Advance moves. A backend with a real clock provides a test-only way to set the same offset (decision 0068).

const CLOCK_KEY = "clock_offset_days";
const DAY = 86_400_000;

/** How many days the demo clock is ahead of real time. */
export async function clockOffsetDays(): Promise<number> {
  return Number((await setting<number>(CLOCK_KEY)) ?? 0);
}

/** Moves the demo clock to `days` ahead of real time (0 puts it back). */
export async function setClockOffsetDays(days: number): Promise<void> {
  await setSetting(CLOCK_KEY, days);
}

/** The demo clock's now, as the server reads it, in ms since the epoch. */
export async function demoNow(): Promise<number> {
  return Date.now() + (await clockOffsetDays()) * DAY;
}

/** The demo clock's day (UTC), `plusDays` from today: YYYY-MM-DD. */
export async function clockDay(plusDays = 0): Promise<string> {
  const offset = await clockOffsetDays();
  return new Date(Date.now() + (offset + plusDays) * DAY)
    .toISOString()
    .slice(0, 10);
}
