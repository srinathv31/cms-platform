// Dates and sentences for the Usage screens. Pure and safe on the server and the client. Days are
// UTC days of the demo clock, like every date on these screens (see `domain/golive/usage.ts`).

import { calendarDaysUntil } from "@/domain/golive/usage";
import { formatShortDate } from "@/domain/render/errors";

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Tue, Jan 14, 2027" for a YYYY-MM-DD day. */
export function formatDay(ymd: string): string {
  return DAY.format(new Date(`${ymd}T00:00:00.000Z`));
}

/** "Jan 14" for a YYYY-MM-DD day. */
export function formatDayShort(ymd: string): string {
  return SHORT.format(new Date(`${ymd}T00:00:00.000Z`));
}

/** "today", "yesterday", "5 days ago", then the date. Whole UTC calendar days on the demo clock. */
export function formatLastRender(iso: string, now: Date): string {
  const days = -calendarDaysUntil(new Date(iso), now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return formatShortDate(new Date(iso), now);
}

/** "sunsets in 21 days", "sunsets tomorrow", "sunsets today". */
export function sunsetPhrase(sunsetAt: string, now: Date): string {
  const days = calendarDaysUntil(new Date(sunsetAt), now);
  if (days <= 0) return "sunsets today";
  if (days === 1) return "sunsets tomorrow";
  return `sunsets in ${days} days`;
}

/** "1 version", "3 versions". */
export function versionCount(n: number): string {
  return `${n} ${n === 1 ? "version" : "versions"}`;
}
