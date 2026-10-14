import { describe, expect, it } from "vitest";
import { shellOf, spaceNamed, type SpaceTeam } from "./spaces";
import type { TeamRole, Viewer } from "./types";

// The URL names a space by its slug; the rest of the app by the team's id, which is never the slug (decision
// 0053). These fixtures keep the two apart, so a rule that compares one with the other fails here.

const CORAL: SpaceTeam = {
  id: "t_coral",
  slug: "coral-offers",
  name: "Coral Offers",
  icon: "credit-card",
};
const DEPOSITS: SpaceTeam = {
  id: "t_deposits",
  slug: "deposits",
  name: "Deposits",
  icon: "piggy-bank",
};
const TEAMS = [DEPOSITS, CORAL];

function person(
  teams: [SpaceTeam, TeamRole[]][],
  platformRole: Viewer["platformRole"] = null,
): Viewer {
  return {
    userId: "u",
    name: "U",
    initials: "U",
    title: "",
    platformRole,
    memberships: teams.map(([team, roles]) => ({
      teamId: team.id,
      teamSlug: team.slug,
      teamName: team.name,
      roles,
      status: "active",
    })),
  };
}

const alex = person([[CORAL, ["team_admin", "approver"]]]);
const maya = person([[CORAL, ["author"]]]);
const riley = person([], "platform_admin");
const taylor = person([], "auditor");
const morgan = person([]);

describe("spaceNamed", () => {
  it("resolves a slug to its team, with what the viewer may do there", () => {
    expect(spaceNamed(alex, "coral-offers", CORAL)).toEqual({
      teamId: "t_coral",
      slug: "coral-offers",
      name: "Coral Offers",
      kind: "team",
      icon: "credit-card",
      can: {
        viewAudit: { ok: true },
        manageMembers: { ok: true },
        managePlatform: expect.objectContaining({ ok: false }),
      },
    });
    expect(spaceNamed(maya, "coral-offers", CORAL)?.can).toMatchObject({
      viewAudit: { ok: false },
      manageMembers: { ok: false },
    });
  });

  it("is null for a slug no team has, a team the viewer can't see, and a team that isn't the slug's", () => {
    expect(spaceNamed(maya, "nope", undefined)).toBeNull();
    expect(spaceNamed(maya, "deposits", DEPOSITS)).toBeNull();
    expect(spaceNamed(morgan, "coral-offers", CORAL)).toBeNull();
    // The id is not a slug: the team found for another slug opens nothing.
    expect(spaceNamed(maya, "t_coral", CORAL)).toBeNull();
  });

  it("opens All teams to the platform roles only", () => {
    expect(spaceNamed(riley, "all", undefined)).toMatchObject({
      teamId: null,
      slug: "all",
      kind: "all",
      icon: null,
      can: { managePlatform: { ok: true }, manageMembers: { ok: false } },
    });
    expect(spaceNamed(taylor, "all", undefined)?.can.viewAudit).toEqual({
      ok: true,
    });
    expect(spaceNamed(alex, "all", undefined)).toBeNull();
  });
});

describe("shellOf", () => {
  it("lists a member's teams by name, with each team's icon", () => {
    const priya = person([
      [DEPOSITS, ["viewer"]],
      [CORAL, ["author"]],
    ]);
    const shell = shellOf(priya, TEAMS);
    expect(shell.spaces.map((s) => [s.teamId, s.slug, s.icon])).toEqual([
      ["t_coral", "coral-offers", "credit-card"],
      ["t_deposits", "deposits", "piggy-bank"],
    ]);
    expect(shell.can.requestAccess).toEqual({ ok: true });
  });

  it("puts All teams first for a platform role, then every team", () => {
    expect(shellOf(riley, TEAMS).spaces.map((s) => s.teamId)).toEqual([
      null,
      "t_coral",
      "t_deposits",
    ]);
    expect(shellOf(taylor, TEAMS).can.requestAccess.ok).toBe(false);
  });

  it("is empty for someone on no team", () => {
    expect(shellOf(morgan, TEAMS).spaces).toEqual([]);
  });
});
