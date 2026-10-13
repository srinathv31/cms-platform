import { describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Person } from "@/domain/review-types";
import type { TemplateActivity } from "@/server/services/activity";
import { refusal } from "@/server/services/results";
import { activityData, getActivity } from "./activity";

// The Activity tab's read model as the BFF builds it: the service's events in (`audit.activity`), sentences out.
// `activityData` is pure, so its tests hand it facts directly; which events, in what order, is the contract suite's
// (src/server/services/contract/activity.ts). `getActivity` is checked for what it adds: the space, Not found.

const env = vi.hoisted(() => ({ activity: undefined as unknown }));
vi.mock("@/server/context/request", () => ({
  requireRequestContext: async () => ({
    viewer: { userId: "sam" },
    correlationId: "req_test",
  }),
}));
vi.mock("@/server/services", () => ({
  services: () => ({ audit: { activity: async () => env.activity } }),
}));
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => ({
    slug,
    teamId: slug === "all" ? null : `t_${slug}`,
  }),
}));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const JORDAN: Person = {
  id: "jordan",
  name: "Jordan Ellis",
  initials: "JE",
  hue: 200,
};

const FACTS: TemplateActivity = {
  asOf: ASOF,
  template: { id: "UC-BAL001", teamId: "t_coral" },
  events: [
    {
      id: "ae_2",
      at: "2026-10-03T12:00:00.000Z",
      actorId: null,
      action: "version.superseded",
      versionId: "v_1",
      version: { number: 1, round: 1, state: "superseded" },
      details: { supersededBy: 2 },
    },
    {
      id: "ae_1",
      at: "2026-10-02T12:00:00.000Z",
      actorId: "jordan",
      action: "version.activated",
      versionId: "v_2",
      version: { number: 2, round: 3, state: "active" },
      details: {},
    },
    {
      id: "ae_0",
      at: "2026-09-01T12:00:00.000Z",
      actorId: "jordan",
      action: "template.created",
      versionId: null,
      version: null,
      details: {},
    },
  ],
  people: [JORDAN],
};

describe("activityData", () => {
  it("words each event as a sentence, with its actor and its version's label, and counts from the backend's instant", () => {
    const data = activityData(FACTS);
    expect(data.now).toBe(ASOF);
    expect(data.items).toEqual([
      {
        id: "ae_2",
        at: "2026-10-03T12:00:00.000Z",
        actor: null,
        action: "version.superseded",
        versionLabel: "v1",
        summary: "v1 was superseded by v2.",
      },
      {
        id: "ae_1",
        at: "2026-10-02T12:00:00.000Z",
        actor: JORDAN,
        action: "version.activated",
        // A review event names the round it was approved on.
        versionLabel: "v2 · Round 3",
        summary: "Jordan Ellis approved v2 on round 3, making it Active.",
      },
      {
        id: "ae_0",
        at: "2026-09-01T12:00:00.000Z",
        actor: JORDAN,
        action: "template.created",
        versionLabel: null,
        summary: "Jordan Ellis created the template.",
      },
    ]);
  });
});

describe("getActivity", () => {
  it("reads the template's activity in its own team's space and in All teams", async () => {
    env.activity = { ok: true, ...FACTS };
    expect((await getActivity("coral", "UC-BAL001")).items).toHaveLength(3);
    expect((await getActivity("all", "UC-BAL001")).items).toHaveLength(3);
  });

  it("is Not found in another team's space, or when the service refuses", async () => {
    env.activity = { ok: true, ...FACTS };
    await expect(getActivity("deposits", "UC-BAL001")).rejects.toThrow(
      NOT_FOUND,
    );
    env.activity = refusal(404, REQUEST_REFUSALS.templateUnavailable);
    await expect(getActivity("coral", "UC-BAL001")).rejects.toThrow(NOT_FOUND);
  });
});
