import { describe, expect, it } from "vitest";
import {
  notificationRecipients,
  recipientLink,
  type RecipientFacts,
  type RecipientMembership,
} from "./recipients";

const member = (
  userId: string,
  teamSlug: string,
  roles: RecipientMembership["roles"],
  status: RecipientMembership["status"] = "active",
): RecipientMembership => ({
  userId,
  teamId: `t_${teamSlug}`,
  teamSlug,
  teamName: teamSlug === "coral" ? "Coral Offers" : "Deposits",
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
    expect(recipientLink(jordan, "coral", review)).toEqual({
      teamSlug: "coral",
      link: review,
    });
    const versions = { to: "versions" as const, templateId: "UC-AAAAAA" };
    expect(recipientLink(dana, "coral", versions)).toEqual({
      teamSlug: "coral",
      link: versions,
    });
    expect(
      recipientLink(
        { userId: "riley", platformRole: "platform_admin", memberships: [] },
        "coral",
        review,
      ).teamSlug,
    ).toBe("coral");
  });

  it("opens a review in a stage reviewer's own space, and turns a template link naming a version into its review", () => {
    expect(recipientLink(dana, "coral", review)).toEqual({
      teamSlug: "deposits",
      link: review,
    });
    expect(
      recipientLink(dana, "coral", {
        to: "template",
        templateId: "UC-AAAAAA",
        reviewVersion: { number: 3, round: 2 },
      }),
    ).toEqual({
      teamSlug: "deposits",
      link: {
        to: "review",
        templateId: "UC-AAAAAA",
        versionNumber: 3,
        round: 2,
      },
    });
  });
});
