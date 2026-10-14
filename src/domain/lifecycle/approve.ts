// Approve.
//
//   approve        In review → the next stage, or Active at the last one (the previous Active → Superseded)

import {
  approvedThisRound,
  ownStages,
  stageOf,
  stageRecipients,
  type RecordedDecision,
} from "../approval-chain";
import { makerCheckerRefusal } from "../permissions";
import { refuse, type Refusal } from "../refusals";
import { outputsRefusal, viewedOutputs } from "../review-outputs";
import { reviewLink } from "../rounds";
import type { ApprovalStage, LifecycleEffect } from "../review-types";
import { unique, roundOf, notify } from "./helpers";
import { REFUSALS } from "./refusals";
import { sunsetOn, isAfterToday } from "./sunset";
import type { Ok, Outcome, ReviewVersion, ApprovalRecord } from "./types";

export interface ApproveChanges {
  /** "active" when this was the last of the version's own stages; otherwise the version stays in review. */
  state: "in_review" | "active";
  /** The next stage's position in its own stages; unchanged at the last stage (it records the stage that decided). */
  currentStage: number;
  activatedAt: Date | null;
}

export interface SupersedeChanges {
  state: "superseded";
  supersededAt: Date;
  /** Only when the approver set a sunset for the previous version in the same step. */
  sunsetAt?: Date;
  sunsetSetBy?: string;
}

export interface Approved {
  changes: ApproveChanges;
  approval: ApprovalRecord;
  /** The version that was Active, now Superseded. Present only when this approval went live over one. */
  previous?: { id: string; changes: SupersedeChanges };
  wentLive: boolean;
  effects: LifecycleEffect[];
}

export type ApproveResult = Outcome<Approved>;

/**
 * Two stages need two people: someone who approved a stage of this round (`approvedBy`, from
 * `approvedThisRound`) can't approve another. The approve transition and the decide check (`decideCheck`)
 * both ask this.
 */
export function approvedEarlierStage(
  actorId: string,
  approvedBy: readonly string[],
): Refusal | null {
  return approvedBy.includes(actorId) ? REFUSALS.approvedEarlierStage : null;
}

/**
 * The Active version an approval replaces when it goes live (`approve`'s `active`): the template's Active row,
 * unless it is the round being approved itself or has no number. Null when nothing is Active.
 */
export function replacedActive(
  active: { id: string; number: number | null } | null | undefined,
  round: { id: string },
): { id: string; number: number } | null {
  return active && active.id !== round.id && active.number !== null
    ? { id: active.id, number: active.number }
    : null;
}

/**
 * Approve the stage the version is waiting on. The version goes through its own stages (recorded at
 * submit), whatever the chain looks like now: at an earlier one it moves to the next; at its last it
 * goes live: Active, and the previous Active becomes Superseded (pinned consumers keep rendering it),
 * with an optional sunset date for it in the same step. Each stage's rule is the one its chain stage
 * has now (`stageOf`).
 *
 * The caller checks who may act on the stage (`canActOnStage`); this refuses anyone who wrote the
 * version (maker-checker: its `writers` and submitter), a version no longer in review, someone who
 * already approved a stage of it (`approvedThisRound`: two stages need two people), a stage missing
 * from the chain, an output of the version the approver hasn't viewed (`outputsRefusal`, decision 0037),
 * and a sunset date that isn't after today in the business time zone. The next stage's "review requested"
 * goes to nobody who approved a stage of it, this approver included. `sampleSetsSeen` records which
 * sample sets the approver previewed, and the audit row the outputs they viewed (keys only).
 */
export function approve(input: {
  version: ReviewVersion;
  chain: readonly ApprovalStage[];
  actorId: string;
  actorName: string;
  now: Date;
  /**
   * The template's Active version, which this one replaces when it goes live. Null for a first version
   * and after the Active version was revoked: nothing is superseded, and `sunsetPrevious` is ignored.
   */
  active: { id: string; number: number } | null;
  /** YYYY-MM-DD: the day the previous version stops rendering, at 00:00 in `zone`; null for none. */
  sunsetPrevious: string | null;
  /** The business time zone (`business-zone.ts`): what the sunset day and "today" are read in. */
  zone: string;
  sampleSetsSeen: readonly string[];
  /**
   * The outputs the approver has had rendered on screen in the Preview for this round (`OutputKey`s:
   * "pdf", "push.ios", …). Every output the version's channels have must be among them.
   */
  outputsViewed: readonly string[];
  templateName: string;
  /**
   * The round's decisions so far (its approvals rows). A row is one round: a change request sends the
   * next round in as a new row, so earlier rounds' approvals don't count here.
   */
  decisions?: readonly RecordedDecision[];
}): ApproveResult {
  const {
    version,
    chain,
    actorId,
    actorName,
    now,
    active,
    sunsetPrevious,
    zone,
    templateName,
  } = input;

  if (version.state !== "in_review") return refuse(REFUSALS.notInReview);
  const wrote = makerCheckerRefusal(actorId, version);
  if (wrote) return refuse(wrote);
  const approved = approvedThisRound(input.decisions ?? []);
  const earlier = approvedEarlierStage(actorId, approved);
  if (earlier) return refuse(earlier);
  const stages = ownStages(version.stages, chain);
  const index = version.currentStage;
  const stage = stageOf(stages, index, chain);
  if (!stage) return refuse(REFUSALS.stageMissing);
  const isLast = index === stages.length - 1;
  const next = isLast ? null : stageOf(stages, index + 1, chain);
  if (!isLast && !next) return refuse(REFUSALS.stageMissing);
  const unseen = outputsRefusal(version.channels, input.outputsViewed);
  if (unseen) return refuse(unseen);
  if (sunsetPrevious !== null && !isAfterToday(sunsetPrevious, now, zone))
    return refuse(REFUSALS.sunsetAfterToday);
  // What the approver looked at, for the audit row: output keys, never a value.
  const outputsViewed = viewedOutputs(version.channels, input.outputsViewed);

  const reviewed = roundOf(version);
  const { number, round } = reviewed;
  const approval: ApprovalRecord = {
    versionId: version.id,
    stageId: stage.id,
    stagePosition: stage.position,
    stageName: stage.name,
    actorId,
    decision: "approved",
    reason: null,
    sampleSetsSeen: unique(input.sampleSetsSeen),
    decidedAt: now,
  };
  const review = reviewLink(version.templateId, reviewed);
  const named = { templateName, number, round };

  // ── An earlier stage: on to the next one ──
  if (next) {
    const effects: LifecycleEffect[] = [
      {
        kind: "audit",
        action: "version.stage_approved",
        details: {
          number,
          round,
          stage: stage.name,
          stagePosition: stage.position,
          next: next.name,
          outputsViewed,
        },
      },
    ];
    // Not anyone who has approved a stage of this round, this approver included: they can't take this one.
    const asked = stageRecipients(next, version.writers, [
      ...approved,
      actorId,
    ]);
    if (asked) {
      effects.push(
        notify({
          notification: "review_requested",
          to: asked,
          facts: { actorName, ...named, stage: next.name },
          link: review,
        }),
      );
    }
    if (version.submittedBy) {
      effects.push(
        notify({
          notification: "stage_approved",
          to: { kind: "user", userId: version.submittedBy },
          facts: { actorName, ...named, stage: stage.name, next: next.name },
          link: review,
        }),
      );
    }
    return {
      ok: true,
      changes: {
        state: "in_review",
        currentStage: index + 1,
        activatedAt: null,
      },
      approval,
      wentLive: false,
      effects,
    };
  }

  // ── The last stage: the version goes live ──
  // The sunset goes on the version that is Active now (the action's compare-and-set checks it still is):
  // it is still rendering, so this starts a sunset and can't bring back one that has passed.
  const sunset =
    active && sunsetPrevious !== null ? sunsetOn(sunsetPrevious, zone) : null;
  const contractChanges = [...(version.contractChanges ?? [])];

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.activated",
      details: {
        number,
        round,
        supersedes: active?.number ?? null,
        stage: stage.name,
        outputsViewed,
      },
    },
  ];
  if (active) {
    effects.push({
      kind: "audit",
      action: "version.superseded",
      versionId: active.id,
      details: { number: active.number, supersededBy: number },
    });
  }
  if (active && sunset) {
    effects.push({
      kind: "audit",
      action: "version.sunset_set",
      versionId: active.id,
      details: {
        number: active.number,
        ...sunset.details,
        previousSunsetAt: null,
      },
    });
  }
  if (version.submittedBy) {
    effects.push(
      notify({
        notification: "version_live",
        to: { kind: "user", userId: version.submittedBy },
        // Released: the number consumers know, "v2", whichever round it was approved on.
        facts: { actorName, templateName, number },
        link: { to: "template", templateId: version.templateId },
      }),
    );
  }
  effects.push({
    kind: "consumer_notice",
    notice: "new_version",
    versionId: version.id,
    payload: {
      versionNumber: number,
      activeVersion: number,
      contractChanges,
    },
  });
  if (active && sunset) {
    effects.push({
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: active.id,
      payload: {
        versionNumber: active.number,
        activeVersion: number,
        sunsetAt: sunset.details.sunsetAt,
        sunsetDay: sunset.details.sunsetDay,
        zone: sunset.details.zone,
        contractChanges,
      },
    });
  }

  const result: Ok<Approved> = {
    ok: true,
    changes: { state: "active", currentStage: index, activatedAt: now },
    approval,
    wentLive: true,
    effects,
  };
  if (active) {
    result.previous = {
      id: active.id,
      changes: sunset
        ? {
            state: "superseded",
            supersededAt: now,
            sunsetAt: sunset.at,
            sunsetSetBy: actorId,
          }
        : { state: "superseded", supersededAt: now },
    };
  }
  return result;
}
