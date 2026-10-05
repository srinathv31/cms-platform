// How a comment's time reads: "just now", "12 minutes ago", "3 hours ago", "2 days ago", then a date
// once it is old. The words are the review header's and the Activity tab's (`formatRelative`), so one
// instant never reads two ways on one screen. Pure and deterministic: the caller says what "now" is
// (the demo clock's), and dates are written in UTC, so the server's HTML and the browser's agree.

import { formatRelative } from "@/components/versions/format";

const DAY = 24 * 60 * 60_000;

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dateYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function relativeTime(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  if (nowMs - at < 14 * DAY) return formatRelative(iso, new Date(nowMs));
  const sameYear = new Date(at).getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return (sameYear ? dateFormat : dateYearFormat).format(at);
}
