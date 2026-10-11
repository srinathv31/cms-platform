// What the review screen's decision dialogs and the decision rail decide, as pure functions: whether
// an approval is the last stage, the consequence lines the Approve dialog shows (recomputed as the
// sunset date changes), what a reason may be, and what stands in place of the buttons once the version
// has been decided. No React, so they are tested without the screen.

import { breakingKeysOf, consequences } from "@/domain/consequences";
import { formatCount } from "@/domain/numbers";
import { outputsRefusal } from "@/domain/review-outputs";
import type { ConsumerUsage, StepView } from "@/domain/review-types";
import { versionLabel, type NumberedRound } from "@/domain/rounds";
import type { Channel, ContractChange, PermissionResult, VersionState } from "@/domain/types";

/** The longest reason the server accepts (actions/review.ts). */
export const REASON_MAX = 2000;

/** Whether a change request can be sent as it stands: it has a reason, and not too long a one. */
export function reasonReady(reason: string): boolean {
  const length = reason.trim().length;
  return length > 0 && length <= REASON_MAX;
}

/**
 * What is wrong with a reason that can be put in words: too long. An empty reason says nothing (the field
 * is required, and its label says so); the dialog just doesn't send it.
 */
export function reasonProblem(reason: string): string | null {
  return reason.trim().length > REASON_MAX ? `Keep the reason under ${formatCount(REASON_MAX)} characters.` : null;
}

// ── Who may decide ───────────────────────────────────────────────────────────

/**
 * What the decision area shows this viewer:
 * - open: Approve and Request changes are theirs to press;
 * - blocked: the pair is there, dim, and `reason` says why. Either they wrote this version (maker-checker:
 *   the submitter or another writer, Approver or not, since a self-block explains itself to anyone on the
 *   team), or they are an approver and it isn't theirs to decide (the stage waits on someone else);
 * - hidden: they aren't an approver on the team and wrote none of it, so there is nothing to decide and no
 *   dead buttons. That is the refusal coded `generic` (no role gives them the decision); every other code
 *   is blocked. It reads the code, never the sentence, so rewording a refusal changes nothing here.
 */
export type DecisionAccess = { kind: "open" } | { kind: "blocked"; reason: string } | { kind: "hidden" };

export function decisionAccess(approve: PermissionResult, requestChanges: PermissionResult): DecisionAccess {
  const refused = !approve.ok ? approve : !requestChanges.ok ? requestChanges : null;
  if (!refused) return { kind: "open" };
  return refused.code === "generic" ? { kind: "hidden" } : { kind: "blocked", reason: refused.reason };
}

/**
 * Why Approve alone isn't available yet: an output of the round the viewer hasn't had on screen in the
 * Preview (decision 0037), in the domain's sentence, the one the server refuses with; or, for an output
 * the Preview saw the render refuse (`cannotShow`), that it can't be shown and the version needs changes.
 * Only while the pair is otherwise theirs to press and the round is in review; Request changes never
 * waits on it. Null once every output has been viewed.
 */
export function approveWaitsOn(
  access: DecisionAccess,
  version: { state: VersionState; channels: readonly Channel[] },
  viewed: readonly string[],
  cannotShow: readonly string[] = [],
): string | null {
  if (access.kind !== "open" || version.state !== "in_review") return null;
  return outputsRefusal(version.channels, viewed, cannotShow)?.reason ?? null;
}

// ── Approving ────────────────────────────────────────────────────────────────

export interface ApprovalStageInfo {
  /** The stage the version waits on, or null when it waits on none (it isn't in review). */
  current: StepView | null;
  /** The stage after it, when this approval is not the last. */
  next: StepView | null;
  /** This approval completes the chain: the version goes Active (and the previous one can be sunset). */
  final: boolean;
}

export function approvalStage(steps: readonly StepView[]): ApprovalStageInfo {
  const index = steps.findIndex((step) => step.status === "current");
  if (index < 0) return { current: null, next: null, final: false };
  const next = steps[index + 1] ?? null;
  return { current: steps[index], next, final: next === null };
}

export interface ApproveLinesInput {
  /** The round being approved (in review): an earlier stage names it ("v3, round 2 moves to …"). */
  version: NumberedRound;
  /** The Active version this one replaces; null when nothing is Active yet. */
  previousNumber: number | null;
  /**
   * With nothing Active (after a revoke), the newest version that still renders, which consumers move from
   * (`ReviewScreenData.stillRenders`), with the version's contract changes against it. Null for a first version.
   */
  stillRenders?: { number: number; sunsetDay: string | null; contractChanges: readonly ContractChange[] } | null;
  stage: ApprovalStageInfo;
  /** YYYY-MM-DD: the sunset date chosen for the previous version, or null (it keeps rendering until relinked). */
  sunset: string | null;
  /**
   * The version's contract changes as submit stored them, against the Active version it replaces: the
   * breaking ones say what its consumers have to map. With nothing Active they are `stillRenders`' own.
   */
  contractChanges?: readonly ContractChange[];
  usage: readonly ConsumerUsage[];
  /** The demo clock's instant. */
  nowIso: string;
}

/**
 * The lines under "Approve v3, round 2". The last stage says what goes live and who is affected (the
 * domain's `consequences`, from the render log), in released numbers: consumers never see a round. An
 * earlier stage only moves the round along: nothing goes live, so a sunset date is never part of it.
 */
export function approveLines({
  version,
  previousNumber,
  stillRenders = null,
  stage,
  sunset,
  contractChanges = [],
  usage,
  nowIso,
}: ApproveLinesInput): string[] {
  if (!stage.final) {
    const next = stage.next?.name ?? "the next stage";
    const v = versionLabel(version, { style: "sentence" });
    return [`${v} moves to ${next} for approval. It isn't Active until the last stage approves.`];
  }
  // With nothing Active the consumers move from the version that still renders, so what they have to map is
  // this version's changes against it, not the ones submit stored against a version revoked since.
  const from = previousNumber === null ? stillRenders : null;
  return consequences(
    {
      kind: "approve",
      newNumber: version.number,
      previousNumber,
      sunsetAt: previousNumber === null ? null : sunset,
      stillRenders: from ? { number: from.number, sunsetAt: from.sunsetDay } : null,
      breakingKeys: breakingKeysOf(from ? from.contractChanges : contractChanges),
    },
    usage,
    new Date(nowIso),
  );
}

// ── After the decision ───────────────────────────────────────────────────────

/** What this viewer just did on this screen. The server's data is the truth; this words it as "You …". */
export type LocalDecision =
  | { kind: "approved"; wentLive: boolean; nextStage: string | null }
  | { kind: "returned" }
  | null;

/**
 * What stands in the decision row, under the stepper:
 * - buttons: the round is in review, and Approve and Request changes belong there (the access says whether
 *   they are the viewer's to press, greyed, or absent).
 * - line: one sentence where they were, once the version has been decided or isn't in review. A round
 *   that isn't in review is a read-only record. The version reads as its label in its state now: "You
 *   returned v1, round 1 to Maya Chen.", "v3 is Active."
 * - sentBack: a round sent back before. Its returned stage in the stepper already says who sent it back
 *   and when, and the header's badge that changes were requested (the reason stays in the resolved
 *   change-request thread), so the row adds no sentence: only the link to where its work went, when it
 *   went somewhere.
 */
export type DecisionRow = { kind: "buttons" } | { kind: "line"; text: string } | { kind: "sentBack" };

export function decisionRow({
  version,
  authorName,
  local,
  canDecideAgain,
}: {
  /** The round on screen, in the state it is in now. */
  version: NumberedRound;
  authorName: string;
  local: LocalDecision;
  /** The server says this viewer may decide the version's current stage. */
  canDecideAgain: boolean;
}): DecisionRow {
  const v = versionLabel(version, { style: "sentence" });
  const line = (text: string): DecisionRow => ({ kind: "line", text });
  switch (version.state) {
    case "in_review":
      // Approved an earlier stage and has no say on the next: say so instead of a dead pair of buttons.
      if (local?.kind === "approved" && !local.wentLive && !canDecideAgain) {
        return line(local.nextStage ? `You approved this stage. ${local.nextStage} is next.` : "You approved this stage.");
      }
      return { kind: "buttons" };
    case "changes_requested":
      // Right after the viewer sent it back, it is theirs.
      return local?.kind === "returned" ? line(`You returned ${v} to ${authorName}.`) : { kind: "sentBack" };
    case "active":
      return line(local?.kind === "approved" && local.wentLive ? `You approved ${v}.` : `${v} is Active.`);
    case "superseded":
      return line(`${v} is Superseded.`);
    case "revoked":
      return line(`${v} is Revoked.`);
    case "draft":
      return { kind: "buttons" };
  }
}
