// Date and sentence helpers for the Versions tab. Pure, and safe on the server and the client.
//
// Timeline dates are formatted on the server (the page is a server component) and reach the client as
// strings. Every absolute date the Versions and Activity tabs show is read in UTC, as the render API and
// the domain's sentences read them ("March 1, 2027", `formatLongDate`) and as the workspace header's
// "Sunset Mar 1" badge does: the same instant never reads as two different days on one page. Relative
// times ("today", "3 days ago", "5 minutes ago") are not dates and stay as they are.
//
// The sunset picker works in calendar dates (YYYY-MM-DD): `today` comes from the demo clock (the UTC
// day), and what the picker sends is the same shape.

import { formatDistanceStrict } from "date-fns";
import { formatShortDate } from "@/domain/render/errors";

const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const COUNT = new Intl.NumberFormat("en-US");

/** "Mar 5", or "Mar 5, 2027" when it isn't this year: the UTC day, like `formatLongDate`. */
export function formatDate(iso: string, now: Date): string {
  return formatShortDate(new Date(iso), now);
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "today", "yesterday", "3 days ago", then the date: whole calendar days on the demo clock. */
export function formatWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return formatDate(iso, now);
}

/** "128 renders", "1 render". */
export function renderCount(n: number): string {
  return `${COUNT.format(n)} ${n === 1 ? "render" : "renders"}`;
}

/** "3 minutes ago", "just now": the Activity tab's time. */
export function formatRelative(iso: string, now: Date): string {
  const date = new Date(iso);
  if (now.getTime() - date.getTime() < 45_000) return "just now";
  return formatDistanceStrict(date, now, { addSuffix: true });
}

const STAMP = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "Sun, Oct 4, 2026, 3:42 PM UTC": the absolute time on hover, in UTC like every date on these tabs. */
export function formatStamp(iso: string): string {
  return STAMP.format(new Date(iso));
}

// ── Calendar dates (YYYY-MM-DD) ──────────────────────────────────────────────

/** The calendar date of a Date, as the picker sends it. */
export function toYmd(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** The Date (local midnight) a YYYY-MM-DD string names, or null when it isn't one. */
export function fromYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** ymd plus `days` calendar days. */
export function addDays(ymd: string, days: number): string {
  const date = fromYmd(ymd) ?? new Date();
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

/** "March 1, 2027". */
export function formatLong(ymd: string): string {
  const date = fromYmd(ymd);
  return date ? LONG.format(date) : "";
}

// A sunset is a calendar day, stored as that day's midnight UTC (the server compares whole UTC days,
// and `today` is the UTC day). So its date is read in UTC, whatever the viewer's time zone.

/** The calendar day of a stored sunset, as the picker sends it: "2027-03-01". */
export function ymdOfIso(iso: string): string {
  return iso.slice(0, 10);
}

/** "Mar 1", or "Mar 1, 2027" when it isn't this year: a sunset's day, in UTC like `formatLongDate`. */
export function formatSunset(iso: string, now: Date): string {
  return formatShortDate(new Date(iso), now);
}

// ── Sentences ────────────────────────────────────────────────────────────────

/** Splits a plain-English line on its `code` spans, so keys can be set in mono. */
export function codeSegments(line: string): { text: string; code: boolean }[] {
  return line
    .split(/(`[^`]+`)/g)
    .filter((part) => part.length > 0)
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? { text: part.slice(1, -1), code: true } : { text: part, code: false }));
}
