// Request changes.
//
//   requestChanges In review → Changes requested, plus a new Draft carrying the block ids (and so the
//                  threads); its submit is the next round of the same number

import { currentStageOf } from "../approval-chain";
import { makerCheckerRefusal } from "../permissions";
import { refuse } from "../refusals";
import { DOCUMENT_THREAD, type ApprovalStage, type LifecycleEffect } from "../review-types";
import { copyToDraft } from "./drafts";
import { roundOf, sentence, trimmed, notify } from "./helpers";
import { REFUSALS } from "./refusals";
import type { DraftFields, Outcome, ReviewVersion, ApprovalRecord, ReasonComment } from "./types";

export type RequestChangesResult = Outcome<{
  changes: { state: "changes_requested" };
  approval: ApprovalRecord;
  /** The author's next draft: the version's content with the SAME block ids, so the threads re-anchor. */
  newDraft: DraftFields;
  reasonComment: ReasonComment;
  effects: LifecycleEffect[];
}>;

/**
 * In review → Changes requested (kept read-only as a record), with a new Draft copied from it for the
 * author. Approver, never someone who wrote it (`makerCheckerRefusal`); the reason is required and
 * becomes a comment. The new draft keeps the version's writers, so they stay barred from deciding the
 * next round; the approver who sent it back joins them only by editing it. Resubmitting the draft is
 * the next round of the same number (`nextRound`): a send-back doesn't use up a version number.
 */
export function requestChanges(input: {
  version: ReviewVersion;
  chain: readonly ApprovalStage[];
  actorId: string;
  actorName: string;
  reason: string;
  now: Date;
  templateName: string;
}): RequestChangesResult {
  const { version, actorId, now } = input;

  if (version.state !== "in_review") return refuse(REFUSALS.notInReview);
  const wrote = makerCheckerRefusal(actorId, version);
  if (wrote) return refuse(wrote);
  const stage = currentStageOf(version, input.chain);
  if (!stage) return refuse(REFUSALS.stageMissing);
  const reason = trimmed(input.reason);
  if (!reason) return refuse(REFUSALS.giveReason);

  const { number, round } = roundOf(version);
  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.changes_requested",
      details: { number, round, stage: stage.name, reason },
    },
  ];
  if (version.submittedBy) {
    // Labelled as it is now, sent back: "v1, round 1".
    const sentBack = sentence({ number, round, state: "changes_requested" });
    effects.push(
      notify({
        notification: "changes_requested",
        to: { kind: "user", userId: version.submittedBy },
        title: `${input.actorName} requested changes on ${input.templateName} ${sentBack}.`,
        body: reason,
        link: { to: "template", templateId: version.templateId },
      }),
    );
  }

  return {
    ok: true,
    changes: { state: "changes_requested" },
    approval: {
      versionId: version.id,
      stageId: stage.id,
      stagePosition: stage.position,
      stageName: stage.name,
      actorId,
      decision: "changes_requested",
      reason,
      sampleSetsSeen: null,
      decidedAt: now,
    },
    // The draft is the author's to fix, so it is theirs, not the approver's. Its writers are the version's.
    newDraft: copyToDraft(version, version.submittedBy ?? actorId, now, version.writers),
    reasonComment: { blockId: DOCUMENT_THREAD, body: reason, kind: "change_request" },
    effects,
  };
}
