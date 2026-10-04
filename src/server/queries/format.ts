import { formatDistanceStrict } from "date-fns";

/** "3 days ago", "just now". Computed against the demo clock, never the system clock. */
export function relativeTime(date: Date, nowDate: Date): string {
  const diff = nowDate.getTime() - date.getTime();
  if (diff < 45_000) return "just now";
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
