import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { getThreads, loadThreads, threadBeganBy } from "./threads";
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
  it("Jordan waits on Cash Back v3, and sees Annual Fee Waiver among the recent decisions", async () => {
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
        state: "in_review",
        author: { id: "maya", name: "Maya Chen", initials: "MC", hue: expect.any(Number) },
        submittedAt: expect.stringMatching(ISO),
        stage: { position: 0, name: "Team approver", count: 1 },
        breaking: true,
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
    expect(await getReviewBadgeCount("coral-offers")).toBe(1);
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
      name: "Cash Back Welcome Bonus — Terms",
      teamId: "coral-offers",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
    });
    expect(screen.version).toMatchObject({
      number: 3,
      state: "in_review",
      submittedBy: expect.objectContaining({ id: "maya" }),
      submittedAt: expect.stringMatching(ISO),
      contractLines: ["v3 adds required `annual_fee` (Currency)."],
    });
    expect(screen.baseline).toMatchObject({ number: 2 });
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
      approve: { ok: false, reason: REASONS.ownVersion },
      requestChanges: { ok: false, reason: REASONS.ownVersion },
      comment: { ok: true },
    });

    as("sam");
    const viewer = await getReviewScreen("coral-offers", ids["cash-back"]!, 3);
    expect(viewer.can.approve).toEqual({ ok: false, reason: REASONS.generic });
    expect(viewer.can.comment).toEqual({ ok: false, reason: REASONS.generic });

    as("jordan");
    const active = await getReviewScreen("coral-offers", ids["cash-back"]!, 2);
    expect(active.baseline).toBeNull(); // the Active version is this one
    expect(active.can.approve).toEqual({ ok: false, reason: REFUSALS.notInReview });
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
        approve: { ok: false, reason: REASONS.wroteVersion },
        requestChanges: { ok: false, reason: REASONS.wroteVersion },
        comment: { ok: true },
      });
      const queue = await getReviewQueue("coral-offers");
      expect(queue.waiting).toEqual([]);
      expect(queue.submitted).toEqual([]);
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
      sunsetAt: expect.stringMatching(ISO),
      sunsetPassed: false,
      decisions: [expect.objectContaining({ kind: "approved", stageName: "Team approver", by: expect.objectContaining({ id: "jordan" }) })],
      lastRenderAt: expect.stringMatching(ISO),
      can: {
        setSunset: { ok: true },
        startRevoke: { ok: true },
        confirmRevoke: { ok: false, reason: REFUSALS.noRevokePending },
        cancelRevoke: { ok: false, reason: REFUSALS.noRevokePending },
      },
    });
    expect(v1!.renders30d).toBeGreaterThan(0);
    expect(v2!.can.setSunset).toEqual({ ok: false, reason: REFUSALS.sunsetNotSuperseded });
    expect(v2!.revoke).toBeUndefined();
    expect(data.consumerUsage.map((u) => [u.consumerId, u.versionNumber])).toEqual([
      ["coral", 2],
      ["coral", 1],
    ]);
    expect(data.today).toBe("2026-10-04");

    as("maya");
    const author = await getVersions("coral-offers", ids["balance-transfer"]!);
    expect(author.items[1]!.can.setSunset).toEqual({ ok: false, reason: REASONS.generic });
  });

  it("once Balance Transfer v1's sunset passes, its sunset is refused to everyone, with the reason", async () => {
    const templateId = ids["balance-transfer"]!;
    as("jordan");
    const sunsetAt = new Date((await getVersions("coral-offers", templateId)).items[1]!.sunsetAt!);
    try {
      env.now = new Date(sunsetAt.getTime() - 1);
      expect((await getVersions("coral-offers", templateId)).items[1]).toMatchObject({
        sunsetPassed: false,
        can: { setSunset: { ok: true } },
      });

      env.now = sunsetAt;
      const passed = { ok: false, reason: REFUSALS.sunsetPassed };
      const [v2, v1] = (await getVersions("coral-offers", templateId)).items;
      expect(v1).toMatchObject({ state: "superseded", sunsetPassed: true, can: { setSunset: passed, startRevoke: { ok: true } } });
      expect(v2!.can.setSunset).toEqual({ ok: false, reason: REFUSALS.sunsetNotSuperseded });

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
    expect(revoked.can.startRevoke).toEqual({ ok: false, reason: REFUSALS.alreadyRevoked });
    expect(revoked.can.confirmRevoke).toEqual({ ok: false, reason: REFUSALS.alreadyRevoked });
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
        setSunset: { ok: false, reason: REFUSALS.sunsetNotSuperseded },
        startRevoke: { ok: false, reason: REFUSALS.revokePending },
        confirmRevoke: { ok: false, reason: REASONS.ownRevoke },
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

    // The workspace carries the same threads for the editor margin.
    const document = await getWorkspaceDocument("coral-offers", ids["annual-fee-waiver"]!);
    expect(document.threads).toEqual(threads);
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
      const body = (await db.query.versions.findFirst({ where: eq(versions.id, await versionId(templateId, 3)) }))!.body;
      expect(mine(await loadThreads(templateId, body))).toEqual(["th_f3a_v1", "th_f3a_v3"]);
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

  it("threadBeganBy: no later than the version; a draft origin is the next number", () => {
    expect(threadBeganBy(1, 2, 4)).toBe(true);
    expect(threadBeganBy(2, 2, 4)).toBe(true);
    expect(threadBeganBy(4, 2, 5)).toBe(false);
    expect(threadBeganBy(null, 3, 4)).toBe(false);
    expect(threadBeganBy(null, 4, 4)).toBe(true);
  });
});

describe("the review screen's version", () => {
  it("carries the sunset day of a Superseded version (and null without one)", async () => {
    as("jordan");
    const superseded = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 1);
    expect(superseded.version.state).toBe("superseded");
    expect(superseded.version.sunsetAt).toMatch(ISO);
    const active = await getReviewScreen("coral-offers", ids["balance-transfer"]!, 2);
    expect(active.version.sunsetAt).toBeNull();
  });
});
