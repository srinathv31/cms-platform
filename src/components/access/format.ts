// Small pure helpers for the access surfaces. Every date is a demo-clock instant, shown in UTC the way
// the audit and the settings sections show them, so a day never shifts with the viewer's time zone.

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 5". Pass `withYear` when a sentence needs it. */
export function fmtDay(iso: string, withYear = false): string {
  return (withYear ? monthDayYear : monthDay).format(new Date(iso));
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
