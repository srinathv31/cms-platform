// The approval chain: an ordered list of stages, stored as configuration (approval_stages), never code.
// Release 1 has one stage ("Team approver"); with more, approvals happen in order. Pure TypeScript.
//
// A version's `currentStage` is an index into the chain in position order: the stage waiting for a
// decision while the version is in review, and the stage that sent it back once changes are requested.
// Maker-checker (nobody decides their own version) stays in `can(viewer, "version.decide")`; this
// module answers only "is this stage theirs?".

import { rolesOn } from "./permissions";
import type { ApprovalStage, Person, Recipients, StepView } from "./review-types";
import type { ApproverRule, PermissionResult, VersionState, Viewer } from "./types";

/** The chain in approval order (by position), whatever order the rows came in. */
export function orderedStages(chain: readonly ApprovalStage[]): ApprovalStage[] {
  return [...chain].sort((a, b) => a.position - b.position);
}

/** The stage at a version's `currentStage`, or null when the chain has no such stage. */
export function stageAt(chain: readonly ApprovalStage[], currentStage: number): ApprovalStage | null {
  return orderedStages(chain)[currentStage] ?? null;
}

/** True when `currentStage` is the chain's last stage: approving it makes the version Active. */
export function isLastStage(chain: readonly ApprovalStage[], currentStage: number): boolean {
  return currentStage === chain.length - 1;
}

/**
 * Whether the viewer is who the stage's rule names: a team role held (actively) on the template's
 * team, or one named user. The reason names the stage the version is waiting on.
 */
export function canActOnStage(viewer: Viewer, stage: ApprovalStage, teamId: string): PermissionResult {
  return ruleMatches(viewer, stage.rule, teamId) ? { ok: true } : { ok: false, reason: `Waiting on ${stage.name}.` };
}

function ruleMatches(viewer: Viewer, rule: ApproverRule, teamId: string): boolean {
  return rule.kind === "user" ? viewer.userId === rule.userId : rolesOn(viewer, teamId).includes(rule.role);
}

/** Who a stage's notifications go to. The submitter never reviews their own version, so they're left out. */
export function stageRecipients(stage: ApprovalStage, submittedBy: string | null): Recipients {
  const except = submittedBy ? [submittedBy] : [];
  return stage.rule.kind === "user"
    ? { kind: "user", userId: stage.rule.userId }
    : { kind: "team_role", role: stage.rule.role, exceptUserIds: except };
}

// ── The stepper ──────────────────────────────────────────────────────────────

export interface StageDecision {
  stagePosition: number;
  decision: "approved" | "changes_requested";
  by: Person;
  at: string; // ISO
}

/** States a version reaches only after every stage approved it. */
const APPROVED_STATES: ReadonlySet<VersionState> = new Set(["active", "superseded", "revoked"]);

/**
 * One step per stage, in order:
 *   - done: approved (with who and when). Every stage of an Active, Superseded or Revoked version.
 *   - current: the stage an In-review version is waiting on.
 *   - returned: the stage that requested changes (with who and when).
 *   - waiting: not reached yet; every stage of a draft.
 * `decisions` are the version's own approval records; the latest one per stage wins.
 */
export function stepperState(
  chain: readonly ApprovalStage[],
  decisions: readonly StageDecision[],
  version: { state: VersionState; currentStage: number },
): StepView[] {
  const { state, currentStage } = version;

  return orderedStages(chain).map((stage, index): StepView => {
    const step = { position: stage.position, name: stage.name };
    const decided = (kind: StageDecision["decision"]) => latest(decisions, stage.position, kind);

    if (APPROVED_STATES.has(state)) return withDecision(step, "done", decided("approved"));
    if (state === "in_review") {
      if (index < currentStage) return withDecision(step, "done", decided("approved"));
      return { ...step, status: index === currentStage ? "current" : "waiting" };
    }
    if (state === "changes_requested") {
      if (index < currentStage) return withDecision(step, "done", decided("approved"));
      if (index === currentStage) return withDecision(step, "returned", decided("changes_requested"));
    }
    return { ...step, status: "waiting" };
  });
}

function latest(
  decisions: readonly StageDecision[],
  position: number,
  kind: StageDecision["decision"],
): StageDecision | undefined {
  return decisions
    .filter((d) => d.stagePosition === position && d.decision === kind)
    .reduce<StageDecision | undefined>((best, d) => (best === undefined || d.at > best.at ? d : best), undefined);
}

function withDecision(
  step: { position: number; name: string },
  status: StepView["status"],
  decision: StageDecision | undefined,
): StepView {
  return decision ? { ...step, status, decidedBy: decision.by, decidedAt: decision.at } : { ...step, status };
}
