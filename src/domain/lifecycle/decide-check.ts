// May the viewer decide (approve, or request changes on) a version at its current stage? The review queue, the
// review screen and the actions all ask this one question; the approve and request-changes transitions refuse by
// the same rules when they run.

import { canActOnStage, stageApproverIds } from "../approval-chain";
import { can } from "../permissions";
import { refuse } from "../refusals";
import type { ApprovalStage } from "../review-types";
import type { PermissionResult, Viewer } from "../types";
import { approvedEarlierStage } from "./approve";
import { REFUSALS } from "./refusals";

/**
 * The role grant (or being named on the stage) and maker-checker (its submitter and `writers`) come from
 * `can("version.decide")`; the stage's own rule from `canActOnStage` (`stage` is null when the stage it waits on
 * has left the chain). With `approvedBy` (the approve check, from `approvedThisRound`), someone who already
 * approved a stage of the version is refused (`approvedEarlierStage`, as `approve` refuses them).
 */
export function decideCheck(
  viewer: Viewer,
  input: {
    teamId: string;
    submittedBy: string | null;
    writers: readonly string[];
    stage: ApprovalStage | null;
    approvedBy?: readonly string[];
  },
): PermissionResult {
  const permitted = can(viewer, "version.decide", {
    teamId: input.teamId,
    submittedBy: input.submittedBy,
    writers: input.writers,
    stageApproverIds: stageApproverIds(input.stage),
  });
  if (!permitted.ok) return permitted;
  if (!input.stage) return refuse(REFUSALS.stageMissing);
  const onStage = canActOnStage(viewer, input.stage, input.teamId);
  if (!onStage.ok) return onStage;
  const earlier = approvedEarlierStage(viewer.userId, input.approvedBy ?? []);
  return earlier ? refuse(earlier) : onStage;
}
