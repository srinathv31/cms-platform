// Small pure helpers for the Team settings sections. Every date is a demo-clock instant, shown in UTC
// (`@/domain/dates`), the way the audit and the sidebar show them, so a day never shifts with the
// viewer's time zone. Deadlines and the sentences about them come from the read models; these only lay
// out what they send.

import { formatAgo } from "@/domain/dates";

export { firstName } from "@/domain/access";

/** A last sign-in: "Today", "Yesterday", "12 days ago" by calendar day; "Never" with none on record. `today` is the section's YYYY-MM-DD. */
export function lastActive(iso: string | null, today: string): string {
  return iso ? formatAgo(iso, today, { precision: "day", capitalize: true }) : "Never";
}
