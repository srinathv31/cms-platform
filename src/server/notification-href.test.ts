import { describe, expect, it } from "vitest";
import type { StoredNotificationLink } from "@/domain/notifications";
import { notificationHref } from "./notification-href";

// A stored link names its team by id; the href is built when the bell reads it, with the slug the viewer's
// spaces give that team (decisions 0053 and 0055).

const SLUGS: Record<string, string> = {
  t_coral: "coral-offers",
  t_deposits: "deposits",
};
const slugOf = (teamId: string) => SLUGS[teamId] ?? null;
const href = (link: StoredNotificationLink) => notificationHref(link, slugOf);

describe("notificationHref", () => {
  it("builds a lifecycle link under its team's slug, a review link with its round when it names one", () => {
    const templateId = "UC-AAAAAA";
    expect(
      href({
        to: "review",
        teamId: "t_deposits",
        templateId,
        versionNumber: 2,
      }),
    ).toBe("/deposits/review/UC-AAAAAA/2");
    expect(
      href({
        to: "review",
        teamId: "t_deposits",
        templateId,
        versionNumber: 2,
        round: 3,
      }),
    ).toBe("/deposits/review/UC-AAAAAA/2?round=3");
    expect(href({ to: "template", teamId: "t_coral", templateId })).toBe(
      "/coral-offers/templates/UC-AAAAAA",
    );
    expect(href({ to: "versions", teamId: "t_coral", templateId })).toBe(
      "/coral-offers/templates/UC-AAAAAA/versions",
    );
  });

  it("builds an access link under its team's slug, never its id, and the links outside a team as they are", () => {
    expect(
      href({ to: "settings", teamId: "t_coral", section: "access-requests" }),
    ).toBe("/coral-offers/settings/access-requests");
    expect(href({ to: "library", teamId: "t_deposits" })).toBe(
      "/deposits/library",
    );
    expect(href({ to: "request-access" })).toBe("/request-access");
    expect(href({ to: "platform", section: "teams" })).toBe(
      "/all/settings/teams",
    );
  });

  it("follows the team's slug as it is when read: a rename moves no stored link", () => {
    const link: StoredNotificationLink = { to: "library", teamId: "t_coral" };
    expect(notificationHref(link, () => "coral-cards")).toBe(
      "/coral-cards/library",
    );
  });

  it("opens the app's root for a team the viewer can't enter, and for a link it doesn't know", () => {
    expect(href({ to: "library", teamId: "t_cards" })).toBe("/");
    expect(
      href({
        to: "somewhere-new",
      } as unknown as StoredNotificationLink),
    ).toBe("/");
  });
});
