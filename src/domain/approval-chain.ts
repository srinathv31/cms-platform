// The approval chain: an ordered list of stages, stored as configuration (approval_stages), never code.
// Release 1 has one stage ("Team approver"); with more, approvals happen in order. Pure TypeScript.
//
// A version goes through its own stages: at submit it records the chain's stages in order, by id and
// name (`versions.stages`, `recordStages`), and no later chain edit changes that sequence. Its
// `currentStage` is a position in it: the stage waiting for a decision while the version is in review,
// and the stage that sent it back once changes are requested. Who decides a stage is read live: the rule
// its chain stage has now, matched by id (`stageOf`), so a Platform Admin changing a stage's rule reaches
// the versions already waiting on it. Decisions record the stage id, and are read back by it.
//
// Maker-checker (nobody decides their own version) stays in `can(viewer, "version.decide")`; this
// module answers only "is this stage theirs?".

import { rolesOn } from "./permissions";
import { refusal, refuse } from "./refusals";
import type { ApprovalStage, Person, Recipients, StepView, VersionStage } from "./review-types";
import type { ApproverRule, PermissionResult, VersionState, Viewer } from "./types";

/**
 * Release 1's chain, used while a content type has no stages configured. Its stage id, "default", is
 * what a version submitted under it records; `stageOf` still reads that stage's rule from here once the
 * content type has a chain of its own, so those versions stay decidable.
 */
export const DEFAULT_CHAIN: readonly ApprovalStage[] = [
  { id: "default", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
];

/** The chain in approval order (by position), whatever order the rows came in. */
export function orderedStages(chain: readonly ApprovalStage[]): ApprovalStage[] {
  return [...chain].sort((a, b) => a.position - b.position);
}

// ── A version's own stages ───────────────────────────────────────────────────

/** What `submit` records on a version (`versions.stages`): the chain's stages in order, by id and name. */
export function recordStages(chain: readonly ApprovalStage[]): VersionStage[] {
  return orderedStages(chain).map(({ id, name }) => ({ id, name }));
}

/**
 * The stages a version goes through, in its own order: the ones it recorded at submit. A version that
 * has recorded none (a draft) would go through the chain as it is now.
 */
export function ownStages(recorded: readonly VersionStage[] | null, chain: readonly ApprovalStage[]): VersionStage[] {
  return recorded ? [...recorded] : recordStages(chain);
}

/**
 * The stage at `position` in a version's own stages, as review acts on it: the id and name the version
 * recorded, with the rule that stage has in the chain now (Release 1's "default" stage keeps its rule
 * from `DEFAULT_CHAIN`). Null past the end, and for a stage that has left the chain
 * (`saveApprovalChain` refuses to remove a stage an in-review version still needs, so that is only ever
 * a stage behind it).
 */
export function stageOf(
  stages: readonly VersionStage[],
  position: number,
  chain: readonly ApprovalStage[],
): ApprovalStage | null {
  const recorded = stages[position];
  if (!recorded) return null;
  const live = chain.find((stage) => stage.id === recorded.id) ?? DEFAULT_CHAIN.find((stage) => stage.id === recorded.id);
  return live ? { id: recorded.id, position, name: recorded.name, rule: live.rule } : null;
}

/** The stage a version waits on (or that sent it back), as `stageOf` reads it. */
export function currentStageOf(
  version: { stages: readonly VersionStage[] | null; currentStage: number },
  chain: readonly ApprovalStage[],
): ApprovalStage | null {
  return stageOf(ownStages(version.stages, chain), version.currentStage, chain);
}

/** A decision as it is read back: the stage it was made at (null: recorded before stage ids, unmatched), who, and what. */
export interface RecordedDecision {
  stageId: string | null;
  actorId: string;
  decision: "approved" | "changes_requested";
}

/**
 * Who has approved a stage of this version: nobody approves two stages of one round. A version is
 * reviewed in one round (a change request sends the next one in as a new number), so every approval
 * on it counts, whatever stage it is recorded against. That holds for decisions the 0005 migration
 * matched to a stage by position, which may name the stage the version waits on now.
 */
export function approvedThisRound(decisions: readonly RecordedDecision[]): string[] {
  return [...new Set(decisions.filter((d) => d.decision === "approved").map((d) => d.actorId))];
}

/**
 * How many versions in review still need each chain stage, by stage id: the stage they wait on, or one
 * ahead of it in their own stages. Removing a stage some version still needs is refused.
 */
export function versionsNeeding(
  inReview: readonly { stages: readonly VersionStage[] | null; currentStage: number }[],
  chain: readonly ApprovalStage[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const version of inReview) {
    const ahead = new Set(ownStages(version.stages, chain).slice(Math.max(version.currentStage, 0)).map((s) => s.id));
    for (const id of ahead) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// ── Who decides a stage ──────────────────────────────────────────────────────

/** Why the viewer can't decide the stage a version waits on. */
export const STAGE_REFUSALS = {
  waitingOn: refusal("waiting_on_stage", (stage: string) => `Waiting on ${stage}.`),
} as const;

/**
 * Whether the viewer is who the stage's rule names: a team role held (actively) on the template's
 * team, or one named user. The reason names the stage the version is waiting on.
 */
export function canActOnStage(viewer: Viewer, stage: ApprovalStage, teamId: string): PermissionResult {
  return ruleMatches(viewer, stage.rule, teamId) ? { ok: true } : refuse(STAGE_REFUSALS.waitingOn(stage.name));
}

function ruleMatches(viewer: Viewer, rule: ApproverRule, teamId: string): boolean {
  return rule.kind === "user" ? viewer.userId === rule.userId : rolesOn(viewer, teamId).includes(rule.role);
}

/**
 * Who a stage's notifications go to. Nobody decides a version they wrote (maker-checker), so a team role's
 * members are asked minus the version's `writers` (the submitter is one), and minus anyone who already
 * approved a stage of this round (`approved`, from `approvedThisRound`), who can't approve another. A
 * stage that names one person asks them even when they wrote it: the version waits until the stage's rule
 * changes, and they're the one who knows. Null when that person already approved a stage of this round:
 * nobody is asked.
 */
export function stageRecipients(
  stage: ApprovalStage,
  writers: readonly string[],
  approved: readonly string[] = [],
): Recipients | null {
  if (stage.rule.kind === "user") return approved.includes(stage.rule.userId) ? null : { kind: "user", userId: stage.rule.userId };
  return { kind: "team_role", role: stage.rule.role, exceptUserIds: [...new Set([...writers, ...approved])] };
}

// ── The stepper ──────────────────────────────────────────────────────────────

export interface StageDecision {
  /** The stage the decision was made at; null for one recorded before stage ids that couldn't be matched. */
  stageId: string | null;
  decision: "approved" | "changes_requested";
  by: Person;
  at: string; // ISO
}

/** States a version reaches only after every stage approved it. */
const APPROVED_STATES: ReadonlySet<VersionState> = new Set(["active", "superseded", "revoked"]);

/**
 * One step per stage of the version's own stages (`ownStages`), in its order and with the names it
 * recorded:
 *   - done: approved (with who and when). Every stage of an Active, Superseded or Revoked version.
 *   - current: the stage an In-review version is waiting on.
 *   - returned: the stage that requested changes (with who and when).
 *   - waiting: not reached yet; every stage of a draft.
 * `decisions` are the version's own approval records, matched to a stage by its id; the latest one
 * per stage wins.
 */
export function stepperState(
  stages: readonly VersionStage[],
  decisions: readonly StageDecision[],
  version: { state: VersionState; currentStage: number },
): StepView[] {
  const { state, currentStage } = version;

  return stages.map((stage, index): StepView => {
    const step = { position: index, name: stage.name };
    const decided = (kind: StageDecision["decision"]) => latest(decisions, stage.id, kind);

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
  stageId: string,
  kind: StageDecision["decision"],
): StageDecision | undefined {
  return decisions
    .filter((d) => d.stageId === stageId && d.decision === kind)
    .reduce<StageDecision | undefined>((best, d) => (best === undefined || d.at > best.at ? d : best), undefined);
}

function withDecision(
  step: { position: number; name: string },
  status: StepView["status"],
  decision: StageDecision | undefined,
): StepView {
  return decision ? { ...step, status, decidedBy: decision.by, decidedAt: decision.at } : { ...step, status };
}
