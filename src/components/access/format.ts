// Small pure helpers for the access surfaces. Every date is a demo-clock instant, shown in UTC the way
// the audit and the settings sections show them, so a day never shifts with the viewer's time zone.

import { formatShortDate } from "@/domain/dates";

/** "Oct 5" (the shared UTC day). */
export function fmtDay(iso: string): string {
  return formatShortDate(iso);
}

/** "Alex Kim", "Alex Kim and Dana Park", "A, B and C". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Alex Kim", "Alex Kim or Dana Park", "A, B or C". */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
