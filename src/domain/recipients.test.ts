import { describe, expect, it } from "vitest";
import {
  notificationRecipients,
  recipientLink,
  type RecipientFacts,
  type RecipientMembership,
} from "./recipients";

const member = (
  userId: string,
  team: "coral" | "deposits",
  roles: RecipientMembership["roles"],
  status: RecipientMembership["status"] = "active",
): RecipientMembership => ({
  userId,
  teamId: `t_${team}`,
  teamName: team === "coral" ? "Coral Offers" : "Deposits",
  status,
  roles,
});

describe("notificationRecipients", () => {
  const team = [
    member("jordan", "coral", ["approver"]),
    member("alex", "coral", ["approver", "author"]),
    member("maya", "coral", ["author"]),
    member("sam", "coral", ["approver"], "suspended"),
    member("dana", "deposits", ["approver"]),
  ];

  it("is every active holder of the role on the team, sorted, less the exceptions and the actor", () => {
    expect(
      notificationRecipients(
        { kind: "team_role", role: "approver" },
        "t_coral",
        team,
        null,
      ),
    ).toEqual(["alex", "jordan"]);
    expect(
      notificationRecipients(
        { kind: "team_role", role: "approver", exceptUserIds: ["alex"] },
        "t_coral",
        team,
        "jordan",
      ),
    ).toEqual([]);
  });

  it("is the person named, unless they acted themselves", () => {
    const to = { kind: "user" as const, userId: "maya" };
    expect(notificationRecipients(to, "t_coral", [], "alex")).toEqual(["maya"]);
    expect(notificationRecipients(to, "t_coral", [], "maya")).toEqual([]);
  });
});

describe("recipientLink", () => {
  const review = {
    to: "review" as const,
    templateId: "UC-AAAAAA",
    versionNumber: 2,
  };
  const versions = { to: "versions" as const, templateId: "UC-AAAAAA" };
  const template = { to: "template" as const, templateId: "UC-AAAAAA" };
  const dana: RecipientFacts = {
    userId: "dana",
    platformRole: null,
    memberships: [member("dana", "deposits", ["approver"])],
  };

  it("keeps the template's team for anyone who can see it, and for a link that can't move", () => {
    const jordan: RecipientFacts = {
      userId: "jordan",
      platformRole: null,
      memberships: [member("jordan", "coral", ["approver"])],
    };
    expect(recipientLink(jordan, "t_coral", review)).toEqual({
      ...review,
      teamId: "t_coral",
    });
    expect(recipientLink(dana, "t_coral", versions)).toEqual({
      ...versions,
      teamId: "t_coral",
    });
    expect(recipientLink(dana, "t_coral", template)).toEqual({
      ...template,
      teamId: "t_coral",
    });
    expect(
      recipientLink(
        { userId: "riley", platformRole: "platform_admin", memberships: [] },
        "t_coral",
        review,
      ).teamId,
    ).toBe("t_coral");
  });

  it("opens a review in a stage reviewer's own space, and turns a template link naming a version into its review", () => {
    expect(recipientLink(dana, "t_coral", review)).toEqual({
      ...review,
      teamId: "t_deposits",
    });
    expect(
      recipientLink(dana, "t_coral", {
        to: "template",
        templateId: "UC-AAAAAA",
        reviewVersion: { number: 3, round: 2 },
      }),
    ).toEqual({
      to: "review",
      teamId: "t_deposits",
      templateId: "UC-AAAAAA",
      versionNumber: 3,
      round: 2,
    });
  });

  it("names the round exactly when the link does, for the outside reviewer", () => {
    expect(recipientLink(dana, "t_coral", { ...review, round: 2 })).toEqual({
      ...review,
      teamId: "t_deposits",
      round: 2,
    });
    // No round named: the review screen is the number's head (or the newest round they decided).
    const noRound = recipientLink(dana, "t_coral", {
      to: "template",
      templateId: "UC-AAAAAA",
      reviewVersion: { number: 3 },
    });
    expect(noRound).toEqual({
      to: "review",
      teamId: "t_deposits",
      templateId: "UC-AAAAAA",
      versionNumber: 3,
    });
    expect(noRound).not.toHaveProperty("round");
  });

  it("drops the version a template link names once it is placed in the template's team", () => {
    const jordan: RecipientFacts = {
      userId: "jordan",
      platformRole: null,
      memberships: [member("jordan", "coral", ["approver"])],
    };
    const named = {
      to: "template" as const,
      templateId: "UC-AAAAAA",
      reviewVersion: { number: 3, round: 2 },
    };
    expect(recipientLink(jordan, "t_coral", named)).toEqual({
      ...template,
      teamId: "t_coral",
    });
  });

  it("opens in the template's own space for a member of it who also has another team", () => {
    const both: RecipientFacts = {
      userId: "dana",
      platformRole: null,
      memberships: [
        member("dana", "deposits", ["approver"]),
        member("dana", "coral", ["viewer"]),
      ],
    };
    expect(recipientLink(both, "t_coral", review)).toEqual({
      ...review,
      teamId: "t_coral",
    });
  });

  it("places the link in the template's team when there is no recipient to read", () => {
    expect(recipientLink(null, "t_coral", review)).toEqual({
      ...review,
      teamId: "t_coral",
    });
    expect(recipientLink(null, "t_coral", { ...review, round: 2 })).toEqual({
      ...review,
      teamId: "t_coral",
      round: 2,
    });
    expect(recipientLink(null, "t_coral", versions)).toEqual({
      ...versions,
      teamId: "t_coral",
    });
    expect(recipientLink(null, "t_coral", template)).toEqual({
      ...template,
      teamId: "t_coral",
    });
    // A template link naming a version only becomes its review for a reviewer outside the team.
    expect(
      recipientLink(null, "t_coral", {
        ...template,
        reviewVersion: { number: 3, round: 2 },
      }),
    ).toEqual({ ...template, teamId: "t_coral" });
  });
});
