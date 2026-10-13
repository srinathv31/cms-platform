import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { stepperState } from "@/domain/approval-chain";
import { describeChanges } from "@/domain/contract";
import { utcDay } from "@/domain/dates";
import { versionLabel } from "@/domain/rounds";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type {
  QueueRow,
  ReviewQueueFacts,
  ReviewScreenFacts,
} from "@/server/services/review-reads";
import { personOf, type People } from "./people";
import type {
  ReviewQueue,
  ReviewQueueRow,
  ReviewScreenData,
} from "./review-models";
import { requireSpace } from "./spaces";
import { threadViews } from "./threads";

// The review queue and the review screen. The review service decides (which rounds wait on the viewer, which
// round a URL opens, the baselines, what the viewer may do: services/review-reads.ts); these read models word
// and lay its facts out: people, version labels, contract lines, the stepper. They decide nothing.

// ── Queue ─────────────────────────────────────────────────────

/**
 * The three tabs of `/{team}/review`. Each row is a round: a number sent back and resubmitted has a row per
 * round. Waiting and submitted are newest submitted first; decided, newest decision first.
 */
export const getReviewQueue = cache(
  async (spaceSlug: string): Promise<ReviewQueue> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const queue = await services().review.queue(ctx, { teamId: space.teamId });
    if (!queue.ok) notFound();
    return reviewQueueData(queue);
  },
);

/** The sidebar badge: how many rounds wait on the viewer in the space. */
export const getReviewBadgeCount = cache(
  async (spaceSlug: string): Promise<number> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const badge = await services().review.badgeCount(ctx, {
      teamId: space.teamId,
    });
    return badge.ok ? badge.count : 0;
  },
);

/** The review queue from the service's facts: each row with its author, the lists in the order the tabs show. */
export function reviewQueueData(queue: ReviewQueueFacts): ReviewQueue {
  const people: People = new Map(queue.people.map((p) => [p.id, p]));
  const row = (r: QueueRow): ReviewQueueRow => ({
    templateId: r.templateId,
    templateName: r.templateName,
    teamSlug: r.teamSlug,
    teamName: r.teamName,
    versionId: r.versionId,
    versionNumber: r.round.number,
    round: r.round.round,
    state: r.round.state,
    author: personOf(people, r.authorId),
    submittedAt: r.submittedAt,
    stage: r.stage,
    breaking: r.breaking,
  });
  const newestSubmitted = (a: ReviewQueueRow, b: ReviewQueueRow) =>
    b.submittedAt.localeCompare(a.submittedAt) ||
    a.templateName.localeCompare(b.templateName);
  return {
    waiting: queue.waiting.map(row).sort(newestSubmitted),
    submitted: queue.submitted.map(row).sort(newestSubmitted),
    decided: queue.decided.map((r) => ({
      ...row(r),
      decision: {
        kind: r.decision.kind,
        by: personOf(people, r.decision.by),
        at: r.decision.at,
      },
    })),
    now: queue.asOf,
  };
}

// ── Review screen ─────────────────────────────────────────────

/**
 * Everything `/{team}/review/{templateId}/{n}?round=N` shows: that round, or without a round (null) the round
 * the service opens for the viewer (the number's head, or for a stage reviewer from outside the team the newest
 * round they may open). Not found when there is none.
 */
export const getReviewScreen = cache(
  async (
    spaceSlug: string,
    templateId: string,
    versionNumber: number,
    round: number | null,
  ): Promise<ReviewScreenData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const screen = await services().review.screen(ctx, {
      teamId: space.teamId,
      templateId,
      versionNumber,
      round,
    });
    if (!screen.ok) notFound();
    return reviewScreenData(screen, ctx.viewer.userId);
  },
);

/**
 * The review screen from the service's facts: its people, its contract lines, the stepper, the threads, and
 * the labels. `viewerId` is who is looking (their own comments show under their name at once).
 */
export function reviewScreenData(
  screen: ReviewScreenFacts,
  viewerId: string,
): ReviewScreenData {
  const people: People = new Map(screen.people.map((p) => [p.id, p]));
  const { version } = screen;
  return {
    template: screen.template,
    version: {
      id: version.id,
      number: version.number,
      round: version.round,
      state: version.state,
      name: version.name,
      body: version.body,
      variables: version.variables,
      channels: version.channels,
      sampleSets: version.sampleSets,
      channelFields: version.channelFields,
      smsFooter: version.smsFooter,
      submittedBy: personOf(people, version.submittedBy),
      submittedAt: version.submittedAt,
      submitNote: version.submitNote,
      sunsetDay: version.sunsetDay,
      sunsetPassed: version.sunsetPassed,
      contractChanges: version.contractChanges,
      contractLines: describeChanges(version.contractChanges, version.number),
    },
    baseline: screen.baseline,
    previousNumber: screen.previousNumber,
    stillRenders: screen.stillRenders,
    replacedBy: screen.replacedBy
      ? {
          ...screen.replacedBy,
          label: versionLabel(screen.replacedBy, { style: "sentence" }),
        }
      : null,
    liveName: screen.liveName,
    steps: stepperState(
      version.stages,
      version.decisions.map((d) => ({
        stageId: d.stageId,
        decision: d.kind,
        by: personOf(people, d.by),
        at: d.at,
      })),
      version,
    ),
    threads: threadViews(screen.threads, people),
    can: screen.can,
    consumerUsage: screen.consumerUsage,
    now: screen.asOf,
    today: utcDay(screen.asOf),
    viewer: personOf(people, viewerId),
    sunsetCalendar: screen.sunsetCalendar,
    messageRules: screen.messageRules,
    senders: screen.senders,
  };
}
