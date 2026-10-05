import { describe, expect, it } from "vitest";
import {
  canActOnStage,
  isLastStage,
  orderedStages,
  stageAt,
  stageRecipients,
  stepperState,
  type StageDecision,
} from "./approval-chain";
import type { ApprovalStage, Person, StepView } from "./review-types";
import type { MembershipStatus, TeamRole, VersionState, Viewer } from "./types";

const TEAM = "coral-offers";

const TEAM_STAGE: ApprovalStage = { position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } };
const LEGAL_STAGE: ApprovalStage = { position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } };
const ONE: ApprovalStage[] = [TEAM_STAGE];
const TWO: ApprovalStage[] = [TEAM_STAGE, LEGAL_STAGE];

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

describe("orderedStages / stageAt / isLastStage", () => {
  it("orders by position, whatever order the rows came in", () => {
    expect(orderedStages([LEGAL_STAGE, TEAM_STAGE])).toEqual(TWO);
    expect(stageAt([LEGAL_STAGE, TEAM_STAGE], 1)).toEqual(LEGAL_STAGE);
  });

  it("has no stage past the end", () => {
    expect(stageAt(ONE, 1)).toBeNull();
    expect(stageAt([], 0)).toBeNull();
  });

  it("knows the last stage", () => {
    expect(isLastStage(ONE, 0)).toBe(true);
    expect(isLastStage(TWO, 0)).toBe(false);
    expect(isLastStage(TWO, 1)).toBe(true);
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
  it("asks a team role's members, never the submitter", () => {
    expect(stageRecipients(TEAM_STAGE, "maya")).toEqual({ kind: "team_role", role: "approver", exceptUserIds: ["maya"] });
    expect(stageRecipients(TEAM_STAGE, null)).toEqual({ kind: "team_role", role: "approver", exceptUserIds: [] });
  });

  it("asks a named user directly", () => {
    expect(stageRecipients(LEGAL_STAGE, "maya")).toEqual({ kind: "user", userId: "dana" });
  });
});

describe("stepperState", () => {
  const at = (h: number) => `2026-10-04T${String(h).padStart(2, "0")}:00:00.000Z`;
  const approved = (stagePosition: number, by: Person, hour: number): StageDecision => ({
    stagePosition,
    decision: "approved",
    by,
    at: at(hour),
  });
  const returned = (stagePosition: number, by: Person, hour: number): StageDecision => ({
    stagePosition,
    decision: "changes_requested",
    by,
    at: at(hour),
  });
  const step = (stage: ApprovalStage, status: StepView["status"], by?: Person, hour?: number): StepView =>
    by ? { position: stage.position, name: stage.name, status, decidedBy: by, decidedAt: at(hour!) } : { position: stage.position, name: stage.name, status };
  const run = (chain: ApprovalStage[], decisions: StageDecision[], state: VersionState, currentStage = 0) =>
    stepperState(chain, decisions, { state, currentStage });

  describe("one stage", () => {
    it("waits while the version is a draft", () => {
      expect(run(ONE, [], "draft")).toEqual([step(TEAM_STAGE, "waiting")]);
    });

    it("is current while in review", () => {
      expect(run(ONE, [], "in_review")).toEqual([step(TEAM_STAGE, "current")]);
    });

    it("is returned, with who and when, once changes are requested", () => {
      expect(run(ONE, [returned(0, JORDAN, 9)], "changes_requested")).toEqual([step(TEAM_STAGE, "returned", JORDAN, 9)]);
    });

    it.each(["active", "superseded", "revoked"] as const)("is done, with who and when, once %s", (state) => {
      expect(run(ONE, [approved(0, JORDAN, 10)], state)).toEqual([step(TEAM_STAGE, "done", JORDAN, 10)]);
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
      expect(run(TWO, [approved(0, JORDAN, 9)], "in_review", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "current"),
      ]);
    });

    it("returned at the second stage: done, then returned", () => {
      expect(run(TWO, [approved(0, JORDAN, 9), returned(1, DANA, 11)], "changes_requested", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "returned", DANA, 11),
      ]);
    });

    it("returned at the first stage: returned, then waiting", () => {
      expect(run(TWO, [returned(0, JORDAN, 9)], "changes_requested", 0)).toEqual([
        step(TEAM_STAGE, "returned", JORDAN, 9),
        step(LEGAL_STAGE, "waiting"),
      ]);
    });

    it("Active: both done", () => {
      expect(run(TWO, [approved(0, JORDAN, 9), approved(1, DANA, 12)], "active", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 9),
        step(LEGAL_STAGE, "done", DANA, 12),
      ]);
    });

    it("names the latest decision at a stage, and follows positions whatever the order", () => {
      const decisions = [approved(0, ALEX, 8), approved(0, JORDAN, 10), approved(1, DANA, 12)];
      expect(run([LEGAL_STAGE, TEAM_STAGE], decisions, "superseded", 1)).toEqual([
        step(TEAM_STAGE, "done", JORDAN, 10),
        step(LEGAL_STAGE, "done", DANA, 12),
      ]);
    });
  });
});
