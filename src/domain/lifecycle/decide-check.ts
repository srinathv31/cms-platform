// May the viewer decide (approve, or request changes on) a version at its current stage? The review queue, the
// review screen and the actions all ask this one question; the approve and request-changes transitions refuse by
// the same rules when they run.

import {
  canActOnStage,
  currentStageOf,
  stageApproverIds,
} from "../approval-chain";
import { can } from "../permissions";
import { refuse, type Refused } from "../refusals";
import type { ApprovalStage, VersionStage } from "../review-types";
import type {
  PermissionResource,
  PermissionResult,
  VersionState,
  Viewer,
} from "../types";
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

/** What the two decide commands read of the round to check who may decide it. */
export interface DecidedRound {
  state: VersionState;
  submittedBy: string | null;
  writers: readonly string[];
  stages: readonly VersionStage[] | null;
  currentStage: number;
}

/**
 * The resource the approve and request-changes commands ask `can("version.decide")` about, before anything else:
 * the team, who submitted and wrote the round (maker-checker), and, while it is in review, the users the stage it
 * waits on names (they decide it on any team). A round no longer in review names nobody; its transition then
 * refuses it in its own words (`not_in_review`).
 */
export function decideResource(
  teamId: string,
  round: DecidedRound,
  chain: readonly ApprovalStage[],
): PermissionResource {
  return {
    teamId,
    submittedBy: round.submittedBy,
    writers: round.writers,
    stageApproverIds:
      round.state === "in_review"
        ? stageApproverIds(currentStageOf(round, chain))
        : [],
  };
}

/**
 * The stage's own rule, asked once the command has read the round again inside its transaction: is the viewer
 * whom the stage it waits on names now (`canActOnStage`)? Null when there is nothing to ask: a round no longer in
 * review, or a stage that has left the chain (the transitions refuse those, `not_in_review` and `stage_missing`).
 */
export function stageRefusal(
  viewer: Viewer,
  chain: readonly ApprovalStage[],
  round: Pick<DecidedRound, "state" | "stages" | "currentStage">,
  teamId: string,
): Refused | null {
  if (round.state !== "in_review") return null;
  const stage = currentStageOf(round, chain);
  if (!stage) return null;
  const onStage = canActOnStage(viewer, stage, teamId);
  return onStage.ok ? null : onStage;
}
