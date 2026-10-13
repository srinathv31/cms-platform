import { describe, expect, it } from "vitest";
import { COMMENT_REFUSALS } from "./comments";
import { CHAIN_2 } from "./lifecycle/fixtures";
import { REFUSALS } from "./lifecycle/refusals";
import { REASONS } from "./permissions";
import {
  mayOpenRound,
  queuePlacement,
  reviewScreenActions,
  roundToOpen,
  type RoundAccessFacts,
} from "./review-access";
import type { TeamRole, VersionState, Viewer } from "./types";

// Who sees what in review. Coral Offers' templates; Dana is a Viewer on Coral Offers in the seed, but here she
// is on Deposits only, so the Legal reviewer stage that names her is her only way in.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const [teamStage, legalStage] = CHAIN_2;

function person(userId: string, teamId: string, roles: TeamRole[]): Viewer {
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: null,
    memberships: [
      {
        teamId,
        teamSlug: teamId,
        teamName: teamId,
        roles,
        status: "active",
      },
    ],
  };
}

const jordan = person("jordan", CORAL, ["approver"]);
const maya = person("maya", CORAL, ["author"]);
const sam = person("sam", CORAL, ["viewer"]);
const dana = person("dana", DEPOSITS, ["viewer"]);
const eli = person("eli", DEPOSITS, ["author"]);

const round = (
  number: number,
  roundNo: number,
  state: VersionState,
  facts: Partial<RoundAccessFacts> = {},
): RoundAccessFacts & { id: string } => ({
  id: `v${number}r${roundNo}`,
  number,
  round: roundNo,
  state,
  stageApproverIds: [],
  decidedBy: [],
  ...facts,
});

const inCoral = { spaceTeamId: CORAL, teamId: CORAL };

describe("mayOpenRound", () => {
  it("lets the template's team open its rounds in its space and in All teams, and nobody else", () => {
    const r = round(1, 1, "in_review");
    expect(mayOpenRound(sam, inCoral, r)).toBe(true);
    expect(mayOpenRound(sam, { spaceTeamId: null, teamId: CORAL }, r)).toBe(
      true,
    );
    expect(mayOpenRound(eli, inCoral, r)).toBe(false);
  });

  it("lets someone the waiting stage names in from any space, and keeps them in once they decided it", () => {
    const waiting = round(1, 1, "in_review", { stageApproverIds: ["dana"] });
    const away = { spaceTeamId: DEPOSITS, teamId: CORAL };
    expect(mayOpenRound(dana, away, waiting)).toBe(true);
    expect(
      mayOpenRound(dana, away, { ...waiting, state: "changes_requested" }),
      "no longer waiting on her, and she didn't decide it",
    ).toBe(false);
    expect(
      mayOpenRound(dana, away, {
        ...waiting,
        state: "changes_requested",
        decidedBy: ["dana"],
      }),
    ).toBe(true);
  });
});

describe("roundToOpen", () => {
  const rows = [
    round(3, 1, "changes_requested", { decidedBy: ["dana"] }),
    round(3, 2, "in_review", { stageApproverIds: [] }),
  ];
  const away = { spaceTeamId: DEPOSITS, teamId: CORAL };

  it("opens the round asked for, or without one the number's head", () => {
    expect(
      roundToOpen(jordan, inCoral, rows, { number: 3, round: null })?.id,
    ).toBe("v3r2");
    expect(
      roundToOpen(jordan, inCoral, rows, { number: 3, round: 1 })?.id,
    ).toBe("v3r1");
    expect(
      roundToOpen(jordan, inCoral, rows, { number: 3, round: 3 }),
    ).toBeNull();
    expect(
      roundToOpen(jordan, inCoral, rows, { number: 4, round: null }),
    ).toBeNull();
  });

  it("opens a bare link on the round a stage reviewer from outside decided, once the head is closed to them", () => {
    expect(roundToOpen(dana, away, rows, { number: 3, round: null })?.id).toBe(
      "v3r1",
    );
    expect(
      roundToOpen(dana, away, rows, { number: 3, round: 2 }),
      "a round named outright stays Not found",
    ).toBeNull();
    expect(roundToOpen(eli, away, rows, { number: 3, round: null })).toBeNull();
  });
});

describe("queuePlacement", () => {
  const coralRound = {
    teamId: CORAL,
    submittedBy: "maya",
    writers: ["maya"],
    stage: teamStage!,
    decisions: [],
  };

  it("puts a round the viewer may decide in waiting, and their own in submitted", () => {
    expect(queuePlacement(jordan, CORAL, coralRound)).toBe("waiting");
    expect(queuePlacement(maya, CORAL, coralRound)).toBe("submitted");
    expect(queuePlacement(sam, CORAL, coralRound)).toBeNull();
    expect(queuePlacement(jordan, null, coralRound), "All teams").toBe(
      "waiting",
    );
  });

  it("leaves out another team's rounds, unless their stage names the viewer", () => {
    expect(queuePlacement(eli, DEPOSITS, coralRound)).toBeNull();
    const legal = { ...coralRound, stage: legalStage! };
    expect(queuePlacement(dana, DEPOSITS, legal)).toBe("waiting");
  });

  it("leaves out a round the viewer already approved a stage of", () => {
    expect(
      queuePlacement(jordan, CORAL, {
        ...coralRound,
        stage: {
          ...legalStage!,
          rule: { kind: "team_role", role: "approver" },
        },
        decisions: [
          { stageId: "st_team", actorId: "jordan", decision: "approved" },
        ],
      }),
    ).toBeNull();
  });
});

describe("reviewScreenActions", () => {
  const facts = {
    teamId: CORAL,
    submittedBy: "maya",
    writers: ["maya"],
    stage: teamStage!,
    decisions: [],
    state: "in_review" as const,
  };

  it("lets an approver decide and comment while the round is in review", () => {
    expect(reviewScreenActions(jordan, facts)).toEqual({
      approve: { ok: true },
      requestChanges: { ok: true },
      comment: { ok: true },
    });
  });

  it("says why the author and a viewer can't decide", () => {
    expect(reviewScreenActions(maya, facts)).toEqual({
      approve: { ok: false, ...REASONS.ownVersion },
      requestChanges: { ok: false, ...REASONS.ownVersion },
      comment: { ok: true },
    });
    expect(reviewScreenActions(sam, facts).approve).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });

  it("refuses a decided round as not in review, and closes its comments", () => {
    expect(reviewScreenActions(jordan, { ...facts, state: "active" })).toEqual({
      approve: { ok: false, ...REFUSALS.notInReview },
      requestChanges: { ok: false, ...REFUSALS.notInReview },
      comment: { ok: false, ...COMMENT_REFUSALS.closed },
    });
  });
});
