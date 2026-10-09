// The one way Stencil writes a date or a time, counts days, and says how long ago something was. Every
// instant is the demo clock's, read in UTC, so a day never shifts with the viewer's (or the server's)
// time zone and the server's HTML and the browser's agree. A time of day always says "UTC".
//
//   formatShortDate    "Oct 4" in the demo clock's year, "Jan 3, 2027" otherwise (pass `now`)
//   formatLongDate     "October 4, 2026" for sentences
//   formatWeekdayDate  "Sun, Oct 4, 2026": a day on its own, in a chart's tooltip
//   formatTime         "3:42 PM UTC"
//   formatDateTime     "Oct 4, 3:42 PM UTC", or "Oct 4, 2025, 3:42 PM UTC" outside the demo clock's year
//   formatStamp        "Sun, Oct 4, 2026, 3:42 PM UTC": the full instant, for hover titles and the Demo pill
//   formatAgo          "3 hours ago", "yesterday", "4 days ago": how long ago, by calendar day
//
// A calendar day written YYYY-MM-DD (a sunset's day, which the read model takes in the business time zone,
// domain/business-zone.ts) reads as UTC midnight, so it formats as itself: "2027-03-01" is "March 1, 2027".
//
// Days are counted the same way everywhere (decision 0028): `daysBetween` counts calendar days, never
// 24-hour periods, so 23:00 yesterday is "yesterday" at 01:00 today. An instant counts as its UTC day, the
// day the dates beside it show. A sunset counts in the business time zone instead: `daysUntilSunset` hands
// `daysBetween` that zone's days.
//
// Pure and safe on the server and the client.

import { plural } from "./plural";

/** One day in milliseconds: for elapsed windows ("the last 30 days") and deadlines. Days on screen are `daysBetween`'s. */
export const DAY_MS = 86_400_000;

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

/** "Sun, Oct 4, 2026": a day with its weekday and year. */
export function formatWeekdayDate(value: When): string {
  const date = toDate(value);
  return `${WEEKDAY.format(date)}, ${SHORT_YEAR.format(date)}`;
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
  return `${formatWeekdayDate(value)}, ${formatTime(value)}`;
}

/**
 * A date read from a stored record (an audit row's details, a notice's payload) in the long form,
 * "March 1, 2027", or "" when the value isn't an ISO date.
 */
export function formatRecordedDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : formatLongDate(at);
}

// ── Calendar days (YYYY-MM-DD) ──────────────────────────────────────────────

/** Whether `value` is a real calendar day written YYYY-MM-DD ("2027-02-30" isn't). */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === value;
}

/** The UTC day an instant falls on: "2026-10-04". A calendar day reads as itself. */
export function utcDay(value: When): string {
  return toDate(value).toISOString().slice(0, 10);
}

/** Midnight UTC that starts a calendar day, in ms. */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** A calendar day plus `n` days (back, when negative): "2026-12-20" plus 30 is "2027-01-19". */
export function addDays(day: string, n: number): string {
  return utcDay(dayStartMs(day) + n * DAY_MS);
}

/** Which UTC day an instant (or a calendar day) is, counted from 1970-01-01. */
const dayNumber = (value: When): number => Math.floor(toDate(value).getTime() / DAY_MS);

/**
 * Whole calendar days from `from`'s day to `to`'s day: 1 from "2026-10-09" to "2026-10-10", -1 back, 0 on
 * the same day. An instant counts as its UTC day, so 23:00 on October 9 and 01:00 on October 10 are a day
 * apart. To count in another zone, pass that zone's days (`todayIn`, `sunsetDay` in business-zone.ts).
 */
export function daysBetween(from: When, to: When): number {
  return dayNumber(to) - dayNumber(from);
}

// ── How long ago ────────────────────────────────────────────────────────────

export interface AgoOptions {
  /**
   * "time" (the default) says how long ago within today: "just now", "12 minutes ago", "3 hours ago".
   * "day" counts days only, so all of today is "today" (a last render, a last sign-in), and it never
   * turns into months: "95 days ago".
   */
  precision?: "time" | "day";
  /** From this many days ago, the date instead ("Sep 1", or "Sep 1, 2025" in another year). */
  dateFrom?: number;
  /** Capitalized, for a label that stands alone: "Yesterday", "Just now". */
  capitalize?: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * How long ago `value` was at `now` (the demo clock), by calendar day (`daysBetween`):
 *
 *   "just now"                        under 45 seconds, or not yet
 *   "50 seconds ago", "12 minutes ago", "3 hours ago"   earlier today (`precision: "day"`: "today")
 *   "yesterday"                       any time on the day before, even an hour ago
 *   "4 days ago"                      whole calendar days, until 30 days have passed
 *   "1 month ago", "2 years ago"      then 30-day months and 365-day years (`precision: "day"` keeps counting days)
 *
 * Seconds, minutes, hours, months and years are rounded to the nearest. "" when `value` isn't a date.
 */
export function formatAgo(value: When, now: When, options: AgoOptions = {}): string {
  const at = toDate(value);
  if (Number.isNaN(at.getTime())) return "";
  const words = agoWords(at, toDate(now), options);
  return options.capitalize ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

function agoWords(at: Date, now: Date, { precision = "time", dateFrom }: AgoOptions): string {
  const days = daysBetween(at, now);
  const ms = now.getTime() - at.getTime();
  if (dateFrom !== undefined && days >= dateFrom) return formatShortDate(at, now);
  if (days === 1) return "yesterday";
  if (days > 1) return precision === "day" || ms < MONTH_MS ? `${days} days ago` : `${longAgo(ms)} ago`;
  if (precision === "day") return "today";
  if (ms < 45_000) return "just now";
  if (ms < MINUTE_MS) return `${plural(Math.round(ms / 1000), "second")} ago`;
  if (ms < HOUR_MS) return `${plural(Math.round(ms / MINUTE_MS), "minute")} ago`;
  return `${plural(Math.round(ms / HOUR_MS), "hour")} ago`;
}

/** "1 month", "11 months", "1 year", "3 years": 30-day months under a year, then 365-day years, rounded. */
function longAgo(ms: number): string {
  if (ms >= YEAR_MS) return plural(Math.round(ms / YEAR_MS), "year");
  const months = Math.round(ms / MONTH_MS);
  return months === 12 ? "1 year" : plural(months, "month");
}
