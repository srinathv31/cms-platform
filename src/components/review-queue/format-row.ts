// A queue row as the list shows it: every string already made, so the client list only lays out. Pure.
// Made on the server, where the demo clock is (relative times are against it, never the system clock).

import type { Person, ReviewQueueRow } from "@/domain/review-types";
import { relativeTime } from "@/server/queries/format";
import { TAB_META, type QueueTabKey } from "./tab-meta";

export interface QueueRowView {
  key: string;
  /** The review screen: /{space}/review/{templateId}/{n}. */
  href: string;
  name: string;
  /** "v3" */
  versionLabel: string;
  teamName: string;
  breaking: boolean;
  author: Person;
  /** "3 days ago" */
  submitted: string;
  /** "Team approver" */
  stage: string;
  /** "Stage 1 of 2" when the chain has more than one stage; null when it has one. */
  stageStep: string | null;
  /** Recently decided only. */
  decision?: { kind: "approved" | "changes_requested"; label: "Approved" | "Changes requested"; by: string; when: string };
  /** What the row says on a line under the name when its columns fold into one: "Maya Chen · 3 days ago · Team approver". */
  folded: string;
}

const DECISION_LABEL = { approved: "Approved", changes_requested: "Changes requested" } as const;

export function formatQueueRow(row: ReviewQueueRow, spaceSlug: string, nowDate: Date): QueueRowView {
  const submitted = relativeTime(new Date(row.submittedAt), nowDate);
  const decision = row.decision
    ? {
        kind: row.decision.kind,
        label: DECISION_LABEL[row.decision.kind],
        by: row.decision.by.name,
        when: relativeTime(new Date(row.decision.at), nowDate),
      }
    : undefined;
  return {
    key: row.versionId,
    href: `/${spaceSlug}/review/${row.templateId}/${row.versionNumber}`,
    name: row.templateName,
    versionLabel: `v${row.versionNumber}`,
    teamName: row.teamName,
    breaking: row.breaking,
    author: row.author,
    submitted,
    stage: row.stage.name,
    stageStep: row.stage.count > 1 ? `Stage ${row.stage.position + 1} of ${row.stage.count}` : null,
    decision,
    folded: decision
      ? decision.kind === "approved"
        ? `Approved by ${decision.by} · ${decision.when}`
        : `${decision.by} requested changes · ${decision.when}`
      : `${row.author.name} · ${submitted} · ${row.stage.name}`,
  };
}

export { TAB_META, type QueueTabKey } from "./tab-meta";

export interface QueueTab {
  key: QueueTabKey;
  label: string;
  rows: QueueRowView[];
  /** One calm line, never an instruction. */
  empty: string;
}

const TAB_KEYS: readonly QueueTabKey[] = ["waiting", "submitted", "decided"];

/** A `?tab=` value as a tab, or null when it is missing or not one of the three. */
export function parseTab(value: string | null | undefined): QueueTabKey | null {
  return TAB_KEYS.find((key) => key === value) ?? null;
}

/**
 * The tab the queue opens on with no `?tab=`: Waiting on me, unless nothing waits on the viewer, then
 * the first tab that has rows (Submitted by me, then Recently decided). All three empty: Waiting on me.
 */
export function defaultTab(tabs: readonly Pick<QueueTab, "key" | "rows">[]): QueueTabKey {
  if (tabs.some((tab) => tab.key === "waiting" && tab.rows.length > 0)) return "waiting";
  return tabs.find((tab) => tab.rows.length > 0)?.key ?? "waiting";
}

/** The three tabs, in order, from the queue's three lists. */
export function queueTabs(
  queue: { waiting: ReviewQueueRow[]; submitted: ReviewQueueRow[]; decided: ReviewQueueRow[] },
  spaceSlug: string,
  nowDate: Date,
): QueueTab[] {
  return TAB_KEYS.map((key) => ({
    key,
    ...TAB_META[key],
    rows: queue[key].map((row) => formatQueueRow(row, spaceSlug, nowDate)),
  }));
}
