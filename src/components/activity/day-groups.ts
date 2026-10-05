import type { ActivityItem } from "@/domain/review-types";
import { formatShortDate } from "@/domain/render/errors";

// Groups the activity list (newest first) by calendar day, with a label for each: "Today",
// "Yesterday", then "Mar 5" (with the year when it isn't this one). Days are UTC days, the same days
// every absolute date on these tabs reads in (`formatShortDate`), so an event's group and the date in
// its label never disagree, whatever the server's time zone.

const DAY_MS = 86_400_000;

export interface DayGroup {
  /** The day's start (UTC), as a stable key. */
  key: string;
  label: string;
  items: ActivityItem[];
}

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dayLabel(at: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatShortDate(at, now);
}

export function dayGroups(items: readonly ActivityItem[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const at = new Date(item.at);
    const key = String(startOfDay(at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(at, now), items: [item] });
  }
  return groups;
}
