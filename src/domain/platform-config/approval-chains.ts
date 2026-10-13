// Approval chains: every stage must be one somebody can approve (`validateChain`): the Approver role, or
// a person who can approve and isn't on another stage. Nobody names themselves. A version in review goes
// through the stages it recorded at submit, so an edit never moves it; a new rule on one of its stages
// reaches it. A stage some in-review version still needs (the one it waits on, or one ahead of it) can't
// be removed.

import type {
  AccessEffect,
  ApproverFacts,
  Named,
  Ok,
  Refused,
} from "../access-types";
import { ROLE_LABEL } from "../access/roles";
import { refuse, type Refusal } from "../refusals";
import { versionsNeeding } from "../approval-chain";
import type { ApprovalStage, VersionStage } from "../review-types";
import { TEAM_ROLES, type ApproverRule } from "../types";
import { configChanged } from "./effects";
import { STAGE_NAME_MAX } from "./limits";
import { PLATFORM_REFUSALS } from "./refusals";

/** "Approver role", or the named person's name. */
export function ruleLabel(
  rule: ApproverRule,
  people: readonly Named[],
): string {
  if (rule.kind === "team_role") return `${ROLE_LABEL[rule.role]} role`;
  return people.find((p) => p.id === rule.userId)?.name ?? rule.userId;
}

/**
 * A stage as the `platform.config_changed` row records it: its name and rule, and for a rule that names a
 * person, their name as it was (`userName`), so the Audit page words the chain without looking them up again.
 */
export function chainStageFacts(
  stage: { name: string; rule: ApproverRule },
  people: readonly Named[],
): { name: string; rule: ApproverRule; userName?: string } {
  const { name, rule } = stage;
  if (rule.kind !== "user") return { name, rule };
  const person = people.find((p) => p.id === rule.userId);
  return person ? { name, rule, userName: person.name } : { name, rule };
}

export interface ChainCardStage {
  /** The stage's id; null for a stage being added. */
  id: string | null;
  name: string;
  ruleLabel: string;
  /** "added" and "renamed" mark the After card; "removed" marks the Now card. */
  change: "added" | "removed" | "renamed" | "moved" | null;
}

export interface ChainChange {
  now: ChainCardStage[];
  after: ChainCardStage[];
  /** Plain lines under the cards. Empty when nothing changes. */
  lines: string[];
  changed: boolean;
}

type StageInput = { id?: string; name: string; rule: ApproverRule };

/**
 * The "Now / After" consequence cards for a chain edit, before it is saved, with the lines under
 * them: who reviews what from now on, and that a named person reviews every team's submissions
 * (including teams they aren't a member of). `waiting` counts, per stage id, the versions in review
 * that still need the stage (`versionsNeeding`).
 */
export function describeChainChange(input: {
  contentTypeName: string;
  current: readonly ApprovalStage[];
  next: readonly StageInput[];
  people: readonly Named[];
  waiting?: Readonly<Record<string, number>>;
}): ChainChange {
  const current = [...input.current].sort((a, b) => a.position - b.position);
  const nextIds = new Set(
    input.next.map((s) => s.id).filter((id): id is string => !!id),
  );
  const byId = new Map(current.map((s, index) => [s.id, { stage: s, index }]));

  const now: ChainCardStage[] = current.map((s) => ({
    id: s.id,
    name: s.name,
    ruleLabel: ruleLabel(s.rule, input.people),
    change: nextIds.has(s.id) ? null : "removed",
  }));
  const keptBefore = current.filter((s) => nextIds.has(s.id)).map((s) => s.id);
  const keptAfter = input.next
    .filter((s) => s.id && byId.has(s.id))
    .map((s) => s.id!);
  const after: ChainCardStage[] = input.next.map((s) => {
    const was = s.id ? byId.get(s.id)?.stage : undefined;
    const label = ruleLabel(s.rule, input.people);
    let change: ChainCardStage["change"] = null;
    if (!was) change = "added";
    else if (
      was.name !== s.name.trim() ||
      ruleLabel(was.rule, input.people) !== label
    )
      change = "renamed";
    else if (keptBefore.indexOf(was.id) !== keptAfter.indexOf(was.id))
      change = "moved";
    return {
      id: was ? was.id : null,
      name: s.name.trim(),
      ruleLabel: label,
      change,
    };
  });

  const lines: string[] = [];
  const type = input.contentTypeName;
  for (const s of after.filter((a) => a.change === "added")) {
    lines.push(
      `${type} submissions will also wait on ${s.name} (${s.ruleLabel}).`,
    );
  }
  for (const s of now.filter((n) => n.change === "removed")) {
    const count = input.waiting?.[s.id!] ?? 0;
    lines.push(
      count > 0
        ? PLATFORM_REFUSALS.stageWaiting(count, s.name).reason
        : `${type} submissions will no longer wait on ${s.name}.`,
    );
  }
  const namedNow = new Set(
    current.flatMap((s) => (s.rule.kind === "user" ? [s.rule.userId] : [])),
  );
  const announced = new Set<string>();
  for (const s of input.next) {
    // A person newly named on two stages gets the line once.
    if (
      s.rule.kind !== "user" ||
      namedNow.has(s.rule.userId) ||
      announced.has(s.rule.userId)
    )
      continue;
    announced.add(s.rule.userId);
    const person = ruleLabel(s.rule, input.people);
    lines.push(
      `${person} will review ${type} submissions from every team, including teams they aren't a member of.`,
    );
  }
  const changed =
    after.some((a) => a.change !== null) ||
    now.some((n) => n.change !== null) ||
    after.length !== now.length;
  return { now, after, lines: changed ? lines : [], changed };
}

/** A reason a chain can't be saved (its code and sentence), tied to the stage (its index) and the field it's about. */
export interface StageProblem extends Refusal {
  stage: number;
  field: "name" | "reviewer";
}

/**
 * Why a stage naming `person` would stall, or null: a named stage gives its person the power to
 * decide only while they hold an active team role somewhere, and never an Auditor (permissions.ts,
 * `namedApprover`); a platform role alone is no approve power. It holds whoever named them and
 * whenever, so `validateChain` checks it for every named person on every save.
 */
export function cannotApprove(person: ApproverFacts): Refusal | null {
  if (person.platformRole === "auditor")
    return PLATFORM_REFUSALS.auditorCantApprove(person.name);
  if (!person.activeTeamRole) {
    return person.platformRole === "platform_admin"
      ? PLATFORM_REFUSALS.adminWithoutTeamRole(person.name)
      : PLATFORM_REFUSALS.noActiveAccess(person.name);
  }
  return null;
}

/**
 * Why `actorId` can't newly name `person` on a stage (a new stage, or a stage whose reviewer changes
 * to them), or null: `cannotApprove`, and nobody names themselves, since a Platform Admin would be
 * granting themselves approval. The rule is about the act of naming: a stage another admin already
 * named the actor on stays theirs when the actor saves the chain. The chain picker offers only the
 * people this returns null for.
 */
export function approverProblem(
  person: ApproverFacts,
  actorId: string,
): Refusal | null {
  if (person.id === actorId) return PLATFORM_REFUSALS.nameYourself;
  return cannotApprove(person);
}

/**
 * Everything that would stop a chain being saved or, once saved, stall every submission, tied to the
 * stage it's about. Names: blank, too long, or the same as an earlier stage's. Reviewers: a team role
 * other than Approver (no other role can decide); a person who doesn't exist, can't approve
 * (`cannotApprove`), or is already named on an earlier stage (nobody approves two stages of one
 * round); the actor naming themselves on a stage that didn't already name them (`current`, matched by
 * stage id). Every named person is checked, not only new ones: someone named earlier who has since
 * lost access stalls the chain too. In stage order, name before reviewer; empty when the chain is
 * fine. The chain editor runs it as the admin edits, with the facts its read model carries; the
 * server runs it again inside `saveApprovalChain`.
 */
export function validateChain(input: {
  stages: readonly { id?: string; name: string; rule: ApproverRule }[];
  /** The saved chain: a stage (by id) that already names the actor stays theirs. */
  current: readonly { id: string; rule: ApproverRule }[];
  actorId: string;
  people: readonly ApproverFacts[];
}): StageProblem[] {
  const problems: StageProblem[] = [];
  const names = new Set<string>();
  const namedOn = new Map<string, number>();
  const actorsStages = new Set(
    input.current.flatMap((s) =>
      s.rule.kind === "user" && s.rule.userId === input.actorId ? [s.id] : [],
    ),
  );
  input.stages.forEach((stage, index) => {
    const name = stage.name.trim();
    const key = name.toLowerCase();
    const nameReason = !name
      ? PLATFORM_REFUSALS.stageName
      : name.length > STAGE_NAME_MAX
        ? PLATFORM_REFUSALS.stageNameTooLong
        : names.has(key)
          ? PLATFORM_REFUSALS.stageDuplicate(name)
          : null;
    if (name) names.add(key);
    if (nameReason)
      problems.push({ stage: index, field: "name", ...nameReason });

    const keptByActor = stage.id !== undefined && actorsStages.has(stage.id);
    const reviewerReason = reviewerProblem(
      stage.rule,
      input,
      keptByActor,
      namedOn,
      index,
    );
    if (reviewerReason)
      problems.push({ stage: index, field: "reviewer", ...reviewerReason });
  });
  return problems;
}

function reviewerProblem(
  rule: ApproverRule,
  { actorId, people }: { actorId: string; people: readonly ApproverFacts[] },
  keptByActor: boolean,
  namedOn: Map<string, number>,
  index: number,
): Refusal | null {
  if (rule.kind === "team_role") {
    if (!(TEAM_ROLES as readonly string[]).includes(rule.role))
      return PLATFORM_REFUSALS.pickRole;
    return rule.role === "approver"
      ? null
      : PLATFORM_REFUSALS.roleCantApprove(rule.role);
  }
  const person = people.find((p) => p.id === rule.userId);
  if (!person) return PLATFORM_REFUSALS.pickPerson;
  // A stage that already named the actor stays theirs; every other naming of them is them naming themselves.
  const cannot = keptByActor
    ? cannotApprove(person)
    : approverProblem(person, actorId);
  if (cannot) return cannot;
  const earlier = namedOn.get(person.id);
  if (earlier !== undefined)
    return PLATFORM_REFUSALS.personTwice(person.name, earlier + 1);
  namedOn.set(person.id, index);
  return null;
}

/**
 * Why a stage can't be removed from a chain, or null: the chain keeps at least one stage
 * (`remaining`, how many are left once it goes), and a stage some version in review still needs
 * stays (`waiting`, from `versionsNeeding`). The chain editor shows it at the stage's Remove;
 * `saveApprovalChain` refuses with it.
 */
export function removeStageRefusal(
  stage: { name: string; waiting: number },
  remaining: number,
): Refusal | null {
  if (remaining < 1) return PLATFORM_REFUSALS.oneStage;
  if (stage.waiting > 0)
    return PLATFORM_REFUSALS.stageWaiting(stage.waiting, stage.name);
  return null;
}

/**
 * The whole chain, in order. Existing stages keep their id, so a new rule on a stage reaches the
 * versions that will reach it; new ones get `id: null`. Versions in review go through the stages they
 * recorded at submit, so no edit moves them. Refuses a stale stage id, then the first of
 * `validateChain`'s problems, then removing a stage an in-review version still needs (the one it waits
 * on, or one ahead of it in its own stages). `people` holds everyone, with the facts `validateChain`
 * checks.
 */
export function saveApprovalChain(input: {
  contentType: { id: string; name: string };
  current: ApprovalStage[];
  next: StageInput[];
  inReview: {
    versionId: string;
    stages: VersionStage[] | null;
    currentStage: number;
  }[];
  people: ApproverFacts[];
  actor: Named;
  now: Date;
}):
  | Ok<{
      stages: (Omit<ApprovalStage, "id"> & { id: string | null })[];
      effects: AccessEffect[];
    }>
  | Refused {
  const { contentType, people } = input;
  const current = [...input.current].sort((a, b) => a.position - b.position);
  if (input.next.length === 0) return refuse(PLATFORM_REFUSALS.oneStage);

  const currentIds = new Set(current.map((s) => s.id));
  const ids = new Set<string>();
  for (const s of input.next) {
    if (s.id !== undefined && (!currentIds.has(s.id) || ids.has(s.id)))
      return refuse(PLATFORM_REFUSALS.stageGone);
    if (s.id) ids.add(s.id);
  }
  const problem = validateChain({
    stages: input.next,
    current,
    actorId: input.actor.id,
    people,
  })[0];
  if (problem) return refuse(problem);

  const needing = versionsNeeding(input.inReview, current);
  for (const s of current) {
    if (ids.has(s.id)) continue;
    const refusal = removeStageRefusal(
      { name: s.name, waiting: needing[s.id] ?? 0 },
      input.next.length,
    );
    if (refusal) return refuse(refusal);
  }

  const stages = input.next.map((s, position) => ({
    id: s.id ?? null,
    position,
    name: s.name.trim(),
    rule:
      s.rule.kind === "user"
        ? { kind: "user" as const, userId: s.rule.userId }
        : { kind: "team_role" as const, role: s.rule.role },
  }));

  const change = describeChainChange({
    contentTypeName: contentType.name,
    current,
    next: input.next,
    people,
  });
  if (!change.changed) return { ok: true, stages, effects: [] };

  return {
    ok: true,
    stages,
    effects: [
      configChanged("approval_chains", null, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        before: current.map((s) => s.name),
        after: stages.map((s) => s.name),
        stages: stages.map((s) => chainStageFacts(s, people)),
      }),
    ],
  };
}
