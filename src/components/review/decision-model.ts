// What the review screen's decision dialogs and the decision rail decide, as pure functions: whether
// an approval is the last stage, the consequence lines the Approve dialog shows (recomputed as the
// sunset date changes), what a reason may be, and the line that replaces the buttons once the version
// has been decided. No React, so they are tested without the screen.

import { breakingKeysOf, consequences } from "@/domain/consequences";
import { REASONS } from "@/domain/permissions";
import type { ConsumerUsage, StepView } from "@/domain/review-types";
import type { ContractChange, PermissionResult, VersionState } from "@/domain/types";

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
  return reason.trim().length > REASON_MAX ? `Keep the reason under ${REASON_MAX.toLocaleString("en-US")} characters.` : null;
}

// ── Who may decide ───────────────────────────────────────────────────────────

/**
 * What the decision area shows this viewer:
 * - open: Approve and Request changes are theirs to press;
 * - blocked: they are an approver, but not for this version (it is their own: maker-checker; or the stage
 *   waits on someone else): the pair is there, dim, and `reason` says why;
 * - hidden: they aren't an approver on the team at all, so there is nothing to decide and no dead buttons.
 */
export type DecisionAccess = { kind: "open" } | { kind: "blocked"; reason: string } | { kind: "hidden" };

export function decisionAccess(approve: PermissionResult, requestChanges: PermissionResult): DecisionAccess {
  if (approve.ok && requestChanges.ok) return { kind: "open" };
  const reason = !approve.ok ? approve.reason : !requestChanges.ok ? requestChanges.reason : "";
  return reason === REASONS.generic ? { kind: "hidden" } : { kind: "blocked", reason };
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
  versionNumber: number;
  /** The Active version this one replaces; null when nothing is Active yet. */
  previousNumber: number | null;
  stage: ApprovalStageInfo;
  /** YYYY-MM-DD: the sunset date chosen for the previous version, or null (it keeps rendering until relinked). */
  sunset: string | null;
  /** The version's contract changes against the Active one: the breaking ones say what its consumers have to map. */
  contractChanges?: readonly ContractChange[];
  usage: readonly ConsumerUsage[];
  /** The demo clock's instant. */
  nowIso: string;
}

/**
 * The lines under "Approve vN". The last stage says what goes live and who is affected (the domain's
 * `consequences`, from the render log). An earlier stage only moves the version along: nothing goes
 * live, so a sunset date is never part of it.
 */
export function approveLines({ versionNumber, previousNumber, stage, sunset, contractChanges = [], usage, nowIso }: ApproveLinesInput): string[] {
  const v = `v${versionNumber}`;
  if (!stage.final) {
    const next = stage.next?.name ?? "the next stage";
    return [`${v} moves to ${next} for approval. It isn't Active until the last stage approves.`];
  }
  return consequences(
    {
      kind: "approve",
      newNumber: versionNumber,
      previousNumber,
      sunsetAt: previousNumber === null ? null : sunset,
      breakingKeys: breakingKeysOf(contractChanges),
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
 * The one line that stands where Approve and Request changes were, or null when the buttons still
 * belong there (the version is in review). A version that isn't in review is a read-only record.
 */
export function decisionLine({
  state,
  number,
  authorName,
  local,
  canDecideAgain,
}: {
  state: VersionState;
  number: number;
  authorName: string;
  local: LocalDecision;
  /** The server says this viewer may decide the version's current stage. */
  canDecideAgain: boolean;
}): string | null {
  const v = `v${number}`;
  switch (state) {
    case "in_review":
      // Approved an earlier stage and has no say on the next: say so instead of a dead pair of buttons.
      if (local?.kind === "approved" && !local.wentLive && !canDecideAgain) {
        return local.nextStage ? `You approved this stage. ${local.nextStage} is next.` : "You approved this stage.";
      }
      return null;
    case "changes_requested":
      return local?.kind === "returned" ? `You returned ${v} to ${authorName}.` : "Changes requested.";
    case "active":
      return local?.kind === "approved" && local.wentLive ? `You approved ${v}.` : `${v} is Active.`;
    case "superseded":
      return `${v} is Superseded.`;
    case "revoked":
      return `${v} is Revoked.`;
    case "draft":
      return null;
  }
}
