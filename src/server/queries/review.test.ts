import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_THREAD, type Person } from "@/domain/review-types";
import { refusal } from "@/server/services/results";
import type {
  QueueRow,
  ReviewQueueFacts,
  ReviewScreenFacts,
} from "@/server/services/review-reads";
import {
  getReviewBadgeCount,
  getReviewQueue,
  getReviewScreen,
  reviewQueueData,
  reviewScreenData,
} from "./review";

// The review queue's and the review screen's read models as the BFF builds them: facts in (what the review service
// answers), the screens' data out. `reviewQueueData` and `reviewScreenData` are pure, so their tests hand them
// facts directly; what the service decides (who waits on what, which round a URL opens, the baselines, `can`) is
// the contract suite's (src/server/services/contract/review-reads.ts). The `get…` read models are checked for what
// they add: the space handed to the service by its team id, Not found, and the badge's fallback.

const env = vi.hoisted(() => ({
  queue: undefined as unknown,
  badge: undefined as unknown,
  screen: undefined as unknown,
  asked: [] as unknown[],
}));
vi.mock("@/server/context/request", () => ({
  requireRequestContext: async () => ({
    viewer: { userId: "jordan" },
    correlationId: "req_test",
  }),
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    review: {
      queue: async (_ctx: unknown, input: unknown) => {
        env.asked.push(["queue", input]);
        return env.queue;
      },
      badgeCount: async (_ctx: unknown, input: unknown) => {
        env.asked.push(["badgeCount", input]);
        return env.badge;
      },
      screen: async (_ctx: unknown, input: unknown) => {
        env.asked.push(["screen", input]);
        return env.screen;
      },
    },
  }),
}));
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => ({
    slug,
    isAll: slug === "all",
    teamId: slug === "all" ? null : `t_${slug}`,
    name: slug,
  }),
}));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  hue: 10,
});
const MAYA = person("maya", "Maya Chen");
const JORDAN = person("jordan", "Jordan Ellis");

/** A queue row as the service answers it: Cash Back v3 round 2 unless `over` says otherwise. */
function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    templateId: "UC-CASH01",
    templateName: "Cash Back Welcome Bonus — Terms",
    teamId: "t_coral",
    teamSlug: "coral-offers",
    teamName: "Coral Offers",
    versionId: "v_cash_3_2",
    round: { number: 3, round: 2, state: "in_review" },
    authorId: "maya",
    submittedAt: "2026-10-03T12:00:00.000Z",
    stage: { position: 0, name: "Team approver", count: 1 },
    breaking: true,
    ...over,
  };
}

beforeEach(() => {
  env.asked = [];
});

describe("reviewQueueData", () => {
  const facts: ReviewQueueFacts = {
    asOf: ASOF,
    waiting: [
      row({
        templateId: "UC-ALERT1",
        templateName: "Card Used Abroad",
        versionId: "v_alert",
        submittedAt: "2026-10-02T12:00:00.000Z",
        round: { number: 1, round: 1, state: "in_review" },
        authorId: "priya",
        breaking: false,
      }),
      row(),
    ],
    submitted: [],
    decided: [
      {
        ...row({
          versionId: "v_cash_3_1",
          round: { number: 3, round: 1, state: "changes_requested" },
        }),
        decision: {
          kind: "changes_requested",
          by: "jordan",
          at: "2026-10-01T22:00:00.000Z",
        },
      },
    ],
    people: [MAYA, JORDAN],
  };

  it("names each row's author and decider, and lists waiting rounds newest submitted first", () => {
    const queue = reviewQueueData(facts);
    expect(queue.now).toBe(ASOF);
    expect(queue.waiting.map((r) => r.templateId)).toEqual([
      "UC-CASH01",
      "UC-ALERT1",
    ]);
    expect(queue.waiting[0]).toEqual({
      templateId: "UC-CASH01",
      templateName: "Cash Back Welcome Bonus — Terms",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      versionId: "v_cash_3_2",
      versionNumber: 3,
      round: 2,
      state: "in_review",
      author: MAYA,
      submittedAt: "2026-10-03T12:00:00.000Z",
      stage: { position: 0, name: "Team approver", count: 1 },
      breaking: true,
    });
    // Someone the facts don't name (a user row gone) gets a stand-in built from the id.
    expect(queue.waiting[1]!.author).toMatchObject({
      id: "priya",
      name: "priya",
    });
    expect(queue.decided).toEqual([
      expect.objectContaining({
        versionNumber: 3,
        round: 1,
        state: "changes_requested",
        decision: {
          kind: "changes_requested",
          by: JORDAN,
          at: "2026-10-01T22:00:00.000Z",
        },
      }),
    ]);
  });

  it("breaks a tie on the submit time by the name", () => {
    const at = "2026-10-03T12:00:00.000Z";
    const queue = reviewQueueData({
      ...facts,
      waiting: [
        row({ templateName: "Zeta", submittedAt: at }),
        row({ templateName: "Alpha", submittedAt: at }),
      ],
    });
    expect(queue.waiting.map((r) => r.templateName)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("getReviewQueue and getReviewBadgeCount", () => {
  it("ask for the URL's space by its team id (All teams: null)", async () => {
    env.queue = {
      ok: true,
      asOf: ASOF,
      waiting: [],
      submitted: [],
      decided: [],
      people: [],
    };
    env.badge = { ok: true, count: 2 };
    expect(await getReviewQueue("coral")).toMatchObject({ now: ASOF });
    expect(await getReviewBadgeCount("all")).toBe(2);
    expect(env.asked).toEqual([
      ["queue", { teamId: "t_coral" }],
      ["badgeCount", { teamId: null }],
    ]);
  });

  it("the queue is Not found when the service refuses; the badge is 0", async () => {
    env.queue = refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    env.badge = refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    await expect(getReviewQueue("coral")).rejects.toThrow(NOT_FOUND);
    expect(await getReviewBadgeCount("coral")).toBe(0);
  });
});

/** A review screen as the service answers it: Cash Back v3 round 1, sent back by Jordan, then resubmitted. */
function screenFacts(over: Partial<ReviewScreenFacts> = {}): ReviewScreenFacts {
  return {
    asOf: ASOF,
    template: {
      id: "UC-CASH01",
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      family: "document",
    },
    version: {
      id: "v_cash_3_1",
      number: 3,
      round: 1,
      state: "changes_requested",
      name: "Cash Back Welcome Bonus — Terms",
      body: { type: "doc", content: [] },
      variables: [],
      channels: ["web"],
      channelFields: {},
      sampleSets: [],
      smsFooter: null,
      submittedBy: "maya",
      submittedAt: "2026-10-01T12:00:00.000Z",
      submitNote: null,
      sunsetDay: null,
      sunsetPassed: false,
      contractChanges: [
        {
          kind: "added",
          key: "annual_fee",
          breaking: true,
          type: "currency",
          required: true,
        },
      ],
      stages: [{ id: "st_team", name: "Team approver" }],
      currentStage: 0,
      decisions: [
        {
          stageId: "st_team",
          kind: "changes_requested",
          by: "jordan",
          at: "2026-10-01T22:00:00.000Z",
        },
      ],
    },
    baseline: null,
    previousNumber: 2,
    stillRenders: null,
    replacedBy: { number: 3, round: 2, state: "in_review" },
    liveName: "Cash Back Welcome Bonus — Terms",
    threads: [
      {
        id: "th_request",
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "resolved",
        origin: { number: 3, round: 1, state: "changes_requested" },
        comments: [
          {
            id: "c_1",
            authorId: "jordan",
            body: "Add the annual fee.",
            kind: "change_request",
            createdAt: "2026-10-01T22:00:00.000Z",
          },
        ],
        resolvedBy: "maya",
        resolvedAt: "2026-10-02T09:00:00.000Z",
        orphaned: false,
      },
    ],
    can: {
      approve: { ok: false, ...REFUSALS.notInReview },
      requestChanges: { ok: false, ...REFUSALS.notInReview },
      comment: { ok: true },
    },
    consumerUsage: [],
    sunsetCalendar: { zone: "America/New_York", today: "2026-10-04" },
    messageRules: { smsFooter: null, smsMaxParts: 3 },
    senders: { appName: null, smsSender: null },
    people: [MAYA, JORDAN],
    ...over,
  };
}

describe("reviewScreenData", () => {
  it("words the facts: the contract lines, where the round's work went, the stepper, the threads, today and who is looking", () => {
    const data = reviewScreenData(screenFacts(), "jordan");
    expect(data.version).toMatchObject({
      id: "v_cash_3_1",
      number: 3,
      round: 1,
      submittedBy: MAYA,
      contractLines: ["v3 adds required `annual_fee` (Currency)."],
    });
    expect(data.version).not.toHaveProperty("decisions");
    expect(data.replacedBy).toEqual({
      number: 3,
      round: 2,
      state: "in_review",
      label: "v3, round 2",
    });
    expect(data.steps).toEqual([
      {
        position: 0,
        name: "Team approver",
        status: "returned",
        decidedBy: JORDAN,
        decidedAt: "2026-10-01T22:00:00.000Z",
      },
    ]);
    expect(data.threads).toEqual([
      expect.objectContaining({
        id: "th_request",
        originVersionNumber: 3,
        originRound: 1,
        originLabel: "v3 · Round 1",
        resolvedBy: MAYA,
        comments: [expect.objectContaining({ author: JORDAN })],
      }),
    ]);
    expect([data.now, data.today, data.viewer]).toEqual([
      ASOF,
      "2026-10-04",
      JORDAN,
    ]);
    expect(data.can).toEqual(screenFacts().can);
  });

  it("names the head without its round once it is released", () => {
    expect(
      reviewScreenData(
        screenFacts({ replacedBy: { number: 3, round: 2, state: "active" } }),
        "jordan",
      ).replacedBy?.label,
    ).toBe("v3");
  });
});

describe("getReviewScreen", () => {
  it("asks for the round from the URL's space, by its team id", async () => {
    env.screen = { ok: true, ...screenFacts() };
    const data = await getReviewScreen("coral", "UC-CASH01", 3, 1);
    expect(data.version.id).toBe("v_cash_3_1");
    expect(data.viewer).toEqual(JORDAN);
    expect(env.asked).toEqual([
      [
        "screen",
        {
          teamId: "t_coral",
          templateId: "UC-CASH01",
          versionNumber: 3,
          round: 1,
        },
      ],
    ]);
  });

  it("is Not found when the service refuses", async () => {
    env.screen = refusal(404, REQUEST_REFUSALS.versionUnavailable);
    await expect(getReviewScreen("coral", "UC-CASH01", 3, 9)).rejects.toThrow(
      NOT_FOUND,
    );
  });
});
