import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAIN,
  approvedThisRound,
  canActOnStage,
  currentStageOf,
  orderedStages,
  ownStages,
  recordStages,
  stageOf,
  stageRecipients,
  stepperState,
  versionsNeeding,
  type RecordedDecision,
  type StageDecision,
} from "./approval-chain";
import type { ApprovalStage, Person, StepView, VersionStage } from "./review-types";
import type { MembershipStatus, TeamRole, VersionState, Viewer } from "./types";

const TEAM = "coral-offers";

const TEAM_STAGE: ApprovalStage = { id: "st_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } };
const LEGAL_STAGE: ApprovalStage = { id: "st_legal", position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } };
const ONE: ApprovalStage[] = [TEAM_STAGE];
const TWO: ApprovalStage[] = [TEAM_STAGE, LEGAL_STAGE];
/** What a version submitted under each chain records. */
const RECORDED_ONE: VersionStage[] = [{ id: "st_team", name: "Team approver" }];
const RECORDED_TWO: VersionStage[] = [...RECORDED_ONE, { id: "st_legal", name: "Legal reviewer" }];

const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };
const ALEX: Person = { id: "alex", name: "Alex Kim", initials: "AK", hue: 140 };
const DANA: Person = { id: "dana", name: "Dana Park", initials: "DP", hue: 20 };

function viewer(
  userId: string,
  roles: TeamRole[],
  opts: { team?: string; status?: MembershipStatus; platformRole?: Viewer["platformRole"] } = {},
): Viewer {
  const team = opts.team ?? TEAM;
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: opts.platformRole ?? null,
    memberships: roles.length
      ? [{ teamId: team, teamSlug: team, teamName: team, roles, status: opts.status ?? "active" }]
      : [],
  };
}

describe("a version's own stages", () => {
  // The chain after Riley reorders it, renames the Legal stage and inserts a Compliance stage first.
  const COMPLIANCE: ApprovalStage = { id: "st_comp", position: 0, name: "Compliance", rule: { kind: "user", userId: "naomi" } };
  const EDITED: ApprovalStage[] = [
    COMPLIANCE,
    { ...LEGAL_STAGE, position: 1, name: "Legal sign-off" },
    { ...TEAM_STAGE, position: 2 },
  ];

  it("orders the chain by position, whatever order the rows came in", () => {
    expect(orderedStages([LEGAL_STAGE, TEAM_STAGE])).toEqual(TWO);
  });

  it("records the chain at submit: ids and names, in position order", () => {
    expect(recordStages([LEGAL_STAGE, TEAM_STAGE])).toEqual(RECORDED_TWO);
  });

  it("keeps the recorded stages whatever the chain becomes; a draft would follow the chain as it is", () => {
    expect(ownStages(RECORDED_TWO, EDITED)).toEqual(RECORDED_TWO);
    expect(ownStages(null, EDITED)).toEqual([
      { id: "st_comp", name: "Compliance" },
      { id: "st_legal", name: "Legal sign-off" },
      { id: "st_team", name: "Team approver" },
    ]);
  });

  it("reads a stage by its position in the version's own stages, with the name it recorded and the rule it has now", () => {
    const newRule: ApprovalStage[] = [TEAM_STAGE, { ...LEGAL_STAGE, rule: { kind: "user", userId: "naomi" } }];
    expect(stageOf(RECORDED_TWO, 1, EDITED)).toEqual({ ...LEGAL_STAGE, position: 1, name: "Legal reviewer" });
    expect(stageOf(RECORDED_TWO, 0, EDITED)).toEqual({ ...TEAM_STAGE, position: 0 });
    expect(stageOf(RECORDED_TWO, 1, newRule)?.rule).toEqual({ kind: "user", userId: "naomi" });
    expect(currentStageOf({ stages: RECORDED_TWO, currentStage: 1 }, EDITED)?.name).toBe("Legal reviewer");
  });

  it("has no stage past the end of the version's own stages, or one that left the chain", () => {
    expect(stageOf(RECORDED_ONE, 1, TWO)).toBeNull();
    expect(stageOf(RECORDED_TWO, 1, ONE)).toBeNull();
    expect(stageOf([], 0, TWO)).toBeNull();
  });

  it("counts, per stage, the versions in review that still need it: the one they wait on and the ones ahead", () => {
    const inReview = [
      { stages: RECORDED_TWO, currentStage: 0 }, // waits on Team, then Legal
      { stages: RECORDED_TWO, currentStage: 1 }, // passed Team, waits on Legal
      { stages: RECORDED_ONE, currentStage: 0 }, // submitted before Legal was added
    ];
    expect(versionsNeeding(inReview, TWO)).toEqual({ st_team: 2, st_legal: 2 });
    expect(versionsNeeding([{ stages: null, currentStage: 0 }], EDITED)).toEqual({ st_comp: 1, st_legal: 1, st_team: 1 });
    expect(versionsNeeding([], TWO)).toEqual({});
  });
});

describe("approvedThisRound", () => {
  const decision = (stageId: string | null, actorId: string, kind: RecordedDecision["decision"] = "approved"): RecordedDecision => ({
    stageId,
    actorId,
    decision: kind,
  });

  it("names everyone who approved a stage of the version, once each", () => {
    expect(approvedThisRound([decision("st_legal", "dana"), decision("st_team", "jordan"), decision("st_team", "jordan")])).toEqual([
      "dana",
      "jordan",
    ]);
  });

  it("counts an approval whatever stage it's recorded against, the stage the version waits on included", () => {
    // Migrated data: the 0005 backfill matched Jordan's approval by position to the stage the version
    // waits on now. He still approved a stage of this round, so he's barred.
    expect(approvedThisRound([decision("st_team", "jordan")])).toEqual(["jordan"]);
    expect(approvedThisRound([decision(null, "alex"), decision("st_gone", "dana")])).toEqual(["alex", "dana"]);
  });

  it("ignores requests for changes", () => {
    expect(approvedThisRound([decision("st_team", "jordan", "changes_requested")])).toEqual([]);
    expect(approvedThisRound([])).toEqual([]);
  });
});

describe("the default stage", () => {
  it("keeps Release 1's rule for a version that recorded it, after the content type gets a chain of its own", () => {
    const recorded: VersionStage[] = [{ id: "default", name: "Team approver" }];
    expect(stageOf(recorded, 0, TWO)).toEqual({ ...DEFAULT_CHAIN[0]!, position: 0 });
    expect(stageOf(recorded, 0, DEFAULT_CHAIN)).toEqual({ ...DEFAULT_CHAIN[0]!, position: 0 });
    expect(currentStageOf({ stages: recorded, currentStage: 0 }, TWO)?.rule).toEqual({ kind: "team_role", role: "approver" });
  });
});

describe("canActOnStage", () => {
  it.each<[string, Viewer, ApprovalStage, { ok: true } | { ok: false; reason: string }]>([
    ["an approver on the team acts on a team-role stage", viewer("jordan", ["approver"]), TEAM_STAGE, { ok: true }],
    ["a team admin who is also an approver", viewer("alex", ["team_admin", "approver"]), TEAM_STAGE, { ok: true }],
    ["an author doesn't", viewer("maya", ["author"]), TEAM_STAGE, { ok: false, reason: "Waiting on Team approver." }],
    ["a team admin alone doesn't", viewer("alex", ["team_admin"]), TEAM_STAGE, { ok: false, reason: "Waiting on Team approver." }],
    [
      "an approver on another team doesn't",
      viewer("naomi", ["approver"], { team: "deposits" }),
      TEAM_STAGE,
      { ok: false, reason: "Waiting on Team approver." },
    ],
    [
      "a suspended approver doesn't",
      viewer("jordan", ["approver"], { status: "suspended" }),
      TEAM_STAGE,
      { ok: false, reason: "Waiting on Team approver." },
    ],
    [
      "a platform admin doesn't",
      viewer("riley", [], { platformRole: "platform_admin" }),
      TEAM_STAGE,
      { ok: false, reason: "Waiting on Team approver." },
    ],
    ["the named user acts on a user stage", viewer("dana", []), LEGAL_STAGE, { ok: true }],
    ["a team approver doesn't, on a user stage", viewer("jordan", ["approver"]), LEGAL_STAGE, { ok: false, reason: "Waiting on Legal reviewer." }],
  ])("%s", (_, who, stage, expected) => {
    expect(canActOnStage(who, stage, TEAM)).toEqual(expected);
  });
});

describe("stageRecipients", () => {
  it("asks a team role's members, never anyone who wrote the version", () => {
    expect(stageRecipients(TEAM_STAGE, ["maya"])).toEqual({ kind: "team_role", role: "approver", exceptUserIds: ["maya"] });
    expect(stageRecipients(TEAM_STAGE, ["maya", "priya"])).toEqual({
      kind: "team_role",
      role: "approver",
      exceptUserIds: ["maya", "priya"],
    });
    expect(stageRecipients(TEAM_STAGE, [])).toEqual({ kind: "team_role", role: "approver", exceptUserIds: [] });
  });

  it("asks a named user directly, even one who wrote it: only a new rule moves the version on", () => {
    expect(stageRecipients(LEGAL_STAGE, ["maya"])).toEqual({ kind: "user", userId: "dana" });
    expect(stageRecipients(LEGAL_STAGE, ["maya", "dana"])).toEqual({ kind: "user", userId: "dana" });
  });

  it("asks nobody who already approved a stage of this round: they can't approve another", () => {
    expect(stageRecipients(TEAM_STAGE, ["maya"], ["jordan", "maya"])).toEqual({
      kind: "team_role",
      role: "approver",
      exceptUserIds: ["maya", "jordan"],
    });
    expect(stageRecipients(LEGAL_STAGE, ["maya"], ["dana"])).toBeNull();
    expect(stageRecipients(LEGAL_STAGE, ["maya"], ["jordan"])).toEqual({ kind: "user", userId: "dana" });
  });
});

describe("stepperState", () => {
  const at = (h: number) => `2026-10-04T${String(h).padStart(2, "0")}:00:00.000Z`;
  const approved = (stage: ApprovalStage, by: Person, hour: number): StageDecision => ({
    stageId: stage.id,
    decision: "approved",
    by,
    at: at(hour),
  });
  const returned = (stage: ApprovalStage, by: Person, hour: number): StageDecision => ({
    stageId: stage.id,
    decision: "changes_requested",
    by,
    at: at(hour),
  });
  const step = (stage: ApprovalStage, status: StepView["status"], by?: Person, hour?: number): StepView =>
    by ? { position: stage.position, name: stage.name, status, decidedBy: by, decidedAt: at(hour!) } : { position: stage.position, name: stage.name, status };
  /** The stepper of a version that recorded `chain` at submit. */
  const run = (chain: ApprovalStage[], decisions: StageDecision[], state: VersionState, currentStage = 0) =>
    stepperState(recordStages(chain), decisions, { state, currentStage });

  describe("one stage", () => {
    it("waits while the version is a draft", () => {
      expect(run(ONE, [], "draft")).toEqual([step(TEAM_STAGE, "waiting")]);
    });

    it("is current while in review", () => {
      expect(run(ONE, [], "in_review")).toEqual([step(TEAM_STAGE, "current")]);
    });

    it("is returned, with who and when, once changes are requested", () => {
      expect(run(ONE, [returned(TEAM_STAGE, JORDAN, 9)], "changes_requested")).toEqual([step(TEAM_STAGE, "returned", JORDAN, 9)]);
    });

    it.each(["active", "superseded", "revoked"] as const)("is done, with who and when, once %s", (state) => {
      expect(run(ONE, [approved(TEAM_STAGE, JORDAN, 10)], state)).toEqual([step(TEAM_STAGE, "done", JORDAN, 10)]);
    });

    it("is done without a name when no decision is on record", () => {
      expect(run(ONE, [], "active")).toEqual([step(TEAM_STAGE, "done")]);
    });
  });

  describe("two stages", () => {
    it("draft: both wait", () => {
      expect(run(TWO, [], "draft")).toEqual([step(TEAM_STAGE, "waiting"), step(LEGAL_STAGE, "waiting")]);
    });

    it("in review at the first stage: current, then waiting", () => {
      expect(run(TWO, [], "in_review", 0)).toEqual([step(TEAM_STAGE, "current"), step(LEGAL_STAGE, "waiting")]);
    });

    it("in review at the second stage: done, then current", () => {
      expect(run(TWO, [approved(TEAM_STAGE, JORDAN, 9)], "in_review", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "current"),
      ]);
    });

    it("returned at the second stage: done, then returned", () => {
      expect(run(TWO, [approved(TEAM_STAGE, JORDAN, 9), returned(LEGAL_STAGE, DANA, 11)], "changes_requested", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "returned", DANA, 11),
      ]);
    });

    it("returned at the first stage: returned, then waiting", () => {
      expect(run(TWO, [returned(TEAM_STAGE, JORDAN, 9)], "changes_requested", 0)).toEqual([
        step(TEAM_STAGE, "returned", JORDAN, 9),
        step(LEGAL_STAGE, "waiting"),
      ]);
    });

    it("Active: both done", () => {
      expect(run(TWO, [approved(TEAM_STAGE, JORDAN, 9), approved(LEGAL_STAGE, DANA, 12)], "active", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "done", DANA, 12),
      ]);
    });

    it("names the latest decision at a stage, and follows positions whatever the order", () => {
      const decisions = [approved(TEAM_STAGE, ALEX, 8), approved(TEAM_STAGE, JORDAN, 10), approved(LEGAL_STAGE, DANA, 12)];
      expect(run([LEGAL_STAGE, TEAM_STAGE], decisions, "superseded", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 10),
        step(LEGAL_STAGE, "done", DANA, 12),
      ]);
    });
  });

  describe("after the chain is edited mid-review", () => {
    // Submitted under [Legal reviewer, Team approver]; the chain was then reordered and Legal renamed.
    const own: VersionStage[] = [
      { id: "st_legal", name: "Legal reviewer" },
      { id: "st_team", name: "Team approver" },
    ];
    const legal = { ...LEGAL_STAGE, position: 0 };
    const team = { ...TEAM_STAGE, position: 1 };

    it("reads each decision by its stage id, in the version's own order and names", () => {
      const decisions = [approved(LEGAL_STAGE, DANA, 9), approved(TEAM_STAGE, JORDAN, 11)];
      expect(stepperState(own, decisions, { state: "in_review", currentStage: 1 })).toEqual([
        step(legal, "done", DANA, 9),
        step(team, "current"),
      ]);
      expect(stepperState(own, decisions, { state: "active", currentStage: 1 })).toEqual([
        step(legal, "done", DANA, 9),
        step(team, "done", JORDAN, 11),
      ]);
    });

    it("shows no one for a decision whose stage couldn't be matched", () => {
      const unmatched: StageDecision = { stageId: null, decision: "approved", by: JORDAN, at: at(9) };
      expect(stepperState(own, [unmatched], { state: "in_review", currentStage: 1 })).toEqual([step(legal, "done"), step(team, "current")]);
    });
  });
});
