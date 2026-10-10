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
import { getViewer } from "@/server/viewer";
import { getActivity } from "./activity";
import { getReviewBadgeCount, getReviewQueue, getReviewScreen } from "./review";
import { anchorIdsOf } from "./review-shared";
import { getThreads, loadThreads } from "./threads";
import { getVersions } from "./versions";
import { getWorkspaceDocument } from "./workspace";

// The Phase 4 read models against a temporary database filled by the real seed:
//   - Cash Back v3 is In review (submitted by Maya, breaking), v2 Active and rendered by Coral;
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
  it("Jordan waits on Cash Back v3 and the Card Used Abroad alert, and sees Annual Fee Waiver among the recent decisions", async () => {
    as("jordan");
    const queue = await getReviewQueue("coral-offers");
    // Newest submitted first: Cash Back v3 went in after the alert.
    expect(queue.waiting).toEqual([
      {
        templateId: ids["cash-back"],
        templateName: "Cash Back Welcome Bonus — Terms",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        versionNumber: 3,
        state: "in_review",
        author: { id: "maya", name: "Maya Chen", initials: "MC", hue: expect.any(Number) },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: true,
      },
      {
        templateId: ids["card-used-abroad"],
        templateName: "Card Used Abroad",
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        versionId: expect.any(String),
        versionNumber: 1,
        state: "in_review",
        author: { id: "priya", name: "Priya Raman", initials: "PR", hue: expect.any(Number) },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: false,
      },
    ]);
    expect(queue.submitted).toEqual([]);
    expect(queue.decided).toEqual([
      expect.objectContaining({
        templateId: ids["annual-fee-waiver"],
        versionNumber: 1,
        state: "changes_requested",
        breaking: false,
        stage: { position: 0, name: "Team approver", count: 1 },
        decision: { kind: "changes_requested", by: expect.objectContaining({ id: "jordan" }), at: expect.stringMatching(ISO) },
      }),
    ]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(2);
  });

  it("Maya submitted it: nothing waits on her", async () => {
    as("maya");
    const queue = await getReviewQueue("coral-offers");
    expect(queue.waiting).toEqual([]);
    expect(queue.submitted.map((r) => [r.templateId, r.versionNumber])).toEqual([[ids["cash-back"], 3]]);
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
  it("shows Cash Back v3 against the Active v2, with the stepper, the contract and Coral's usage", async () => {
    as("jordan");
    const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
    expect(screen.template).toEqual({
      id: ids["cash-back"],
      teamId: "coral-offers",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      family: "document",
    });
    expect(screen.version).toMatchObject({
      number: 3,
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
    const own = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
    expect(own.can).toEqual({
      approve: { ok: false, ...REASONS.ownVersion },
      requestChanges: { ok: false, ...REASONS.ownVersion },
      comment: { ok: true },
    });

    as("sam");
    const viewer = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
    expect(viewer.can.approve).toEqual({ ok: false, ...REASONS.generic });
    expect(viewer.can.comment).toEqual({ ok: false, ...REASONS.generic });

    as("jordan");
    const active = await getReviewScreen("coral-offers", ids["cash-back"]!, 2);
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
    const v3 = (await db.query.versions.findFirst({
      where: and(eq(versions.templateId, ids["cash-back"]!), eq(versions.number, 3)),
    }))!;
    expect((await getReviewQueue("coral-offers")).waiting.map((r) => r.versionNumber), "an approver who wrote none of it").toEqual([3]);

    await db.update(versions).set({ writers: ["maya", "priya"] }).where(eq(versions.id, v3.id));
    try {
      const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
      expect(screen.can).toEqual({
        approve: { ok: false, ...REASONS.wroteVersion },
        requestChanges: { ok: false, ...REASONS.wroteVersion },
        comment: { ok: true },
      });
      const queue = await getReviewQueue("coral-offers");
      expect(queue.waiting).toEqual([]);
      // What Priya submitted herself is hers to watch, not to decide: the Card Used Abroad alert.
      expect(queue.submitted.map((r) => [r.templateId, r.versionNumber])).toEqual([[ids["card-used-abroad"], 1]]);
      expect(await getReviewBadgeCount("coral-offers")).toBe(0);

      as("jordan");
      expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 3)).can.approve).toEqual({ ok: true });
    } finally {
      await db.update(versions).set({ writers: v3.writers }).where(eq(versions.id, v3.id));
    }
  });

  it("is a 404 from another team's space, for a missing version, or for someone who can't see the team", async () => {
    as("jordan");
    await expect(getReviewScreen("deposits", ids["cash-back"]!, 3)).rejects.toThrow();
    await expect(getReviewScreen("coral-offers", ids["cash-back"]!, 99)).rejects.toThrow(NOT_FOUND);
    await expect(getReviewScreen("coral-offers", "UC-ZZZZZZ", 1)).rejects.toThrow(NOT_FOUND);
    as("riley");
    await expect(getReviewScreen("all", ids["cash-back"]!, 3)).resolves.toMatchObject({ version: { number: 3 } });
  });

  it("shows a rename against what still renders when the Active version was revoked, and none on the live version itself", async () => {
    as("jordan");
    const versionOf = (number: number) => and(eq(versions.templateId, ids["cash-back"]!), eq(versions.number, number));
    const [v1, v2] = await Promise.all([1, 2].map((n) => db.query.versions.findFirst({ where: versionOf(n) }).then((v) => v!)));
    const revoke = { reason: "Test", startedBy: "jordan", startedAt: BASE.toISOString(), confirmedBy: "alex", confirmedAt: BASE.toISOString() };
    await db.update(versions).set({ name: "Cash Back Welcome Bonus — 2025 Terms" }).where(versionOf(1));
    await db.update(versions).set({ state: "revoked", revoke }).where(versionOf(2));
    try {
      const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
      expect(screen.liveName, "v1 still renders").toBe("Cash Back Welcome Bonus — 2025 Terms");
    } finally {
      await db.update(versions).set({ state: v2.state, revoke: v2.revoke }).where(versionOf(2));
      await db.update(versions).set({ name: v1.name }).where(versionOf(1));
    }
    expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 2)).liveName, "v2 is the live one").toBeNull();
  });

  describe("the redline's baseline when nothing is Active", () => {
    // Cash Back: v1 Superseded (it still renders), v2 Active, v3 In review based on v2. Each test revokes v2.
    const versionOf = (number: number) => and(eq(versions.templateId, ids["cash-back"]!), eq(versions.number, number));
    const revoke = { reason: "Test", startedBy: "jordan", startedAt: BASE.toISOString(), confirmedBy: "alex", confirmedAt: BASE.toISOString() };

    async function withV2Revoked(change: () => Promise<unknown>, check: () => Promise<void>) {
      const [v1, v2, v3] = await Promise.all([1, 2, 3].map((n) => db.query.versions.findFirst({ where: versionOf(n) }).then((v) => v!)));
      await db.update(versions).set({ state: "revoked", revoke }).where(versionOf(2));
      try {
        await change();
        await check();
      } finally {
        await db.update(versions).set({ state: v1.state, sunsetAt: v1.sunsetAt }).where(versionOf(1));
        await db.update(versions).set({ state: v2.state, revoke: v2.revoke }).where(versionOf(2));
        await db.update(versions).set({ basedOnVersionId: v3.basedOnVersionId }).where(versionOf(3));
      }
    }

    it("is the revoked version the correction started from, with its state; Approve still replaces nothing", async () => {
      as("jordan");
      const v2 = (await db.query.versions.findFirst({ where: versionOf(2) }))!;
      await withV2Revoked(
        async () => {},
        async () => {
          const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
          expect(screen.baseline).toEqual({
            id: v2.id,
            number: 2,
            state: "revoked",
            body: v2.body,
            variables: v2.variables,
            channels: v2.channels,
            channelFields: v2.channelFields,
          });
          expect(screen.previousNumber, "nothing is Active: the Approve dialog's previous version stays null").toBeNull();
        },
      );
    });

    it("falls back to the newest version that still renders when the based-on version is missing, then to none", async () => {
      as("jordan");
      const v1 = (await db.query.versions.findFirst({ where: versionOf(1) }))!;
      await withV2Revoked(
        () => db.update(versions).set({ basedOnVersionId: null }).where(versionOf(3)),
        async () => {
          const screen = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
          expect(screen.baseline).toMatchObject({ id: v1.id, number: 1, state: "superseded" });
          expect(screen.previousNumber).toBeNull();

          // v1's sunset passes too: nothing renders, so nothing to compare with, as for a first version.
          await db.update(versions).set({ sunsetAt: new Date(BASE.getTime() - 1000) }).where(versionOf(1));
          expect((await getReviewScreen("coral-offers", ids["cash-back"]!, 3)).baseline).toBeNull();
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
    expect(items.at(-1)).toMatchObject({ action: "template.created", versionNumber: null });
    expect(items.some((i) => i.action === "draft.edited")).toBe(true);
    const sunset = items.find((i) => i.action === "version.sunset_set")!;
    expect(sunset).toMatchObject({ actor: expect.objectContaining({ id: "jordan" }), versionNumber: 1 });
    expect(sunset.summary).toMatch(/^Jordan Ellis set v1 to sunset on /);
    const activated = items.find((i) => i.action === "version.activated" && i.versionNumber === 2)!;
    expect(activated.actor).toBeNull();
    expect(activated.summary).toBe("v2 became Active, replacing v1.");
  });
});

// ── Threads ───────────────────────────────────────────────────

describe("threads", () => {
  it("anchors the Annual Fee Waiver threads against the open draft, in block order", async () => {
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
    const open = threads.find((t) => t.status === "open")!;
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
      expect(threads.map((t) => [t.id.startsWith("th_test") ? t.id : "seeded", t.orphaned])).toEqual([
        ["th_test_doc", false],
        ["seeded", false],
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

  async function versionId(templateId: string, number: number | null) {
    const row = await db.query.versions.findFirst({
      where: number === null ? and(eq(versions.templateId, templateId), eq(versions.state, "draft")) : and(eq(versions.templateId, templateId), eq(versions.number, number)),
    });
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
      const screen = async (n: number) => (await getReviewScreen("coral-offers", templateId, n)).threads;
      expect(mine(await screen(1))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(2))).toEqual(["th_f3a_v1"]);
      expect(mine(await screen(3))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
      // Without a version, everything on the template (the editor's margin).
      const v3 = (await db.query.versions.findFirst({ where: eq(versions.id, await versionId(templateId, 3)) }))!;
      expect(mine(await loadThreads(templateId, anchorIdsOf(v3)))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
      // By id: the same rule.
      expect(mine(await getThreads("coral-offers", templateId, await versionId(templateId, 2)))).toEqual(["th_f3a_v1"]);
    } finally {
      await cleanup();
    }
  });

  it("a thread that began in the open draft counts as the next version: not on v1's record, but in the draft's margin", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const draft = await versionId(templateId, null);
    const cleanup = await addThreads(templateId, [
      { id: "th_f3a_draft", origin: draft },
      { id: "th_f3a_v1", origin: await versionId(templateId, 1) },
    ]);
    try {
      as("jordan");
      expect(mine((await getReviewScreen("coral-offers", templateId, 1)).threads)).toEqual(["th_f3a_v1"]);
      expect(mine(await getThreads("coral-offers", templateId, await versionId(templateId, 1)))).toEqual(["th_f3a_v1"]);
      // The draft itself, and the workspace's default (the open draft), show them all.
      expect(mine(await getThreads("coral-offers", templateId, draft))).toEqual(["th_f3a_draft", "th_f3a_v1"]);
      expect(mine(await getThreads("coral-offers", templateId))).toEqual(["th_f3a_draft", "th_f3a_v1"]);
    } finally {
      await cleanup();
    }
  });
});

describe("the review screen's version", () => {
  it("carries the sunset day of a Superseded version (and null without one)", async () => {
    as("jordan");
    const superseded = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 1);
    expect(superseded.version.state).toBe("superseded");
    expect(superseded.version.sunsetDay).toBe("2026-10-25");
    expect(superseded.sunsetCalendar).toEqual({ zone: "America/New_York", today: "2026-10-04" });
    const active = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 2);
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

describe("an alert's family", () => {
  it("comes from its content type, even when its version's channels were emptied", async () => {
    const templateId = ids["card-used-abroad"]!;
    const where = and(eq(versions.templateId, templateId), eq(versions.number, 1));
    const { channels } = (await db.query.versions.findFirst({ where }))!;
    await db.update(versions).set({ channels: [] }).where(where);
    try {
      as("jordan");
      expect((await getReviewScreen("coral-offers", templateId, 1)).template.family).toBe("message");
    } finally {
      await db.update(versions).set({ channels }).where(where);
    }
  });
});

describe("an alert's threads, on its fields", () => {
  it("lists a thread on a field in the fields' order, not as orphaned, on the review screen and in the workspace", async () => {
    const templateId = ids["card-used-abroad"]!;
    const v1 = (await db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.number, 1)) }))!;
    const rows = [
      { id: "th_alert_sms", blockId: "sms.text" },
      { id: "th_alert_title", blockId: "push.title" },
    ].map((r, i) => ({ ...r, templateId, originVersionId: v1.id, createdAt: new Date(BASE.getTime() - i * 1000) }));
    await db.insert(commentThreads).values(rows);
    try {
      as("jordan");
      const threads = (await getReviewScreen("coral-offers", templateId, 1)).threads.filter((t) => t.id.startsWith("th_alert"));
      expect(threads.map((t) => [t.id, t.orphaned])).toEqual([
        ["th_alert_title", false],
        ["th_alert_sms", false],
      ]);
      as("priya");
      const margin = (await getWorkspaceDocument("coral-offers", templateId)).threads.filter((t) => t.id.startsWith("th_alert"));
      expect(margin.map((t) => t.orphaned)).toEqual([false, false]);
    } finally {
      await db.delete(commentThreads).where(inArray(commentThreads.id, rows.map((r) => r.id)));
    }
  });
});
