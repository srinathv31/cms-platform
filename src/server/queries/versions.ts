import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { describeChanges } from "@/domain/contract";
import type { VersionActions } from "@/domain/lifecycle/version-actions";
import type { ConsumerUsage, Person } from "@/domain/review-types";
import {
  approvedOnRound,
  asNumbered,
  roundsOf,
  versionLabel,
} from "@/domain/rounds";
import type { ContractChange, VersionState } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type {
  DecisionFacts,
  VersionFacts,
  VersionHistory,
} from "@/server/services/versions";
import type { SunsetCalendar } from "./review-models";
import { peopleById, personOf } from "@/domain/people";
import { requireSpace } from "./spaces";

// The Versions tab: the template's versions as a timeline, with what the viewer may do on each. A number
// is one entry, its head (domain/rounds.ts `headOf`: the released row, else the latest round), carrying
// every round of it as its review history.
//
// The facts and the decisions come from the service (`services().versions.history`, decision 0070); this
// read model words them and lays them out: version labels, contract lines, people, and the timeline's
// grouping by number. It decides nothing.

/** One round of a number in the Versions tab's review history, and how it was decided. */
export interface RoundHistoryItem {
  id: string;
  round: number;
  state: VersionState;
  submittedAt?: string;
  submittedBy: Person;
  /** The round's closing decision (its last approvals row); none while it is in review. */
  decision?: {
    kind: "approved" | "changes_requested";
    by: Person;
    at: string;
    stageName: string;
    reason?: string;
  };
}

/**
 * One entry of the Versions tab: the open draft, or a number shown as its head (its released row, else
 * its latest round), with every round of it in `rounds`.
 */
export interface VersionTimelineItem {
  id: string;
  number: number | null; // null for the open draft
  /** The head's round; null for the open draft. */
  round: number | null;
  /** "v3 · Round 2" (chrome, no history: `versionLabel`); null for the open draft. */
  label: string | null;
  /** "Approved on round 3" (`approvedOnRound`); null unless released after a send-back. */
  approvedOnRound: string | null;
  /** Every round of the number, newest first; null when it has one round (or for the open draft). */
  rounds: RoundHistoryItem[] | null;
  state: VersionState;
  createdAt: string;
  author: Person;
  submittedAt?: string;
  submitNote?: string | null;
  activatedAt?: string;
  supersededAt?: string;
  /** YYYY-MM-DD: the sunset's day in the business time zone (it stops renders at 00:00 then). */
  sunsetDay?: string;
  sunsetPassed: boolean;
  revoke?: {
    reason: string;
    startedBy: Person;
    startedAt: string;
    confirmedBy?: Person;
    confirmedAt?: string;
  };
  contractLines: string[];
  /** The same lines, one per change, each flagged breaking or not (`contractLines` stays for compatibility). */
  contractItems: { text: string; breaking: boolean }[];
  decisions: {
    kind: "approved" | "changes_requested";
    stageName: string;
    by: Person;
    at: string;
    reason?: string;
  }[];
  /** Non-preview renders. */
  lastRenderAt: string | null;
  renders30d: number;
  /** What the viewer may do on this version right now (the reason is shown when blocked). */
  can: VersionActions;
}

/** One version Compare can pick: any row, every round included. */
export interface CompareOption {
  id: string;
  /** "Draft" for the open draft, else `versionLabel` (chrome, with history): "v2", "v3 · Round 1". */
  label: string;
  state: VersionState;
  /**
   * The row the Versions timeline shows for its number (its head: the released row, else the latest
   * round), or the open draft. Compare opens on the two newest of these; the other rounds stay selectable.
   */
  head: boolean;
}

export interface VersionsData {
  template: { id: string; name: string; teamSlug: string };
  items: VersionTimelineItem[]; // newest first; the open draft first when there is one
  /** Every row, rounds included, newest first, "Draft" first when there is one. */
  compareOptions: CompareOption[];
  consumerUsage: ConsumerUsage[];
  /** The sunset dialog's picker. */
  sunsetCalendar: SunsetCalendar;
  /** ISO: the backend's instant the facts were decided at (`asOf`); the timeline counts its dates from it. */
  now: string;
}

/**
 * One line per change, each with its own change's breaking flag (worded one at a time, so a line's flag
 * never depends on how the sentences are grouped). Same order as `describeChanges`.
 */
export function contractItems(
  changes: readonly ContractChange[],
  versionNumber: number,
): VersionTimelineItem["contractItems"] {
  return changes.flatMap((change) =>
    describeChanges([change], versionNumber).map((text) => ({
      text,
      breaking: change.breaking,
    })),
  );
}

/**
 * `/{team}/templates/{id}/versions`: the open draft on top, then one entry per number, newest first. Compare
 * offers every row, rounds included (`compareOptions`). Not found when the template isn't in the URL's
 * space or isn't the viewer's to see.
 */
export const getVersions = cache(
  async (spaceSlug: string, templateId: string): Promise<VersionsData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const history = await services().versions.history(ctx, { templateId });
    // All teams holds every team's templates; a team's space only its own.
    if (
      !history.ok ||
      (space.teamId !== null && history.template.teamId !== space.teamId)
    )
      notFound();
    return versionsData(history);
  },
);

/** The Versions tab from the service's facts: each number once, as its head, with labels, lines and people. */
export function versionsData(history: VersionHistory): VersionsData {
  const people = peopleById(history.people);
  // Every row, the open draft first, then newest first (the service's order).
  const rows = history.versions;

  const compareOptions: CompareOption[] = rows.map((v) => ({
    id: v.id,
    label:
      v.number === null
        ? "Draft"
        : versionLabel(asNumbered(v), { history: true }),
    state: v.state,
    head: v.head,
  }));

  const decision = (d: DecisionFacts) => ({
    kind: d.kind,
    stageName: d.stageName,
    by: personOf(people, d.by),
    at: d.at,
    ...(d.reason ? { reason: d.reason } : {}),
  });

  /** A round as the review history lists it, with its closing decision (its last approvals row) once decided. */
  const roundItem = (v: VersionFacts): RoundHistoryItem => {
    const last = v.state === "in_review" ? undefined : v.decisions.at(-1);
    return {
      id: v.id,
      round: asNumbered(v).round,
      state: v.state,
      ...(v.submittedAt ? { submittedAt: v.submittedAt } : {}),
      submittedBy: personOf(people, v.submittedBy ?? v.createdBy),
      ...(last ? { decision: decision(last) } : {}),
    };
  };

  const items = rows
    .filter((v) => v.head)
    .map((v): VersionTimelineItem => {
      const head = v.number === null ? null : asNumbered(v);
      const rounds = v.number === null ? [] : roundsOf(rows, v.number);
      const item: VersionTimelineItem = {
        id: v.id,
        number: head?.number ?? null,
        round: head?.round ?? null,
        label: head ? versionLabel(head) : null,
        approvedOnRound: head ? approvedOnRound(head) : null,
        rounds: rounds.length > 1 ? rounds.map(roundItem) : null,
        state: v.state,
        createdAt: v.createdAt,
        author: personOf(people, v.submittedBy ?? v.createdBy),
        sunsetPassed: v.sunsetPassed,
        contractLines:
          v.number !== null && v.contractChanges
            ? describeChanges(v.contractChanges, v.number)
            : [],
        contractItems:
          v.number !== null && v.contractChanges
            ? contractItems(v.contractChanges, v.number)
            : [],
        decisions: v.decisions.map(decision),
        lastRenderAt: v.lastRenderAt,
        renders30d: v.renders30d,
        can: v.can,
      };
      if (v.submittedAt) {
        item.submittedAt = v.submittedAt;
        item.submitNote = v.submitNote;
      }
      if (v.activatedAt) item.activatedAt = v.activatedAt;
      if (v.supersededAt) item.supersededAt = v.supersededAt;
      if (v.sunsetDay) item.sunsetDay = v.sunsetDay;
      if (v.revoke) {
        item.revoke = {
          reason: v.revoke.reason,
          startedBy: personOf(people, v.revoke.startedBy),
          startedAt: v.revoke.startedAt,
          ...(v.revoke.confirmedBy
            ? { confirmedBy: personOf(people, v.revoke.confirmedBy) }
            : {}),
          ...(v.revoke.confirmedAt
            ? { confirmedAt: v.revoke.confirmedAt }
            : {}),
        };
      }
      return item;
    });

  return {
    template: {
      id: history.template.id,
      name: history.template.name,
      teamSlug: history.template.teamSlug,
    },
    items,
    compareOptions,
    consumerUsage: history.consumerUsage,
    sunsetCalendar: history.sunsetCalendar,
    now: history.asOf,
  };
}
