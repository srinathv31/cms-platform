import { describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { getVersions } from "./versions";

// The Versions tab's read model as the BFF builds it, against the in-memory fake (decision 0068): the
// timeline's layout (a number once, as its head, with its rounds), the labels and contract lines it words,
// the people it names, and the Not found answers. What the service decides (the `can` results, the sunset's
// day, which row is a number's head) is the contract suite's (src/server/services/contract/versions.ts).
//
// The seed at BASE: Cash Back v3 in review on round 2, v2 Active, v1 Superseded; High-Yield Savings
// (Deposits) v2 Active on round 3, v1 Superseded; Annual Fee Waiver v1 sent back, with an open draft;
// Balance Transfer v1 Superseded under v2; Holiday Points v1 Revoked.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
// The space guard still reads the database (spaces move behind the services with B1): here it resolves the
// slug against the fake's teams.
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => {
    const team = backend.state.teams.find((t) => t.slug === slug);
    return {
      slug,
      isAll: slug === "all",
      teamId: team?.id ?? null,
      name: team?.name ?? "All teams",
    };
  },
}));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const backend = fakeBackendPerTest({ base: BASE });

describe("getVersions", () => {
  it("shows a number once, as its head, with every round in its review history, labelled", async () => {
    backend.as("eli");
    const highYield = await getVersions(
      "deposits",
      backend.templates["high-yield-savings"]!,
    );
    expect(
      highYield.items.map((i) => [
        i.number,
        i.round,
        i.label,
        i.state,
        i.approvedOnRound,
      ]),
    ).toEqual([
      [2, 3, "v2", "active", "Approved on round 3"],
      [1, 1, "v1", "superseded", null],
    ]);
    const [v2, v1] = highYield.items;
    expect(v1!.rounds, "one round: no history").toBeNull();
    expect(v2!.decisions).toEqual([
      expect.objectContaining({
        kind: "approved",
        by: expect.objectContaining({ id: "naomi", name: expect.any(String) }),
      }),
    ]);
    expect(v2!.rounds).toEqual([
      expect.objectContaining({
        round: 3,
        state: "active",
        submittedBy: expect.objectContaining({ id: "eli" }),
        decision: expect.objectContaining({
          kind: "approved",
          by: expect.objectContaining({ id: "naomi" }),
          stageName: "Team approver",
        }),
      }),
      expect.objectContaining({
        round: 2,
        state: "changes_requested",
        decision: expect.objectContaining({
          kind: "changes_requested",
          reason: expect.stringContaining("preheader"),
        }),
      }),
      expect.objectContaining({
        round: 1,
        state: "changes_requested",
        decision: expect.objectContaining({
          kind: "changes_requested",
          reason: expect.stringContaining("withdrawal limit"),
        }),
      }),
    ]);
    // Compare offers every row, the rounds included, newest first; it opens on the heads.
    expect(
      highYield.compareOptions.map((o) => [o.label, o.state, o.head]),
    ).toEqual([
      ["v2 · Round 3", "active", true],
      ["v2 · Round 2", "changes_requested", false],
      ["v2 · Round 1", "changes_requested", false],
      ["v1", "superseded", true],
    ]);

    backend.as("maya");
    const cashBack = await getVersions(
      "coral-offers",
      backend.templates["cash-back"]!,
    );
    expect(
      cashBack.items.map((i) => [i.number, i.round, i.label, i.state]),
    ).toEqual([
      [3, 2, "v3 · Round 2", "in_review"],
      [2, 1, "v2", "active"],
      [1, 1, "v1", "superseded"],
    ]);
    // A round in review has no closing decision yet.
    expect(
      cashBack.items[0]!.rounds?.map((r) => [
        r.round,
        r.state,
        r.decision?.kind ?? null,
      ]),
    ).toEqual([
      [2, "in_review", null],
      [1, "changes_requested", "changes_requested"],
    ]);

    const waiver = await getVersions(
      "coral-offers",
      backend.templates["annual-fee-waiver"]!,
    );
    expect(waiver.items.map((i) => [i.number, i.label, i.state])).toEqual([
      [null, null, "draft"],
      [1, "v1 · Round 1", "changes_requested"],
    ]);
    expect(waiver.compareOptions.map((o) => [o.label, o.head])).toEqual([
      ["Draft", true],
      ["v1 · Round 1", true],
    ]);
  });

  it("words each contract change as a line, flagged breaking or not", async () => {
    backend.as("jordan");
    const cashBack = await getVersions(
      "coral-offers",
      backend.templates["cash-back"]!,
    );
    const v3 = cashBack.items.find((i) => i.number === 3)!;
    expect(v3.contractItems.length).toBeGreaterThan(0);
    expect(v3.contractItems.map((c) => c.text)).toEqual(v3.contractLines);
    expect(v3.contractItems).toContainEqual({
      text: "v3 adds required `annual_fee` (Currency).",
      breaking: true,
    });
  });

  it("names people, carries the service's decisions as they are, and counts from the request's instant", async () => {
    backend.as("jordan");
    const data = await getVersions(
      "coral-offers",
      backend.templates["balance-transfer"]!,
    );
    expect(data.template).toEqual({
      id: backend.templates["balance-transfer"],
      name: "Balance Transfer Intro — Terms",
      teamSlug: "coral-offers",
    });
    const [v2, v1] = data.items;
    expect(v1).toMatchObject({
      author: expect.objectContaining({
        id: "priya",
        name: expect.any(String),
      }),
      sunsetDay: "2026-10-25",
      can: { setSunset: { ok: true } },
    });
    expect(v2!.can.setSunset).toEqual({
      ok: false,
      ...REFUSALS.sunsetNotSuperseded,
    });
    expect(data.now).toBe(BASE.toISOString());
    expect(data.sunsetCalendar).toEqual({
      zone: "America/New_York",
      today: "2026-10-04",
    });

    const holiday = await getVersions(
      "coral-offers",
      backend.templates["holiday-points"]!,
    );
    expect(
      holiday.items.find((i) => i.state === "revoked")!.revoke,
    ).toMatchObject({
      startedBy: expect.objectContaining({ name: expect.any(String) }),
      confirmedBy: expect.objectContaining({ name: expect.any(String) }),
    });
  });

  it("is Not found for a template in another team's space, and for one the viewer can't see", async () => {
    backend.as("jordan");
    await expect(
      getVersions("deposits", backend.templates["balance-transfer"]!),
    ).rejects.toThrow(NOT_FOUND);
    backend.as("maya");
    await expect(
      getVersions("coral-offers", backend.templates["high-yield-savings"]!),
    ).rejects.toThrow(NOT_FOUND);
    // The All teams space holds every team's templates.
    backend.as("riley");
    await expect(
      getVersions("all", backend.templates["high-yield-savings"]!),
    ).resolves.toMatchObject({ template: { teamSlug: "deposits" } });
  });

  it("is Not found when nobody is signed in", async () => {
    backend.signOut();
    await expect(
      getVersions("coral-offers", backend.templates["balance-transfer"]!),
    ).rejects.toThrow(NOT_FOUND);
  });
});
