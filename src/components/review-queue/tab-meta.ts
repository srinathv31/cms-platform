// The queue's three tabs as words: their labels and their empty lines. Apart from format-row.ts, which
// builds rows on the server's clock, so the skeleton can name the tabs without any of that.

export type QueueTabKey = "waiting" | "submitted" | "decided";

export const TAB_META: Record<QueueTabKey, { label: string; empty: string }> = {
  waiting: { label: "Waiting on me", empty: "Nothing waiting on you." },
  submitted: { label: "Submitted by me", empty: "You haven't submitted anything for review." },
  decided: { label: "Recently decided", empty: "No decisions in the last 30 days." },
};
