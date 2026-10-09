// Phrases for the Usage screens and the Versions timeline. Pure and safe on the server and the client.
// Dates, counts and plurals come from src/domain (`dates.ts`, `numbers.ts`, `plural.ts`).

import { formatAgo } from "@/domain/dates";

/**
 * When a render happened: "today", "yesterday", "5 days ago", then the date from two weeks ("Sep 1"), by
 * calendar day on the demo clock (`formatAgo`). The Usage tables and the Versions timeline's "Last render".
 */
export function formatLastRender(iso: string, now: Date): string {
  return formatAgo(iso, now, { precision: "day", dateFrom: 14 });
}

/**
 * "sunsets in 21 days", "sunsets tomorrow", "sunsets today". `days` is whole days from today to the
 * sunset's day, both in the business time zone (`daysUntilSunset`, counted by the read model).
 */
export function sunsetPhrase(days: number): string {
  if (days <= 0) return "sunsets today";
  if (days === 1) return "sunsets tomorrow";
  return `sunsets in ${days} days`;
}
