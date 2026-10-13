import { describe, expect, it } from "vitest";
import type { TeamRole, Viewer } from "../types";
import { decideCheck } from "./decide-check";
import { CHAIN_2 } from "./fixtures";
import { REFUSALS } from "./refusals";

// Who may approve or send back a version at its current stage: the queue, the review screen and the actions ask
// `decideCheck`; the approve transition refuses by the same earlier-stage rule (`approvedEarlierStage`).

const TEAM = "t_coral";
const [teamStage, legalStage] = CHAIN_2;

function person(userId: string, roles: TeamRole[]): Viewer {
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "",
    platformRole: null,
    memberships: roles.length
      ? [
          {
            teamId: TEAM,
            teamSlug: "coral-offers",
            teamName: "Coral Offers",
            roles,
            status: "active",
          },
        ]
      : [],
  };
}

const jordan = person("jordan", ["approver"]);
const maya = person("maya", ["author"]);
const dana = person("dana", ["viewer"]);
const base = {
  teamId: TEAM,
  submittedBy: "maya",
  writers: ["maya"],
  stage: teamStage!,
};

describe("decideCheck", () => {
  it("lets a team approver decide the team stage", () => {
    expect(decideCheck(jordan, base)).toEqual({ ok: true });
  });

  it("refuses someone with no approver role, and the version's writers, by `can`", () => {
    expect(decideCheck(maya, base)).toMatchObject({
      ok: false,
      code: "submitted_version",
    });
    expect(decideCheck(dana, base)).toMatchObject({
      ok: false,
      code: "generic",
    });
  });

  it("refuses a stage that has left the chain, then anyone the stage doesn't name", () => {
    expect(decideCheck(jordan, { ...base, stage: null })).toMatchObject({
      ok: false,
      code: REFUSALS.stageMissing.code,
    });
    expect(decideCheck(jordan, { ...base, stage: legalStage! })).toMatchObject({
      ok: false,
      code: "waiting_on_stage",
    });
    expect(decideCheck(dana, { ...base, stage: legalStage! })).toEqual({
      ok: true,
    });
  });

  it("refuses an approver who approved an earlier stage of the round", () => {
    expect(
      decideCheck(dana, { ...base, stage: legalStage!, approvedBy: ["dana"] }),
    ).toMatchObject({ ok: false, code: REFUSALS.approvedEarlierStage.code });
    expect(
      decideCheck(dana, {
        ...base,
        stage: legalStage!,
        approvedBy: ["jordan"],
      }),
    ).toEqual({ ok: true });
  });
});
