import { formatAgo, utcDay } from "@/domain/dates";
import type { ActivityItem } from "@/domain/review-types";

// Groups the activity list (newest first) by calendar day, with a label for each: "Today",
// "Yesterday", then "Mar 5" (with the year when it isn't this one). Days are UTC days, the same days
// every absolute date on these tabs reads in, and the same days "yesterday" means everywhere
// (`formatAgo`), so an event's group and the date in its label never disagree, whatever the server's
// time zone.

export interface DayGroup {
  /** The UTC day, YYYY-MM-DD, as a stable key. */
  key: string;
  label: string;
  items: ActivityItem[];
}

export function dayGroups(items: readonly ActivityItem[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = utcDay(item.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: formatAgo(item.at, now, { precision: "day", dateFrom: 2, capitalize: true }), items: [item] });
  }
  return groups;
}
