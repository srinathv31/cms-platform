import { formatDistanceStrict } from "date-fns";

/** "3 days ago", "just now". Computed against the demo clock, never the system clock. */
export function relativeTime(date: Date, nowDate: Date): string {
  const diff = nowDate.getTime() - date.getTime();
  if (diff < 45_000) return "just now";
  return formatDistanceStrict(date, nowDate, { addSuffix: true });
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/**
 * Relative words by calendar day (UTC, the demo clock's days, as the settings dates read): "just now",
 * "3 hours ago" the same day, then "Yesterday" and "4 days ago", so something from late yesterday is
 * never "2 days ago". Past a month, the plain distance ("3 months ago").
 */
export function dayAgo(date: Date, nowDate: Date): string {
  const days = utcDay(nowDate) - utcDay(date);
  if (days <= 0) return relativeTime(date, nowDate);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDistanceStrict(date, nowDate, { addSuffix: true });
}

const dueFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Mar 1" */
export function shortDate(date: Date): string {
  return dueFormat.format(date);
}

const stampFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Sun, Oct 4, 2026, 3:42 PM" */
export function stamp(date: Date): string {
  return stampFormat.format(date);
}
