import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { REFUSALS } from "@/domain/lifecycle";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { findRound } from "./find-round";
import { getViewer } from "@/server/viewer";
import { getActivity } from "./activity";
import { getReviewBadgeCount, getReviewQueue, getReviewScreen } from "./review";
import { getThreads, loadThreads } from "./threads";
import { getVersions } from "./versions";
import { getWorkspaceDocument } from "./workspace";

// The Phase 4 read models against a temporary database filled by the real seed:
//   - Cash Back v3 is In review on round 2 (submitted by Maya, breaking) after Jordan sent round 1 back
//     2.6 days ago; v2 Active and rendered by Coral;
//   - High-Yield Savings v2 is Active, approved on round 3 after Naomi sent rounds 1 and 2 back;
//   - Annual Fee Waiver v1 has Changes requested (Jordan, 3.9 days ago) and an open draft with threads;
//   - Balance Transfer v1 is Superseded with a sunset in 21 days, v2 Active, both rendered by Coral;
//   - Holiday Points v1 is Revoked.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-review-queries-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const { commentThreads, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "jordan", "alex", "sam", "riley", "eli"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── Queue ─────────────────────────────────────────────────────

describe("getReviewQueue", () => {
  it("Jordan waits on Cash Back v3 round 2, and sees its round 1 and Annual Fee Waiver among the recent decisions", async () => {
    as("jordan");
    const queue = await getReviewQueue("coral-offers");
    expect(queue.waiting).toEqual([
      {
        templateId: ids["cash-back"],
        templateName: "Cash Back Welcome Bonus — Terms",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        versionNumber: 3,
        round: 2,
        state: "in_review",
        author: { id: "maya", name: "Maya Chen", initials: "MC", hue: expect.any(Number) },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: true,
      },
    ]);
    expect(queue.submitted).toEqual([]);
    // Each round is a row: Cash Back v3's round 1, sent back 2.6 days ago, then the waiver's at 3.9.
    expect(queue.decided).toEqual([
      expect.objectContaining({
        templateId: ids["cash-back"],
        versionNumber: 3,
        round: 1,
        state: "changes_requested",
        breaking: true,
        decision: { kind: "changes_requested", by: expect.objectContaining({ id: "jordan" }), at: expect.stringMatching(ISO) },
      }),
      expect.objectContaining({
        templateId: ids["annual-fee-waiver"],
        versionNumber: 1,
        round: 1,
        state: "changes_requested",
        breaking: false,
        stage: { position: 0, name: "Team approver", count: 1 },
        decision: { kind: "changes_requested", by: expect.objectContaining({ id: "jordan" }), at: expect.stringMatching(ISO) },
      }),
    ]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(1);
  });

  it("Maya submitted it: nothing waits on her", async () => {
    as("maya");
    const queue = await getReviewQueue("coral-offers");
    expect(queue.waiting).toEqual([]);
    expect(queue.submitted.map((r) => [r.templateId, r.versionNumber, r.round])).toEqual([[ids["cash-back"], 3, 2]]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);
  });

  it("a viewer waits on nothing; another team's space lists only its own", async () => {
    as("sam");
    expect((await getReviewQueue("coral-offers")).waiting).toEqual([]);
    as("eli");
    const deposits = await getReviewQueue("deposits");
    expect([...deposits.waiting, ...deposits.submitted, ...deposits.decided].every((r) => r.teamSlug === "deposits")).toBe(
      true,
    );
  });

  it("All teams is open to a platform admin, who decides nothing", async () => {
    as("riley");
    const queue = await getReviewQueue("all");
    expect(queue.waiting).toEqual([]);
    expect(queue.decided.map((r) => r.templateId)).toContain(ids["annual-fee-waiver"]);
    expect(await getReviewBadgeCount("all")).toBe(0);
  });
});

// ── Review screen ─────────────────────────────────────────────

describe("getReviewScreen", () => {
  it("shows Cash Back v3 (its head, round 2) against the Active v2, with the stepper, the contract and Coral's usage", async () => {
    as("jordan");
    const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
    expect(screen.template).toEqual({
      id: ids["cash-back"],
      teamId: "coral-offers",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
    });
    expect(screen.version).toMatchObject({
      number: 3,
      round: 2,
      state: "in_review",
      name: "Cash Back Welcome Bonus — Terms",
      submittedBy: expect.objectContaining({ id: "maya" }),
      submittedAt: expect.stringMatching(ISO),
      contractLines: ["v3 adds required `annual_fee` (Currency)."],
    });
    expect(screen.baseline).toMatchObject({ number: 2, state: "active" });
    expect(screen.previousNumber, "approving v3 replaces the Active v2").toBe(2);
    expect(screen.liveName).toBe("Cash Back Welcome Bonus — Terms");
    expect(screen.steps).toEqual([{ position: 0, name: "Team approver", status: "current" }]);
    expect(screen.can).toEqual({ approve: { ok: true }, requestChanges: { ok: true }, comment: { ok: true } });
    expect(screen.today).toBe("2026-10-04");

    const v2 = screen.consumerUsage.find((u) => u.versionNumber === 2);
    expect(v2).toMatchObject({ consumerId: "coral", consumerName: "Coral", lastRenderAt: expect.stringMatching(ISO) });
    expect(v2!.renders30d).toBeGreaterThan(0);
    // Previews never count: v3 has only previews.
    expect(screen.consumerUsage.some((u) => u.versionNumber === 3)).toBe(false);
  });

  it("explains why Maya, a viewer, or anyone on a decided version can't decide", async () => {
    as("maya");
    const own = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
    expect(own.can).toEqual({
      approve: { ok: false, ...REASONS.ownVersion },
      requestChanges: { ok: false, ...REASONS.ownVersion },
      comment: { ok: true },
    });

    as("sam");
    const viewer = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
    expect(viewer.can.approve).toEqual({ ok: false, ...REASONS.generic });
    expect(viewer.can.comment).toEqual({ ok: false, ...REASONS.generic });

    as("jordan");
    const active = await getReviewScreen("coral-offers", ids["cash-back"]!, 2, null);
    expect(active.baseline).toBeNull(); // the Active version is this one
    expect(active.previousNumber).toBeNull();
    expect(active.can.approve).toEqual({ ok: false, ...REFUSALS.notInReview });
    // A decided version is a record: nobody comments on it, and the screen says why.
    expect(active.can.comment).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
    expect(active.steps).toEqual([
      expect.objectContaining({ status: "done", decidedBy: expect.objectContaining({ id: "jordan" }) }),
    ]);
  });

  it("blocks Approve and Request changes, with why, for someone who wrote the version, and leaves it out of their queue", async () => {
    // Priya holds Author and Approver on Coral Offers (an access request can add the role) and edited
    // Maya's Cash Back v3 before Maya submitted it.
    const priya = await loadPersona(db, "priya");
    people.priya = {
      ...priya,
      memberships: priya.memberships.map((m) => (m.teamId === "coral-offers" ? { ...m, roles: ["author", "approver"] } : m)),
    };
    as("priya");
    const v3 = (await findRound(db, ids["cash-back"]!, 3))!;
    expect((await getReviewQueue("coral-offers")).waiting.map((r) => r.versionNumber), "an approver who wrote none of it").toEqual([3]);

    await db.update(versions).set({ writers: ["maya", "priya"] }).where(eq(versions.id, v3.id));
    try {
      const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
      expect(screen.can).toEqual({
        approve: { ok: false, ...REASONS.wroteVersion },
        requestChanges: { ok: false, ...REASONS.wroteVersion },
        comment: { ok: true },
      });
      const queue = await getReviewQueue("coral-offers");
      expect(queue.waiting).toEqual([]);
      expect(queue.submitted).toEqual([]);
      expect(await getReviewBadgeCount("coral-offers")).toBe(0);

      as("jordan");
      expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null)).can.approve).toEqual({ ok: true });
    } finally {
      await db.update(versions).set({ writers: v3.writers }).where(eq(versions.id, v3.id));
    }
  });

  it("is a 404 from another team's space, for a missing version, or for someone who can't see the team", async () => {
    as("jordan");
    await expect(getReviewScreen("deposits", ids["cash-back"]!, 3, null)).rejects.toThrow();
    await expect(getReviewScreen("coral-offers", ids["cash-back"]!, 99, null)).rejects.toThrow(NOT_FOUND);
    await expect(getReviewScreen("coral-offers", "UC-ZZZZZZ", 1, null)).rejects.toThrow(NOT_FOUND);
    await expect(getReviewScreen("coral-offers", ids["cash-back"]!, 3, 3), "a round that doesn't exist").rejects.toThrow(NOT_FOUND);
    as("riley");
    await expect(getReviewScreen("all", ids["cash-back"]!, 3, null)).resolves.toMatchObject({ version: { number: 3 } });
  });

  it("opens a round by `?round=`: Cash Back v3's round 1 is the record Jordan sent back", async () => {
    as("jordan");
    const round1 = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, 1);
    expect(round1.version).toMatchObject({ number: 3, round: 1, state: "changes_requested" });
    expect(round1.can.approve).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(round1.steps).toEqual([
      expect.objectContaining({ status: "returned", decidedBy: expect.objectContaining({ id: "jordan" }) }),
    ]);
    // Its change request, the thread about the whole version, is on its record.
    expect(round1.threads.map((t) => [t.blockId, t.originLabel, t.status])).toEqual([[DOCUMENT_THREAD, "v3 · Round 1", "resolved"]]);
    expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 3, 2)).version.id).toBe(
      (await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null)).version.id,
    );
  });

  it("links a sent-back round on to where its work went: the next round, the release, or nothing while only a draft follows", async () => {
    as("jordan");
    const cashBack = ids["cash-back"]!;
    expect((await getReviewScreen("coral-offers", cashBack, 3, 1)).replacedBy, "round 2 is in review").toEqual({
      number: 3,
      round: 2,
      state: "in_review",
      label: "v3, round 2",
    });
    expect((await getReviewScreen("coral-offers", cashBack, 3, null)).replacedBy, "round 2 is the head").toBeNull();
    // Annual Fee Waiver v1 was sent back, and Maya hasn't resubmitted: her draft has no number yet.
    const waiver = await getReviewScreen("coral-offers", ids["annual-fee-waiver"]!, 1, null);
    expect([waiver.version.state, waiver.replacedBy]).toEqual(["changes_requested", null]);

    // High-Yield Savings v2 was approved on round 3: its sent-back rounds link to v2, its bare page.
    as("eli");
    const highYield = ids["high-yield-savings"]!;
    for (const round of [1, 2]) {
      const screen = await getReviewScreen("deposits", highYield, 2, round);
      expect(screen.replacedBy, `round ${round}`).toEqual({ number: 2, round: 3, state: "active", label: "v2" });
      expect(screen.steps, "the stepper says who sent it back").toEqual([
        expect.objectContaining({ status: "returned", decidedBy: expect.objectContaining({ id: "naomi" }), decidedAt: expect.stringMatching(ISO) }),
      ]);
    }
    expect((await getReviewScreen("deposits", highYield, 2, null)).replacedBy, "the release itself").toBeNull();
  });

  it("compares a round sent back before its number went live with the version it was drafted from, not its own release", async () => {
    // High-Yield Savings: v1 Superseded, v2 approved on round 3 after two send-backs.
    as("eli");
    const highYield = ids["high-yield-savings"]!;
    const v1 = (await db.query.versions.findFirst({ where: and(eq(versions.templateId, highYield), eq(versions.number, 1)) }))!;
    await db.update(versions).set({ name: "High-Yield Savings — 2025 Rates" }).where(eq(versions.id, v1.id));
    try {
      for (const round of [1, 2]) {
        const screen = await getReviewScreen("deposits", highYield, 2, round);
        expect(screen.version).toMatchObject({ number: 2, round, state: "changes_requested" });
        expect(screen.baseline, `round ${round}: vs v1`).toMatchObject({ id: v1.id, number: 1, state: "superseded" });
        expect(screen.previousNumber, "it would replace nothing: v2 is its own release").toBeNull();
        expect(screen.liveName, "renamed from what it was drafted from").toBe("High-Yield Savings — 2025 Rates");
      }
      // The release itself is the live version: nothing to compare it with.
      const live = await getReviewScreen("deposits", highYield, 2, null);
      expect([live.version.round, live.baseline, live.previousNumber, live.liveName]).toEqual([3, null, null, null]);
    } finally {
      await db.update(versions).set({ name: v1.name }).where(eq(versions.id, v1.id));
    }
  });

  it("shows a rename against what still renders when the Active version was revoked, and none on the live version itself", async () => {
    as("jordan");
    const versionOf = (number: number) => and(eq(versions.templateId, ids["cash-back"]!), eq(versions.number, number));
    const [v1, v2] = await Promise.all([1, 2].map((n) => db.query.versions.findFirst({ where: versionOf(n) }).then((v) => v!)));
    const revoke = { reason: "Test", startedBy: "jordan", startedAt: BASE.toISOString(), confirmedBy: "alex", confirmedAt: BASE.toISOString() };
    await db.update(versions).set({ name: "Cash Back Welcome Bonus — 2025 Terms" }).where(versionOf(1));
    await db.update(versions).set({ state: "revoked", revoke }).where(versionOf(2));
    try {
      const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
      expect(screen.liveName, "v1 still renders").toBe("Cash Back Welcome Bonus — 2025 Terms");
    } finally {
      await db.update(versions).set({ state: v2.state, revoke: v2.revoke }).where(versionOf(2));
      await db.update(versions).set({ name: v1.name }).where(versionOf(1));
    }
    expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 2, null)).liveName, "v2 is the live one").toBeNull();
  });

  describe("the redline's baseline when nothing is Active", () => {
    // The walk goes back through the round sent back to the revoked version (decision 0031).
    // Cash Back: v1 Superseded (it still renders), v2 Active, v3 In review on round 2, based on round 1 (sent
    // back), based on v2. Each test revokes v2.
    const versionOf = (number: number, round = 1) =>
      and(eq(versions.templateId, ids["cash-back"]!), eq(versions.number, number), eq(versions.round, round));
    const revoke = { reason: "Test", startedBy: "jordan", startedAt: BASE.toISOString(), confirmedBy: "alex", confirmedAt: BASE.toISOString() };

    async function withV2Revoked(change: () => Promise<unknown>, check: () => Promise<void>) {
      const [v1, v2, v3] = await Promise.all(
        [versionOf(1), versionOf(2), versionOf(3, 2)].map((where) => db.query.versions.findFirst({ where }).then((v) => v!)),
      );
      await db.update(versions).set({ state: "revoked", revoke }).where(versionOf(2));
      try {
        await change();
        await check();
      } finally {
        await db.update(versions).set({ state: v1.state, sunsetAt: v1.sunsetAt }).where(versionOf(1));
        await db.update(versions).set({ state: v2.state, revoke: v2.revoke }).where(versionOf(2));
        await db.update(versions).set({ basedOnVersionId: v3.basedOnVersionId }).where(versionOf(3, 2));
      }
    }

    it("is the revoked version the correction started from, with its state; Approve still replaces nothing", async () => {
      as("jordan");
      const v2 = (await db.query.versions.findFirst({ where: versionOf(2) }))!;
      await withV2Revoked(
        async () => {},
        async () => {
          const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
          expect(screen.baseline).toEqual({ id: v2.id, number: 2, state: "revoked", body: v2.body, variables: v2.variables });
          expect(screen.previousNumber, "nothing is Active: the Approve dialog's previous version stays null").toBeNull();
        },
      );
    });

    it("falls back to the newest version that still renders when the based-on version is missing, then to none", async () => {
      as("jordan");
      const v1 = (await db.query.versions.findFirst({ where: versionOf(1) }))!;
      await withV2Revoked(
        () => db.update(versions).set({ basedOnVersionId: null }).where(versionOf(3, 2)),
        async () => {
          const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null);
          expect(screen.baseline).toMatchObject({ id: v1.id, number: 1, state: "superseded" });
          expect(screen.previousNumber).toBeNull();

          // v1's sunset passes too: nothing renders, so nothing to compare with, as for a first version.
          await db.update(versions).set({ sunsetAt: new Date(BASE.getTime() - 1000) }).where(versionOf(1));
          expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 3, null)).baseline).toBeNull();
        },
      );
    });
  });
});

// ── Versions ──────────────────────────────────────────────────

describe("getVersions", () => {
  it("lists Balance Transfer newest first with its dates, decisions, renders and actions", async () => {
    as("jordan");
    const data = await getVersions("coral-offers", ids["balance-transfer"]!);
    expect(data.template).toEqual({
      id: ids["balance-transfer"],
      name: "Balance Transfer Intro — Terms",
      teamSlug: "coral-offers",
    });
    expect(data.items.map((i) => [i.number, i.state])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    const [v2, v1] = data.items;
    expect(v1).toMatchObject({
      author: expect.objectContaining({ id: "priya" }),
      submittedAt: expect.stringMatching(ISO),
      activatedAt: expect.stringMatching(ISO),
      supersededAt: expect.stringMatching(ISO),
      sunsetDay: "2026-10-25",
      sunsetPassed: false,
      decisions: [expect.objectContaining({ kind: "approved", stageName: "Team approver", by: expect.objectContaining({ id: "jordan" }) })],
      lastRenderAt: expect.stringMatching(ISO),
      can: {
        setSunset: { ok: true },
        startRevoke: { ok: true },
        confirmRevoke: { ok: false, ...REFUSALS.noRevokePending },
        cancelRevoke: { ok: false, ...REFUSALS.noRevokePending },
      },
    });
    expect(v1!.renders30d).toBeGreaterThan(0);
    expect(v2!.can.setSunset).toEqual({ ok: false, ...REFUSALS.sunsetNotSuperseded });
    expect(v2!.revoke).toBeUndefined();
    expect(data.consumerUsage.map((u) => [u.consumerId, u.versionNumber])).toEqual([
      ["coral", 2],
      ["coral", 1],
    ]);
    // The sunset picker's calendar: the business time zone (Eastern until changed) and today there.
    expect(data.sunsetCalendar).toEqual({ zone: "America/New_York", today: "2026-10-04" });
    expect(data.items[1]!.sunsetDay).toBe("2026-10-25");

    as("maya");
    const author = await getVersions("coral-offers", ids["balance-transfer"]!);
    expect(author.items[1]!.can.setSunset).toEqual({ ok: false, ...REASONS.generic });
  });

  it("once Balance Transfer v1's sunset passes, its sunset is refused to everyone, with the reason", async () => {
    const templateId = ids["balance-transfer"]!;
    as("jordan");
    // v1's sunset day ends at 00:00 Eastern: the instant renders stop.
    const sunsetAt = sunsetInstant((await getVersions("coral-offers", templateId)).items[1]!.sunsetDay!, "America/New_York");
    try {
      env.now = new Date(sunsetAt.getTime() - 1);
      expect((await getVersions("coral-offers", templateId)).items[1]).toMatchObject({
        sunsetPassed: false,
        can: { setSunset: { ok: true } },
      });

      env.now = sunsetAt;
      const passed = { ok: false, ...REFUSALS.sunsetPassed };
      const [v2, v1] = (await getVersions("coral-offers", templateId)).items;
      expect(v1).toMatchObject({ state: "superseded", sunsetPassed: true, can: { setSunset: passed, startRevoke: { ok: true } } });
      expect(v2!.can.setSunset).toEqual({ ok: false, ...REFUSALS.sunsetNotSuperseded });

      // A fact about the version, not the viewer: an author reads the same reason.
      as("maya");
      expect((await getVersions("coral-offers", templateId)).items[1]!.can.setSunset).toEqual(passed);
    } finally {
      env.now = BASE;
    }
  });

  it("flags each contract line breaking or not, next to the same lines `contractLines` keeps", async () => {
    as("jordan");
    const cashBack = await getVersions("coral-offers", ids["cash-back"]!);
    const v3 = cashBack.items.find((i) => i.number === 3)!;
    expect(v3.contractItems.length).toBeGreaterThan(0);
    expect(v3.contractItems.map((c) => c.text)).toEqual(v3.contractLines);
    expect(v3.contractItems).toContainEqual({ text: "v3 adds required `annual_fee` (Currency).", breaking: true });
  });

  it("shows a number once, as its head, with every round in its review history", async () => {
    as("eli");
    const highYield = await getVersions("deposits", ids["high-yield-savings"]!);
    expect(highYield.items.map((i) => [i.number, i.round, i.label, i.state, i.approvedOnRound])).toEqual([
      [2, 3, "v2", "active", "Approved on round 3"],
      [1, 1, "v1", "superseded", null],
    ]);
    const [v2, v1] = highYield.items;
    expect(v1!.rounds, "one round: no history").toBeNull();
    expect(v2!.decisions).toEqual([expect.objectContaining({ kind: "approved", by: expect.objectContaining({ id: "naomi" }) })]);
    expect(v2!.rounds).toEqual([
      expect.objectContaining({
        round: 3,
        state: "active",
        submittedBy: expect.objectContaining({ id: "eli" }),
        decision: expect.objectContaining({ kind: "approved", by: expect.objectContaining({ id: "naomi" }), stageName: "Team approver" }),
      }),
      expect.objectContaining({
        round: 2,
        state: "changes_requested",
        decision: expect.objectContaining({ kind: "changes_requested", reason: expect.stringContaining("preheader") }),
      }),
      expect.objectContaining({
        round: 1,
        state: "changes_requested",
        decision: expect.objectContaining({ kind: "changes_requested", reason: expect.stringContaining("withdrawal limit") }),
      }),
    ]);
    // Compare offers every row, the rounds included, newest first.
    // Compare opens on the heads (one per number); the other rounds are there to pick.
    expect(highYield.compareOptions.map((o) => [o.label, o.state, o.head])).toEqual([
      ["v2 · Round 3", "active", true],
      ["v2 · Round 2", "changes_requested", false],
      ["v2 · Round 1", "changes_requested", false],
      ["v1", "superseded", true],
    ]);

    as("maya");
    const cashBack = await getVersions("coral-offers", ids["cash-back"]!);
    expect(cashBack.items.map((i) => [i.number, i.round, i.label, i.state])).toEqual([
      [3, 2, "v3 · Round 2", "in_review"],
      [2, 1, "v2", "active"],
      [1, 1, "v1", "superseded"],
    ]);
    // A round in review has no closing decision yet.
    expect(cashBack.items[0]!.rounds?.map((r) => [r.round, r.state, r.decision?.kind ?? null])).toEqual([
      [2, "in_review", null],
      [1, "changes_requested", "changes_requested"],
    ]);
    expect(cashBack.compareOptions.map((o) => [o.label, o.head])).toEqual([
      ["v3 · Round 2", true],
      ["v3 · Round 1", false],
      ["v2", true],
      ["v1", true],
    ]);

    const waiver = await getVersions("coral-offers", ids["annual-fee-waiver"]!);
    expect(waiver.items.map((i) => i.label)).toEqual([null, "v1 · Round 1"]);
    expect(waiver.compareOptions.map((o) => [o.label, o.head])).toEqual([
      ["Draft", true],
      ["v1 · Round 1", true],
    ]);
  });

  it("puts the open draft first, and reads a revoke with its people", async () => {
    as("jordan");
    const waiver = await getVersions("coral-offers", ids["annual-fee-waiver"]!);
    expect(waiver.items.map((i) => [i.number, i.state])).toEqual([
      [null, "draft"],
      [1, "changes_requested"],
    ]);
    expect(waiver.items[1]!.decisions).toEqual([
      expect.objectContaining({ kind: "changes_requested", reason: expect.stringContaining("isn't automatic") }),
    ]);

    const holiday = await getVersions("coral-offers", ids["holiday-points"]!);
    const revoked = holiday.items.find((i) => i.state === "revoked")!;
    expect(revoked.revoke).toMatchObject({
      reason: expect.any(String),
      startedBy: expect.objectContaining({ name: expect.any(String) }),
      confirmedBy: expect.objectContaining({ name: expect.any(String) }),
      confirmedAt: expect.stringMatching(ISO),
    });
    expect(revoked.can.startRevoke).toEqual({ ok: false, ...REFUSALS.alreadyRevoked });
    expect(revoked.can.confirmRevoke).toEqual({ ok: false, ...REFUSALS.alreadyRevoked });
  });

  it("with a revoke pending, the starter may cancel but not confirm; another approver may do both", async () => {
    const templateId = ids["balance-transfer"]!;
    const where = and(eq(versions.templateId, templateId), eq(versions.number, 2));
    await db
      .update(versions)
      .set({ revoke: { reason: "Wrong APR", startedBy: "jordan", startedAt: BASE.toISOString() } })
      .where(where);
    try {
      as("jordan");
      const starter = (await getVersions("coral-offers", templateId)).items[0]!.can;
      expect(starter).toEqual({
        setSunset: { ok: false, ...REFUSALS.sunsetNotSuperseded },
        startRevoke: { ok: false, ...REFUSALS.revokePending },
        confirmRevoke: { ok: false, ...REASONS.ownRevoke },
        cancelRevoke: { ok: true },
      });
      as("alex");
      const other = (await getVersions("coral-offers", templateId)).items[0]!.can;
      expect(other.confirmRevoke).toEqual({ ok: true });
      expect(other.cancelRevoke).toEqual({ ok: true });
    } finally {
      await db.update(versions).set({ revoke: null }).where(where);
    }
  });
});

// ── Activity ──────────────────────────────────────────────────

describe("getActivity", () => {
  it("lists the template's audit events newest first, as sentences, with the draft edits", async () => {
    as("sam");
    const items = await getActivity("coral-offers", ids["balance-transfer"]!);
    const times = items.map((i) => i.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(items.at(-1)).toMatchObject({ action: "template.created", versionLabel: null });
    expect(items.some((i) => i.action === "draft.edited")).toBe(true);
    const sunset = items.find((i) => i.action === "version.sunset_set")!;
    expect(sunset).toMatchObject({ actor: expect.objectContaining({ id: "jordan" }), versionLabel: "v1" });
    expect(sunset.summary).toMatch(/^Jordan Ellis set v1 to sunset on /);
    const activated = items.find((i) => i.action === "version.activated" && i.versionLabel === "v2")!;
    expect(activated.actor).toBeNull();
    expect(activated.summary).toBe("v2 became Active, replacing v1.");
  });
});

// ── Threads ───────────────────────────────────────────────────

describe("threads", () => {
  it("shows the Annual Fee Waiver threads on the open draft: the change request first, then by block", async () => {
    as("maya");
    const threads = await getThreads("coral-offers", ids["annual-fee-waiver"]!);
    expect(threads).toHaveLength(2);
    expect(threads.every((t) => !t.orphaned && t.originVersionNumber === 1)).toBe(true);
    const resolved = threads.find((t) => t.status === "resolved")!;
    expect(resolved).toMatchObject({
      quote: "after your first year",
      resolvedBy: expect.objectContaining({ id: "maya" }),
      resolvedAt: expect.stringMatching(ISO),
    });
    expect(resolved.comments.map((c) => c.author.id)).toEqual(["jordan", "maya"]);
    // The change request that sent v1 back: about the whole version, open until the draft is submitted.
    const open = threads.find((t) => t.status === "open")!;
    expect(threads[0]).toBe(open);
    expect(open).toMatchObject({ blockId: DOCUMENT_THREAD, quote: null });
    expect(open.resolvedBy).toBeUndefined();
    expect(open.comments[0]).toMatchObject({ kind: "change_request", createdAt: expect.stringMatching(ISO) });

    // The workspace carries the same threads for the editor margin, on a draft that takes comments.
    const document = await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!);
    expect(document.threads).toEqual(threads);
    expect(document.can.comment).toEqual({ ok: true });
  });

  it("lists the document thread first and orphaned threads last", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const v1 = (await db.query.versions.findFirst({
      where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
    }))!;
    const rows = [
      { id: "th_test_gone", blockId: "b_gone00", createdAt: new Date(BASE.getTime() - 1000) },
      { id: "th_test_doc", blockId: DOCUMENT_THREAD, createdAt: BASE },
    ];
    await db.insert(commentThreads).values(
      rows.map((r) => ({ ...r, templateId, originVersionId: v1.id, quote: null, status: "open" as const })),
    );
    try {
      as("jordan");
      const threads = await getThreads("coral-offers", templateId, v1.id);
      // Document threads oldest first (the seeded change request, then this one), then by block.
      expect(threads.map((t) => [t.id.startsWith("th_test") ? t.id : t.blockId === DOCUMENT_THREAD ? "seeded doc" : "seeded", t.orphaned])).toEqual([
        ["seeded doc", false],
        ["th_test_doc", false],
        ["seeded", false],
        ["th_test_gone", true],
      ]);
      await expect(getThreads("coral-offers", templateId, "v_not_this_templates")).rejects.toThrow(NOT_FOUND);
    } finally {
      await db.delete(commentThreads).where(inArray(commentThreads.id, rows.map((r) => r.id)));
    }
  });
});

// ── A frozen version shows the threads that began by it ───────

describe("threads on a submitted version", () => {
  const stamp = (n: number) => new Date(BASE.getTime() - n * 1000);

  /** The draft (null), or a number's round: the given one, else its head. */
  async function versionId(templateId: string, number: number | null, round?: number) {
    const row =
      number === null
        ? await db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.state, "draft")) })
        : await findRound(db, templateId, number, round);
    return row!.id;
  }

  async function addThreads(templateId: string, rows: { id: string; origin: string }[]) {
    await db.insert(commentThreads).values(
      rows.map((r, i) => ({
        id: r.id,
        templateId,
        originVersionId: r.origin,
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open" as const,
        createdAt: stamp(i),
      })),
    );
    return () => db.delete(commentThreads).where(inArray(commentThreads.id, rows.map((r) => r.id)));
  }

  const mine = (threads: { id: string }[]) => threads.map((t) => t.id).filter((id) => id.startsWith("th_f3a")).sort();

  it("v2's record leaves out a thread that began in v3's review (and the screen of v3 has both)", async () => {
    const templateId = ids["cash-back"]!;
    const cleanup = await addThreads(templateId, [
      { id: "th_f3a_v1", origin: await versionId(templateId, 1) },
      { id: "th_f3a_v3", origin: await versionId(templateId, 3) },
    ]);
    try {
      as("jordan");
      const screen = async (n: number) => (await getReviewScreen("coral-offers", templateId, n, null)).threads;
      expect(mine(await screen(1))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(2))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(3))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
      // Without a version, everything on the template (the editor's margin).
      const body = (await db.query.versions.findFirst({ where: eq(versions.id, await versionId(templateId, 3)) }))!.body;
      expect(mine(await loadThreads(templateId, body))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
      // By id: the same rule.
      expect(mine(await getThreads("coral-offers", templateId, await versionId(templateId, 2)))).toEqual(["th_f3a_v1"]);
    } finally {
      await cleanup();
    }
  });

  it("a thread that began in the open draft counts as the next round (v1 round 2): not on round 1's record, but in the draft's margin", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const draft = await versionId(templateId, null);
    const cleanup = await addThreads(templateId, [
      { id: "th_f3a_draft", origin: draft },
      { id: "th_f3a_v1", origin: await versionId(templateId, 1) },
    ]);
    try {
      as("jordan");
      expect(mine((await getReviewScreen("coral-offers", templateId, 1, null)).threads)).toEqual(["th_f3a_v1"]);
      expect(mine(await getThreads("coral-offers", templateId, await versionId(templateId, 1)))).toEqual(["th_f3a_v1"]);
      // The draft itself, and the workspace's default (the open draft), show them all.
      expect(mine(await getThreads("coral-offers", templateId, draft))).toEqual(["th_f3a_draft", "th_f3a_v1"]);
      expect(mine(await getThreads("coral-offers", templateId))).toEqual(["th_f3a_draft", "th_f3a_v1"]);
    } finally {
      await cleanup();
    }
  });
});

describe("threads across the rounds of one number", () => {
  it("round 2's screen shows round 1's threads; round 1's record leaves out the ones begun in round 2", async () => {
    const templateId = ids["cash-back"]!;
    const [round1, round2] = await Promise.all([findRound(db, templateId, 3, 1), findRound(db, templateId, 3, 2)]);
    const rows = [
      { id: "th_rounds_r1", origin: round1!.id },
      { id: "th_rounds_r2", origin: round2!.id },
    ];
    await db.insert(commentThreads).values(
      rows.map((r) => ({ id: r.id, templateId, originVersionId: r.origin, blockId: DOCUMENT_THREAD, quote: null, status: "open" as const, createdAt: BASE })),
    );
    try {
      as("jordan");
      const ours = (threads: { id: string }[]) => threads.map((t) => t.id).filter((id) => id.startsWith("th_rounds")).sort();
      expect(ours((await getReviewScreen("coral-offers", templateId, 3, 1)).threads)).toEqual(["th_rounds_r1"]);
      const onRound2 = (await getReviewScreen("coral-offers", templateId, 3, 2)).threads;
      expect(ours(onRound2)).toEqual(["th_rounds_r1", "th_rounds_r2"]);
      expect(onRound2.filter((t) => t.id.startsWith("th_rounds")).map((t) => [t.originRound, t.originLabel])).toEqual(
        expect.arrayContaining([
          [1, "v3 · Round 1"],
          [2, "v3 · Round 2"],
        ]),
      );
    } finally {
      await db.delete(commentThreads).where(inArray(commentThreads.id, rows.map((r) => r.id)));
    }
  });
});

describe("the review screen's version", () => {
  it("carries the sunset day of a Superseded version (and null without one)", async () => {
    as("jordan");
    const superseded = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 1, null);
    expect(superseded.version.state).toBe("superseded");
    expect(superseded.version.sunsetDay).toBe("2026-10-25");
    expect(superseded.sunsetCalendar).toEqual({ zone: "America/New_York", today: "2026-10-04" });
    const active = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 2, null);
    expect(active.version.sunsetDay).toBeNull();
  });
});

describe("the workspace's comment permission", () => {
  it("lets the team's authors and approvers comment on an open draft, not its viewers", async () => {
    as("maya");
    expect((await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!)).can.comment).toEqual({ ok: true });
    as("sam");
    expect((await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!)).can.comment).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });

  it("lets nobody comment on a template whose latest version has been decided", async () => {
    as("maya");
    const document = await getWorkspaceDocument("coral-offers", ids["rate-change-notice"]!);
    expect(document.versionNumber).toBe(1);
    expect(document.can.comment).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
  });
});
