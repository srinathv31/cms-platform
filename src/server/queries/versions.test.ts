import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { VersionActions } from "@/domain/lifecycle/version-actions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractChange } from "@/domain/types";
import type { VersionFacts, VersionHistory } from "@/server/services/versions";
import { getVersions, versionsData } from "./versions";

// The Versions tab's read model as the BFF builds it: facts in (VersionHistory, what the service answers),
// the timeline out. `versionsData` is pure, so its tests hand it facts directly; what the service decides (the
// `can` results, the sunset's day, which row is a number's head) is the contract suite's
// (src/server/services/contract/versions.ts). `getVersions` is checked for what it adds: the space, Not found,
// and sign-in.

const env = vi.hoisted(() => ({
  signedIn: true,
  history: undefined as unknown,
}));
vi.mock("@/server/context/request", async () => {
  const { signInRequired } = await import("@/server/context/sign-in");
  return {
    requireRequestContext: async () =>
      env.signedIn
        ? { viewer: { userId: "jordan" }, correlationId: "req_test" }
        : signInRequired(),
  };
});
vi.mock("@/server/services", () => ({
  services: () => ({ versions: { history: async () => env.history } }),
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
const ALL_OK: VersionActions = {
  setSunset: { ok: true },
  startRevoke: { ok: true },
  confirmRevoke: { ok: true },
  cancelRevoke: { ok: true },
};

/** One version row as the service answers it; a released head unless `over` says otherwise. */
function row(
  over: Partial<VersionFacts> & Pick<VersionFacts, "id">,
): VersionFacts {
  return {
    number: 1,
    round: 1,
    state: "superseded",
    head: true,
    createdBy: "maya",
    createdAt: "2026-09-01T12:00:00.000Z",
    submittedBy: "maya",
    submittedAt: "2026-09-02T12:00:00.000Z",
    submitNote: null,
    activatedAt: null,
    supersededAt: null,
    sunsetAt: null,
    sunsetDay: null,
    sunsetPassed: false,
    revoke: null,
    contractChanges: [],
    decisions: [],
    lastRenderAt: null,
    renders30d: 0,
    can: ALL_OK,
    ...over,
  };
}

function history(
  versions: VersionFacts[],
  over: Partial<VersionHistory> = {},
): VersionHistory {
  return {
    asOf: ASOF,
    template: {
      id: "UC-AAAAAA",
      teamId: "t_coral",
      teamSlug: "coral",
      name: "High-Yield Savings — Terms",
    },
    versions,
    consumerUsage: [],
    sunsetCalendar: { zone: "America/New_York", today: "2026-10-04" },
    people: [
      { id: "eli", name: "Eli Park", initials: "EP", hue: 10 },
      { id: "naomi", name: "Naomi Ross", initials: "NR", hue: 20 },
      { id: "maya", name: "Maya Chen", initials: "MC", hue: 30 },
    ],
    ...over,
  };
}

const decided = (
  kind: "approved" | "changes_requested",
  by: string,
  reason: string | null = null,
) => ({
  kind,
  stageName: "Team approver",
  by,
  at: "2026-09-10T12:00:00.000Z",
  reason,
});

describe("versionsData", () => {
  it("shows a number once, as its head, with every round in its review history, labelled", () => {
    const data = versionsData(
      history([
        row({
          id: "v2r3",
          number: 2,
          round: 3,
          state: "active",
          submittedBy: "eli",
          decisions: [decided("approved", "naomi")],
        }),
        row({
          id: "v2r2",
          number: 2,
          round: 2,
          state: "changes_requested",
          head: false,
          decisions: [decided("changes_requested", "naomi", "The preheader.")],
        }),
        row({
          id: "v2r1",
          number: 2,
          round: 1,
          state: "changes_requested",
          head: false,
          decisions: [decided("changes_requested", "naomi", "The limit.")],
        }),
        row({ id: "v1", number: 1, round: 1 }),
      ]),
    );
    expect(
      data.items.map((i) => [i.number, i.round, i.label, i.approvedOnRound]),
    ).toEqual([
      [2, 3, "v2", "Approved on round 3"],
      [1, 1, "v1", null],
    ]);
    const [v2, v1] = data.items;
    expect(v1!.rounds, "one round: no history").toBeNull();
    expect(v2!.author).toEqual({
      id: "eli",
      name: "Eli Park",
      initials: "EP",
      hue: 10,
    });
    expect(
      v2!.rounds!.map((r) => [r.round, r.decision?.kind, r.decision?.reason]),
    ).toEqual([
      [3, "approved", undefined],
      [2, "changes_requested", "The preheader."],
      [1, "changes_requested", "The limit."],
    ]);
    // Compare offers every row, the rounds included, newest first; it opens on the heads.
    expect(data.compareOptions.map((o) => [o.label, o.head])).toEqual([
      ["v2 · Round 3", true],
      ["v2 · Round 2", false],
      ["v2 · Round 1", false],
      ["v1", true],
    ]);
  });

  it("puts the open draft first, unlabelled, and leaves a round in review without a closing decision", () => {
    const data = versionsData(
      history([
        row({
          id: "draft",
          number: null,
          round: null,
          state: "draft",
          submittedBy: null,
          submittedAt: null,
        }),
        row({
          id: "v1r2",
          number: 1,
          round: 2,
          state: "in_review",
          decisions: [],
        }),
        row({
          id: "v1r1",
          number: 1,
          round: 1,
          state: "changes_requested",
          head: false,
          decisions: [decided("changes_requested", "naomi", "Fix it.")],
        }),
      ]),
    );
    expect(data.items.map((i) => [i.number, i.label, i.state])).toEqual([
      [null, null, "draft"],
      [1, "v1 · Round 2", "in_review"],
    ]);
    expect(data.items[0]!.submittedAt).toBeUndefined();
    expect(
      data.items[1]!.rounds!.map((r) => [r.round, r.decision?.kind ?? null]),
    ).toEqual([
      [2, null],
      [1, "changes_requested"],
    ]);
    expect(data.compareOptions.map((o) => o.label)).toEqual([
      "Draft",
      "v1 · Round 2",
      "v1 · Round 1",
    ]);
  });

  it("words each contract change as a line, flagged breaking or not", () => {
    const annualFee: ContractChange = {
      kind: "added",
      key: "annual_fee",
      breaking: true,
      type: "currency",
      required: true,
    };
    const [v3] = versionsData(
      history([
        row({
          id: "v3",
          number: 3,
          state: "in_review",
          contractChanges: [annualFee],
        }),
      ]),
    ).items;
    expect(v3!.contractItems).toEqual([
      { text: "v3 adds required `annual_fee` (Currency).", breaking: true },
    ]);
    expect(v3!.contractLines).toEqual(v3!.contractItems.map((c) => c.text));
  });

  it("names people (a stand-in for a user that's gone), and reads a revoke with its people", () => {
    const [revoked] = versionsData(
      history([
        row({
          id: "v1",
          state: "revoked",
          submittedBy: "gone",
          revoke: {
            reason: "Wrong APR",
            startedBy: "naomi",
            startedAt: "2026-09-20T12:00:00.000Z",
            confirmedBy: "maya",
            confirmedAt: "2026-09-21T12:00:00.000Z",
          },
        }),
      ]),
    ).items;
    expect(revoked!.author).toMatchObject({ id: "gone", name: "gone" });
    expect(revoked!.revoke).toEqual({
      reason: "Wrong APR",
      startedBy: expect.objectContaining({ name: "Naomi Ross" }),
      startedAt: "2026-09-20T12:00:00.000Z",
      confirmedBy: expect.objectContaining({ name: "Maya Chen" }),
      confirmedAt: "2026-09-21T12:00:00.000Z",
    });
  });

  it("carries the service's decisions and days as they are, and counts from its asOf", () => {
    const passed = { ok: false as const, ...REFUSALS.sunsetPassed };
    const data = versionsData(
      history([
        row({
          id: "v1",
          sunsetAt: "2026-10-25T04:00:00.000Z",
          sunsetDay: "2026-10-25",
          sunsetPassed: true,
          can: { ...ALL_OK, setSunset: passed },
        }),
      ]),
    );
    expect(data.items[0]).toMatchObject({
      sunsetDay: "2026-10-25",
      sunsetPassed: true,
      can: { setSunset: passed },
    });
    expect(data.now).toBe(ASOF);
    expect(data.sunsetCalendar).toEqual({
      zone: "America/New_York",
      today: "2026-10-04",
    });
  });
});

describe("getVersions", () => {
  beforeEach(() => {
    env.signedIn = true;
    env.history = { ok: true, ...history([row({ id: "v1" })]) };
  });

  it("reads the template in its team's space, and in All teams", async () => {
    await expect(getVersions("coral", "UC-AAAAAA")).resolves.toMatchObject({
      template: { id: "UC-AAAAAA", teamSlug: "coral" },
      now: ASOF,
    });
    await expect(getVersions("all", "UC-AAAAAA")).resolves.toMatchObject({
      template: { id: "UC-AAAAAA" },
    });
  });

  it("is Not found in another team's space, and when the service refuses", async () => {
    await expect(getVersions("deposits", "UC-AAAAAA")).rejects.toThrow(
      NOT_FOUND,
    );
    env.history = {
      ok: false,
      status: 404,
      ...REQUEST_REFUSALS.templateUnavailable,
    };
    await expect(getVersions("coral", "UC-AAAAAA")).rejects.toThrow(NOT_FOUND);
  });

  it("sends a signed-out person to sign in", async () => {
    env.signedIn = false;
    await expect(getVersions("coral", "UC-AAAAAA")).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
  });
});
