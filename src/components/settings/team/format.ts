// Small pure helpers for the Team settings sections. Every date is a demo-clock instant: shown in UTC,
// the way the audit and the sidebar show them, so a day never shifts with the viewer's time zone.

const DAY_MS = 86_400_000;

import { formatShortDate } from "@/domain/dates";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const firstName = (name: string) => name.split(" ")[0] ?? name;

/** "Oct 5", or "Oct 5, 2027" when the year isn't the demo clock's. `today` is the section's YYYY-MM-DD. */
export function fmtDay(value: string | Date, today: string): string {
  return formatShortDate(value, `${today.slice(0, 10)}T00:00:00.000Z`);
}

/** The demo day `n` days after `today` (YYYY-MM-DD). */
export function addDays(today: string, n: number): Date {
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY_MS);
}

/** Whole calendar days from `today` to the day of `iso` (negative when it's past). */
export function daysUntil(iso: string, today: string): number {
  const target = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((target - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** "Today", "Yesterday", "12 days ago"; "Never" with no sign-in on record. */
export function daysAgo(iso: string | null, today: string): string {
  if (!iso) return "Never";
  const n = -daysUntil(iso, today);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  return `${n} days ago`;
}

/** "Sam Ortiz", "Sam Ortiz and Devon Lin", "A, B and C". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
