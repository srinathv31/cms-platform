import { describe, expect, it, vi } from "vitest";
import { consequences } from "@/domain/consequences";
import type { ActivityItem, ConsumerUsage, ReviewQueueRow } from "@/domain/review-types";
import { dayGroups } from "@/components/activity/day-groups";
import { formatQueueRow } from "@/components/review-queue/format-row";
import { lastActive } from "@/components/settings/team/format";
import { formatLastRender, sunsetPhrase } from "./format";

// "Today" and "yesterday" mean the same day on every screen (D9, decision 0028): the approve, sunset and
// revoke dialogs' consequence lines, the Usage tables, the Versions timeline, the Activity tab's
// headings, the review queue (worded on the server) and the Team settings tables. Each counts calendar
// days on the demo clock, in UTC, through `formatAgo`. These run with the server in New York, where
// 23:00 UTC is still the evening before, so a local day would show up as a disagreement.

vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

/** What each screen says about the instant `at`, at `now`. */
function screens(at: string, now: Date) {
  const usage: ConsumerUsage[] = [{ consumerId: "coral", consumerName: "Coral", versionNumber: 1, lastRenderAt: at, renders30d: 0 }];
  const sunset = consequences({ kind: "sunset", number: 1, sunsetAt: "2027-03-01", activeNumber: 2 }, usage, now)[0]!;
  const revoke = consequences({ kind: "revoke", number: 1, activeNumber: 2 }, usage, now)[0]!;
  const activity: ActivityItem = { id: "a", at, actor: null, action: "draft.edited", versionNumber: null, summary: "a" };
  const queue: ReviewQueueRow = {
    templateId: "UC-4F7K2Q",
    templateName: "Cash Back",
    teamSlug: "coral-offers",
    teamName: "Coral Offers",
    versionId: "ver_1",
    versionNumber: 3,
    state: "in_review",
    author: { id: "maya", name: "Maya Chen", initials: "MC", hue: 40 },
    submittedAt: at,
    stage: { position: 0, name: "Team approver", count: 1 },
    breaking: false,
  };
  return {
    sunsetDialog: /\(last render (.+)\)/.exec(sunset)?.[1],
    revokeDialog: /last rendered v1 (.+)\. Its/.exec(revoke)?.[1],
    usageTable: formatLastRender(at, now),
    activityHeading: dayGroups([activity], now)[0]!.label,
    reviewQueue: formatQueueRow(queue, "coral-offers", now).submitted,
    teamSettings: lastActive(at, now.toISOString().slice(0, 10)),
  };
}

describe("today and yesterday agree across screens", () => {
  const ONE_AM = new Date("2026-10-04T01:00:00.000Z");

  it("calls 23:00 yesterday yesterday at 01:00, on every screen, though two hours have passed", () => {
    expect(screens("2026-10-03T23:00:00.000Z", ONE_AM)).toEqual({
      sunsetDialog: "yesterday",
      revokeDialog: "yesterday",
      usageTable: "yesterday",
      activityHeading: "Yesterday",
      reviewQueue: "yesterday",
      teamSettings: "Yesterday",
    });
  });

  it("calls 00:30 today today at 01:00, on every screen that counts in days", () => {
    expect(screens("2026-10-04T00:30:00.000Z", ONE_AM)).toEqual({
      sunsetDialog: "today",
      revokeDialog: "today",
      usageTable: "today",
      activityHeading: "Today",
      reviewQueue: "30 minutes ago",
      teamSettings: "Today",
    });
  });

  it("counts 23:59 two days back as two days, though barely more than a day has passed", () => {
    const { activityHeading, ...rest } = screens("2026-10-02T23:59:00.000Z", ONE_AM);
    expect(Object.values(rest)).toEqual(Array(5).fill("2 days ago"));
    expect(activityHeading).toBe("Oct 2");
  });

  it("agrees at the end of the day too: 00:30 is still today at 23:59, and 23:59 is yesterday a minute later", () => {
    expect(screens("2026-10-04T00:30:00.000Z", new Date("2026-10-04T23:59:00.000Z"))).toEqual({
      sunsetDialog: "today",
      revokeDialog: "today",
      usageTable: "today",
      activityHeading: "Today",
      reviewQueue: "23 hours ago",
      teamSettings: "Today",
    });
    expect(screens("2026-10-04T23:59:00.000Z", new Date("2026-10-05T00:00:00.000Z"))).toEqual({
      sunsetDialog: "yesterday",
      revokeDialog: "yesterday",
      usageTable: "yesterday",
      activityHeading: "Yesterday",
      reviewQueue: "yesterday",
      teamSettings: "Yesterday",
    });
  });
});

describe("the Usage screens' own phrases", () => {
  it("gives the render's date from two weeks", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(formatLastRender("2026-09-21T12:00:00.000Z", now)).toBe("13 days ago");
    expect(formatLastRender("2026-09-20T12:00:00.000Z", now)).toBe("Sep 20");
  });

  it("says when a sunset comes, from the days the read model counted in the business time zone", () => {
    expect(sunsetPhrase(0)).toBe("sunsets today");
    expect(sunsetPhrase(1)).toBe("sunsets tomorrow");
    expect(sunsetPhrase(21)).toBe("sunsets in 21 days");
  });
});
