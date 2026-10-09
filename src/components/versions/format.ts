// The sunset picker's calendar dates and the Versions tab's sentence splitter. Pure, and safe on the
// server and the client. Every date the Versions and Activity tabs show, and how long ago, comes from
// `@/domain/dates`.
//
// A sunset is a calendar day in the business time zone (decision 0017), and the read model hands it over
// as that day (YYYY-MM-DD, `VersionTimelineItem.sunsetDay`). The sunset picker works in the same calendar
// dates: its `today` is the business zone's day on the demo clock, and what it sends is the same shape.
// The day picker itself takes local `Date`s, so `toYmd` and `fromYmd` cross between the two.

import { formatLongDate } from "@/domain/dates";

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

/** "March 1, 2027" for a picked day; "" until one is. */
export function formatLong(ymd: string): string {
  return fromYmd(ymd) ? formatLongDate(ymd) : "";
}

// ── Sentences ────────────────────────────────────────────────────────────────

/** Splits a plain-English line on its `code` spans, so keys can be set in mono. */
export function codeSegments(line: string): { text: string; code: boolean }[] {
  return line
    .split(/(`[^`]+`)/g)
    .filter((part) => part.length > 0)
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? { text: part.slice(1, -1), code: true } : { text: part, code: false }));
}
