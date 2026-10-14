// Who sees what in review: which round a review URL opens for the viewer (and whether they may open a round at
// all), which in-review rounds wait on them (the review queue), and what they may do on a round's review screen.
// The review service decides these behind the service interfaces (decision 0070) and answers the outcome as
// facts; the BFF only lays them out.
//
// A screen is opened from a space: a team (by its id) or All teams (null). The template's own team sees its
// rounds in its space, and All teams sees every team's. A stage that names a person ("Legal reviewer")
// lets them in from outside the team, in any space: while the round waits on that stage, and once they have
// decided it.

import {
  approvedThisRound,
  stageApproverIds,
  type RecordedDecision,
} from "./approval-chain";
import { canComment } from "./comments";
import { decideCheck } from "./lifecycle/decide-check";
import { REFUSALS } from "./lifecycle/refusals";
import { can, canSeeSpace } from "./permissions";
import { refuse } from "./refusals";
import type { ApprovalStage } from "./review-types";
import { headOf, roundsOf } from "./rounds";
import type { PermissionResult, VersionState, Viewer } from "./types";

// ── Opening a round ──────────────────────────────────────────

/** What deciding who may open a round reads of it. */
export interface RoundAccessFacts {
  number: number;
  round: number;
  state: VersionState;
  /** The users the stage it waits on names (`stageApproverIds`); read only while it is in review. */
  stageApproverIds: readonly string[];
  /** Who has decided it (its approvals' actors). */
  decidedBy: readonly string[];
}

/** The space a screen is opened from (`teamId` null: All teams) and the template's team. */
export interface ReviewPlace {
  spaceTeamId: string | null;
  teamId: string;
}

/**
 * Whether the viewer may open this round's review screen from the space: the template is in the space and the
 * viewer sees its team, or a stage names them (`namedOnRound`). A screen links to another round only when this
 * holds, so it never links to a Not found.
 */
export function mayOpenRound(
  viewer: Viewer,
  place: ReviewPlace,
  round: RoundAccessFacts,
): boolean {
  const inSpace =
    place.spaceTeamId === null || place.spaceTeamId === place.teamId;
  if (inSpace && canSeeSpace(viewer, place.teamId)) return true;
  return namedOnRound(viewer, place.teamId, round);
}

/**
 * Someone a stage names, from any team: they may open the round while it waits on their stage, and keep seeing
 * it once they have decided it.
 */
function namedOnRound(
  viewer: Viewer,
  teamId: string,
  round: RoundAccessFacts,
): boolean {
  if (
    round.state === "in_review" &&
    can(viewer, "template.view", {
      teamId,
      stageApproverIds: round.stageApproverIds,
    }).ok
  )
    return true;
  return round.decidedBy.includes(viewer.userId);
}

/**
 * The round `/{space}/review/{templateId}/{number}?round=N` opens for the viewer, or null for Not found. With a
 * round, exactly that one. Without (`round` null), the number's head (`headOf`: its released row, else its
 * latest round), the round every link names until the number is sent back.
 *
 * A bare link stored before a send-back (the notification that asked them, a comment's link) names no round.
 * Once the next round is in review at a stage that doesn't name them, the head is closed to a stage reviewer
 * from outside the team, so for them the bare link opens the newest round of the number they may open, the one
 * they decided. The template's own team always gets the head.
 */
export function roundToOpen<R extends RoundAccessFacts>(
  viewer: Viewer,
  place: ReviewPlace,
  rows: readonly R[],
  asked: { number: number; round: number | null },
): R | null {
  const shown =
    asked.round === null
      ? headOf(rows, asked.number)
      : rows.find((r) => r.number === asked.number && r.round === asked.round);
  if (!shown) return null;
  if (mayOpenRound(viewer, place, shown)) return shown;
  if (asked.round !== null) return null;
  return (
    roundsOf(rows, asked.number).find(
      (earlier) =>
        earlier !== shown && namedOnRound(viewer, place.teamId, earlier),
    ) ?? null
  );
}

// ── The review queue ─────────────────────────────────────────

/** What placing an in-review round in a viewer's queue reads of it. */
export interface QueueRoundFacts {
  teamId: string;
  submittedBy: string | null;
  writers: readonly string[];
  /** The stage it waits on, with its rule from the chain now (`currentStageOf`); null when it left the chain. */
  stage: ApprovalStage | null;
  /** Its decisions so far (who approved a stage of it can't approve another). */
  decisions: readonly RecordedDecision[];
}

/**
 * Where an in-review round goes in the viewer's review queue for a space (`spaceTeamId` null: All teams):
 * - `waiting`: in the space, or on a team the viewer can't see whose stage names them (a Legal reviewer covers
 *   every team, so they find it from their own space), and theirs to decide now (`decideCheck`);
 * - `submitted`: they submitted it, and it is in the space;
 * - null: not in their queue.
 */
export function queuePlacement(
  viewer: Viewer,
  spaceTeamId: string | null,
  round: QueueRoundFacts,
): "waiting" | "submitted" | null {
  const inSpace = spaceTeamId === null || round.teamId === spaceTeamId;
  const namedElsewhere =
    !canSeeSpace(viewer, round.teamId) &&
    stageApproverIds(round.stage).includes(viewer.userId);
  if (!inSpace && !namedElsewhere) return null;
  if (round.submittedBy === viewer.userId) return inSpace ? "submitted" : null;
  const check = decideCheck(viewer, {
    teamId: round.teamId,
    submittedBy: round.submittedBy,
    writers: round.writers,
    stage: round.stage,
    approvedBy: approvedThisRound(round.decisions),
  });
  return check.ok ? "waiting" : null;
}

// ── The review screen's decisions ────────────────────────────

/** What the viewer may do on a round's review screen. */
export interface ReviewScreenActions {
  approve: PermissionResult;
  requestChanges: PermissionResult;
  comment: PermissionResult;
}

/**
 * What the viewer may do on the round on screen, each with why not. Approve and Request changes share one
 * answer, the decide check (`decideCheck`: the role or the stage that names them, maker-checker, the stage's own
 * rule) and then the round's state; Approve also refuses someone who approved an earlier stage of it. Comment:
 * authors and approvers on the team, and whoever the waiting stage names (any team), while it takes comments.
 */
export function reviewScreenActions(
  viewer: Viewer,
  round: QueueRoundFacts & { state: VersionState },
): ReviewScreenActions {
  const inReview = round.state === "in_review";
  const decide = (check: PermissionResult): PermissionResult =>
    !check.ok || inReview ? check : refuse(REFUSALS.notInReview);
  const input = {
    teamId: round.teamId,
    submittedBy: round.submittedBy,
    writers: round.writers,
    stage: round.stage,
  };
  return {
    approve: decide(
      decideCheck(viewer, {
        ...input,
        approvedBy: inReview ? approvedThisRound(round.decisions) : [],
      }),
    ),
    requestChanges: decide(decideCheck(viewer, input)),
    comment: canComment(viewer, {
      teamId: round.teamId,
      version: {
        state: round.state,
        stageApproverIds: stageApproverIds(round.stage),
      },
    }),
  };
}
