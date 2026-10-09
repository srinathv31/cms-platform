// The one way UCOMP writes a date or a time. Every instant is the demo clock's, read in UTC, so a day
// never shifts with the viewer's (or the server's) time zone and the server's HTML and the browser's
// agree. A time of day always says "UTC".
//
//   formatShortDate  "Oct 4" in the demo clock's year, "Jan 3, 2027" otherwise (pass `now`)
//   formatLongDate   "October 4, 2026" for sentences
//   formatTime       "3:42 PM UTC"
//   formatDateTime   "Oct 4, 3:42 PM UTC", or "Oct 4, 2025, 3:42 PM UTC" outside the demo clock's year
//   formatStamp      "Sun, Oct 4, 2026, 3:42 PM UTC": the full instant, for hover titles and the Demo pill
//
// A calendar day written YYYY-MM-DD (a sunset's day, which the read model takes in the business time zone,
// domain/business-zone.ts) reads as UTC midnight, so it formats as itself: "2027-03-01" is "March 1, 2027".
//
// Pure and safe on the server and the client.

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const SHORT_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

type When = Date | string | number;

const toDate = (value: When): Date => (value instanceof Date ? value : new Date(value));

/** Whether `date` falls in `now`'s UTC year; with no `now`, assumed so. */
function sameYear(date: Date, now?: When): boolean {
  return now === undefined || date.getUTCFullYear() === toDate(now).getUTCFullYear();
}

/** "Oct 4", or "Jan 3, 2027" when `now` is given and the date isn't in its year. */
export function formatShortDate(value: When, now?: When): string {
  const date = toDate(value);
  return (sameYear(date, now) ? SHORT : SHORT_YEAR).format(date);
}

/** "October 4, 2026": the style sentences use (and `formatValue`'s dates). */
export function formatLongDate(value: When): string {
  return LONG.format(toDate(value));
}

/** "3:42 PM UTC". */
export function formatTime(value: When): string {
  return `${TIME.format(toDate(value))} UTC`;
}

/** "Oct 4, 3:42 PM UTC", or "Oct 4, 2025, 3:42 PM UTC" when it isn't in `now`'s year. */
export function formatDateTime(value: When, now?: When): string {
  return `${formatShortDate(value, now)}, ${formatTime(value)}`;
}

/** "Sun, Oct 4, 2026, 3:42 PM UTC": the full instant. */
export function formatStamp(value: When): string {
  const date = toDate(value);
  return `${WEEKDAY.format(date)}, ${SHORT_YEAR.format(date)}, ${formatTime(date)}`;
}
