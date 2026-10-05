import { describe, expect, it } from "vitest";
import type { ReviewQueueRow } from "@/domain/review-types";
import { defaultTab, formatQueueRow, parseTab, queueTabs, TAB_META } from "./format-row";

const NOW = new Date("2026-10-04T15:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const maya = { id: "maya", name: "Maya Chen", initials: "MC", hue: 40 };
const jordan = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };

const row = (over: Partial<ReviewQueueRow> = {}): ReviewQueueRow => ({
  templateId: "UC-4F7K2Q",
  templateName: "Cash Back",
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  versionId: "ver_1",
  versionNumber: 3,
  state: "in_review",
  author: maya,
  submittedAt: ago(3 * DAY),
  stage: { position: 0, name: "Team approver", count: 1 },
  breaking: true,
  ...over,
});

describe("formatQueueRow", () => {
  it("links to the review screen in the current space and reads the version as v{N}", () => {
    const view = formatQueueRow(row(), "all", NOW);
    expect(view.href).toBe("/all/review/UC-4F7K2Q/3");
    expect(view.versionLabel).toBe("v3");
    expect(view.name).toBe("Cash Back");
    expect(view.teamName).toBe("Coral Offers");
    expect(view.author).toEqual(maya);
  });

  it("words the submit time against the demo clock", () => {
    expect(formatQueueRow(row({ submittedAt: ago(3 * DAY) }), "coral-offers", NOW).submitted).toBe("3 days ago");
    expect(formatQueueRow(row({ submittedAt: ago(10_000) }), "coral-offers", NOW).submitted).toBe("just now");
    expect(formatQueueRow(row({ submittedAt: ago(2 * 3_600_000) }), "coral-offers", NOW).submitted).toBe("2 hours ago");
  });

  it("says on one line what the folded columns would: who and when, and for a decision what, who and when", () => {
    expect(formatQueueRow(row({ submittedAt: ago(3 * DAY) }), "coral-offers", NOW).folded).toBe(
      "Maya Chen · 3 days ago · Team approver",
    );
    const decided = formatQueueRow(
      row({ decision: { kind: "approved", by: jordan, at: ago(2 * DAY) } }),
      "coral-offers",
      NOW,
    );
    expect(decided.folded).toBe("Approved by Jordan Ellis · 2 days ago");
  });

  it("carries the breaking flag", () => {
    expect(formatQueueRow(row({ breaking: true }), "coral-offers", NOW).breaking).toBe(true);
    expect(formatQueueRow(row({ breaking: false }), "coral-offers", NOW).breaking).toBe(false);
  });

  it("names the stage, and its place only when the chain has more than one", () => {
    const single = formatQueueRow(row(), "coral-offers", NOW);
    expect([single.stage, single.stageStep]).toEqual(["Team approver", null]);
    const multi = formatQueueRow(row({ stage: { position: 1, name: "Legal reviewer", count: 2 } }), "coral-offers", NOW);
    expect([multi.stage, multi.stageStep]).toEqual(["Legal reviewer", "Stage 2 of 2"]);
  });

  it("has no decision on a row waiting for one", () => {
    expect(formatQueueRow(row(), "coral-offers", NOW).decision).toBeUndefined();
  });

  it("words a decision: what, who and when", () => {
    const approved = formatQueueRow(
      row({ decision: { kind: "approved", by: jordan, at: ago(2 * DAY) } }),
      "coral-offers",
      NOW,
    );
    expect(approved.decision).toEqual({ kind: "approved", label: "Approved", by: "Jordan Ellis", when: "2 days ago" });
    const returned = formatQueueRow(
      row({ decision: { kind: "changes_requested", by: jordan, at: ago(5 * DAY) } }),
      "coral-offers",
      NOW,
    );
    expect(returned.decision?.label).toBe("Changes requested");
    expect(returned.decision?.when).toBe("5 days ago");
  });
});

describe("queueTabs", () => {
  it("makes the three tabs in order, each with its rows and its quiet empty line", () => {
    const tabs = queueTabs({ waiting: [row()], submitted: [], decided: [] }, "coral-offers", NOW);
    expect(tabs.map((t) => [t.key, t.label, t.rows.length])).toEqual([
      ["waiting", "Waiting on me", 1],
      ["submitted", "Submitted by me", 0],
      ["decided", "Recently decided", 0],
    ]);
    expect(tabs.map((t) => t.empty)).toEqual([
      "Nothing waiting on you.",
      "You haven't submitted anything for review.",
      "No decisions in the last 30 days.",
    ]);
    expect(TAB_META.waiting.empty).toBe("Nothing waiting on you.");
  });
});

describe("parseTab", () => {
  it("reads the three tab names and nothing else", () => {
    expect(parseTab("waiting")).toBe("waiting");
    expect(parseTab("submitted")).toBe("submitted");
    expect(parseTab("decided")).toBe("decided");
    expect(parseTab("Waiting")).toBeNull();
    expect(parseTab("")).toBeNull();
    expect(parseTab(null)).toBeNull();
    expect(parseTab(undefined)).toBeNull();
  });
});

describe("defaultTab", () => {
  const tabs = (waiting: number, submitted: number, decided: number) =>
    queueTabs(
      {
        waiting: Array.from({ length: waiting }, (_, i) => row({ versionId: `w${i}` })),
        submitted: Array.from({ length: submitted }, (_, i) => row({ versionId: `s${i}` })),
        decided: Array.from({ length: decided }, (_, i) => row({ versionId: `d${i}` })),
      },
      "coral-offers",
      NOW,
    );

  it("opens on Waiting on me whenever something waits on the viewer", () => {
    expect(defaultTab(tabs(1, 0, 0))).toBe("waiting");
    expect(defaultTab(tabs(2, 3, 4))).toBe("waiting");
  });

  it("opens on the first tab with rows when nothing waits", () => {
    expect(defaultTab(tabs(0, 2, 5))).toBe("submitted");
    expect(defaultTab(tabs(0, 0, 5))).toBe("decided");
  });

  it("stays on Waiting on me when every tab is empty", () => {
    expect(defaultTab(tabs(0, 0, 0))).toBe("waiting");
  });
});
