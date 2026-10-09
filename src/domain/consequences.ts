// Consequences before commitment: the approve, sunset and revoke dialogs say who is affected, in plain
// words, from the render log (build plan, "Template lifecycle"). Pure TypeScript; the dialog recomputes
// the lines client-side as the sunset date changes, so `now` is the demo clock passed in.
//
//   approve  "v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks."
//            (a first version: "v1 becomes Active." then "Consumers can start using it right away.")
//            and, when the version breaks the contract, one line per consumer of v1:
//            "Coral has to map `annual_fee` before it moves to v2."
//   sunset   "Coral still renders v1 (last render today). It will keep working until March 1, 2027."
//   revoke   "Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately."
//            (`pending: true`, while the revoke only waits for a second approver:
//             "Coral rendered v1 412 times in the last 30 days. Once confirmed, its renders will fail immediately.")
//
// A consumer "renders" a version when the usage rows (non-preview renders, aggregated by the server)
// list it for that version. Several consumers are listed most-used first.

import { formatAgo, formatLongDate } from "./dates";
import { plural } from "./plural";
import type { ConsequenceAction, ConsumerUsage } from "./review-types";
import type { ContractChange } from "./types";

/** What going live means when nothing was Active before. */
export const FIRST_LIVE = "Consumers can start using it right away.";

export function consequences(action: ConsequenceAction, usage: readonly ConsumerUsage[], now: Date): string[] {
  switch (action.kind) {
    case "approve":
      return approveLines(action, usage, now);
    case "sunset": {
      const v = `v${action.number}`;
      const users = consumersOf(usage, action.number);
      if (users.length === 0) return [noConsumer(v)];
      return users.map((u) => keepsWorking(u, v, action.sunsetAt, now));
    }
    case "revoke": {
      const v = `v${action.number}`;
      const users = consumersOf(usage, action.number);
      const pending = action.pending === true;
      const lines = users.length === 0 ? [noConsumer(v)] : users.map((u) => failsNow(u, v, now, pending));
      if (action.activeNumber === action.number) {
        lines.push(`${pending ? "Once confirmed, no" : "No"} version will be Active until a new one is approved.`);
      }
      return lines;
    }
  }
}

function approveLines(
  action: Extract<ConsequenceAction, { kind: "approve" }>,
  usage: readonly ConsumerUsage[],
  now: Date,
): string[] {
  const live = `v${action.newNumber} becomes Active.`;
  // A first version: nothing is superseded, and consumers can now find it (and SHARE opens up).
  if (action.previousNumber === null) return [live, FIRST_LIVE];

  const prev = `v${action.previousNumber}`;
  const superseded = `${live} ${prev} becomes Superseded`;
  const users = consumersOf(usage, action.previousNumber);

  const { sunsetAt } = action;

  if (users.length === 0) return [`${superseded}.`, noConsumer(prev)];

  // What each consumer of the previous version has to do before it can move on.
  const mapping = (action.breakingKeys ?? []).length > 0 ? users.map((u) => hasToMap(u, action.breakingKeys!, action.newNumber)) : [];

  if (sunsetAt === null) {
    // Pinned: nothing changes for them until they relink.
    const names = joinList(users.map((u) => u.consumerName));
    const [keep, they] = users.length === 1 ? ["keeps", "it relinks"] : ["keep", "they relink"];
    return [`${superseded}; ${names} ${keep} rendering ${prev} until ${they}.`, ...mapping];
  }
  return [`${superseded}.`, ...users.map((u) => keepsWorking(u, prev, sunsetAt, now)), ...mapping];
}

/**
 * The keys a consumer has to map to move to a version: those of its breaking contract changes that
 * ask something of the consumer (a required variable added, a key renamed, a type changed, an optional
 * one made required). A removal asks nothing: the consumer just stops sending it. Each key once, in
 * the order of the changes.
 */
export function breakingKeysOf(changes: readonly ContractChange[]): string[] {
  const keys: string[] = [];
  for (const change of changes) {
    if (!change.breaking || change.kind === "removed") continue;
    if (!keys.includes(change.key)) keys.push(change.key);
  }
  return keys;
}

// ── Sentences ────────────────────────────────────────────────────────────────

/** "Coral has to map `annual_fee` before it moves to v3." The keys are in backticks, as the contract lines have them. */
function hasToMap(u: Usage, keys: readonly string[], newNumber: number): string {
  return `${u.consumerName} has to map ${joinList(keys.map((key) => `\`${key}\``))} before it moves to v${newNumber}.`;
}

/** "a", "a and b", "a, b, and c". */
function joinList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** "No consumer renders v1." */
function noConsumer(v: string): string {
  return `No consumer renders ${v}.`;
}

/** "Coral still renders v1 (last render today). It will keep working until March 1, 2027." */
function keepsWorking(u: Usage, v: string, sunsetAt: string, now: Date): string {
  return `${u.consumerName} still renders ${v} (last render ${ago(u.lastRenderAt, now)}). It will keep working until ${formatLongDate(new Date(sunsetAt))}.`;
}

/**
 * "Coral rendered v1 412 times in the last 30 days. Its renders will fail immediately."
 * While the revoke is only requested: "… Once confirmed, its renders will fail immediately."
 */
function failsNow(u: Usage, v: string, now: Date, pending: boolean): string {
  const what =
    u.renders30d > 0
      ? `rendered ${v} ${times(u.renders30d)} in the last 30 days`
      : `last rendered ${v} ${ago(u.lastRenderAt, now)}`;
  return `${u.consumerName} ${what}. ${pending ? "Once confirmed, its" : "Its"} renders will fail immediately.`;
}

/** "today", "yesterday", "45 days ago": calendar days on the demo clock, as every screen counts them. */
function ago(iso: string, now: Date): string {
  return formatAgo(iso, now, { precision: "day" });
}

/** "once", "412 times", "1,204 times". */
function times(n: number): string {
  return n === 1 ? "once" : plural(n, "time");
}

// ── Usage ────────────────────────────────────────────────────────────────────

interface Usage {
  consumerId: string;
  consumerName: string;
  lastRenderAt: string;
  renders30d: number;
}

/** The consumers rendering one version, one entry each, most renders first (then most recent, then by name). */
function consumersOf(usage: readonly ConsumerUsage[], versionNumber: number): Usage[] {
  const byConsumer = new Map<string, Usage>();
  for (const row of usage) {
    if (row.versionNumber !== versionNumber) continue;
    const seen = byConsumer.get(row.consumerId);
    byConsumer.set(
      row.consumerId,
      seen
        ? {
            ...seen,
            renders30d: seen.renders30d + row.renders30d,
            lastRenderAt: row.lastRenderAt > seen.lastRenderAt ? row.lastRenderAt : seen.lastRenderAt,
          }
        : {
            consumerId: row.consumerId,
            consumerName: row.consumerName,
            lastRenderAt: row.lastRenderAt,
            renders30d: row.renders30d,
          },
    );
  }
  return [...byConsumer.values()].sort(
    (a, b) =>
      b.renders30d - a.renders30d ||
      b.lastRenderAt.localeCompare(a.lastRenderAt) ||
      a.consumerName.localeCompare(b.consumerName),
  );
}
