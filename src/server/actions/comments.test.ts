import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { editLatest } from "@/domain/lifecycle";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { draftRow } from "@/server/templates/create";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { addComment, reopenThread, reply, resolveThread } from "./comments";

// The comment actions against a temporary database filled by the real seed. Cash Back v3 is in
// review (submitted by Maya); Annual Fee Waiver has an open draft.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-comments-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const { approvalStages, auditEvents, commentThreads, comments, notifications, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "jordan", "alex", "sam", "eli", "naomi"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

let minute = 0;
function as(userId: string) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
  return env.now;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
});

const auditAt = (at: Date) => db.select().from(auditEvents).where(eq(auditEvents.at, at));
const notificationsAt = (at: Date) =>
  db.select().from(notifications).where(eq(notifications.createdAt, at)).orderBy(notifications.userId);
const threadRow = (id: string) => db.query.commentThreads.findFirst({ where: eq(commentThreads.id, id) });

async function versionOf(template: string, number: number | null) {
  return (await db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, ids[template]!),
      number === null ? eq(versions.state, "draft") : eq(versions.number, number),
    ),
  }))!;
}

/** The id of the n-th top-level block. */
const blockAt = (body: { content?: { attrs?: Record<string, unknown> }[] }, n: number) =>
  String(body.content?.[n]?.attrs?.id);

describe("addComment", () => {
  let threadId: string;

  it("Jordan comments on a block of Cash Back v3; Maya, its author, is notified", async () => {
    const v3 = await versionOf("cash-back", 3);
    const blockId = blockAt(v3.body, 1);
    const at = as("jordan");
    const result = await addComment({
      templateId: ids["cash-back"]!,
      versionId: v3.id,
      blockId,
      quote: "  spend $1,000  ",
      body: "  Is the $1,000 threshold still right?  ",
    });
    expect(result).toEqual({ ok: true, threadId: expect.stringMatching(/^th_/) });
    if (!result.ok) return;
    threadId = result.threadId;
    expect(refresh).toHaveBeenCalledTimes(1);

    expect(await threadRow(threadId)).toMatchObject({
      templateId: ids["cash-back"],
      originVersionId: v3.id,
      blockId,
      quote: "spend $1,000",
      status: "open",
      createdAt: at,
    });
    expect(await db.select().from(comments).where(eq(comments.threadId, threadId))).toEqual([
      expect.objectContaining({ authorId: "jordan", body: "Is the $1,000 threshold still right?", kind: "comment" }),
    ]);
    expect(await auditAt(at)).toEqual([
      expect.objectContaining({
        action: "comment.added",
        versionId: v3.id,
        details: { threadId, blockId, number: 3, quote: "spend $1,000" },
      }),
    ]);
    expect(await notificationsAt(at)).toEqual([
      expect.objectContaining({
        userId: "maya",
        kind: "comment_added",
        title: "Jordan Ellis commented on Cash Back Welcome Bonus — Terms v3.",
        href: `/coral-offers/review/${ids["cash-back"]}/3`,
      }),
    ]);
  });

  it("Maya replies; Jordan is notified and Maya isn't", async () => {
    const at = as("maya");
    expect(await reply({ threadId, body: "Yes, confirmed with Product." })).toEqual({ ok: true });
    expect(await db.select().from(comments).where(eq(comments.threadId, threadId))).toHaveLength(2);
    expect((await auditAt(at)).map((r) => r.details)).toEqual([
      expect.objectContaining({ threadId, reply: true, number: 3 }),
    ]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.title])).toEqual([
      ["jordan", "Maya Chen replied on Cash Back Welcome Bonus — Terms v3."],
    ]);
  });

  it("Maya resolves the thread; a second resolve writes nothing; reopening clears who resolved it", async () => {
    const at = as("maya");
    expect(await resolveThread({ threadId })).toEqual({ ok: true });
    expect(await threadRow(threadId)).toMatchObject({ status: "resolved", resolvedBy: "maya", resolvedAt: at });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["thread.resolved"]);
    expect(refresh).toHaveBeenCalledTimes(1);

    const again = as("jordan");
    expect(await resolveThread({ threadId })).toEqual({ ok: true });
    expect(await threadRow(threadId)).toMatchObject({ resolvedBy: "maya" });
    expect(await auditAt(again)).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);

    const reopened = as("jordan");
    expect(await reopenThread({ threadId })).toEqual({ ok: true });
    expect(await threadRow(threadId)).toMatchObject({ status: "open", resolvedBy: null, resolvedAt: null });
    expect((await auditAt(reopened)).map((r) => r.action)).toEqual(["thread.reopened"]);
  });

  it("takes a thread about the whole version, and any block id on a draft", async () => {
    const v3 = await versionOf("cash-back", 3);
    as("alex");
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "Overall fine." }),
    ).toMatchObject({ ok: true });

    const draft = await versionOf("annual-fee-waiver", null);
    const at = as("jordan");
    expect(
      await addComment({ templateId: ids["annual-fee-waiver"]!, versionId: draft.id, blockId: "not_saved_yet", body: "Hm." }),
    ).toMatchObject({ ok: true });
    // A draft's author is notified with a link to the template (it isn't in review).
    expect(await notificationsAt(at)).toEqual([
      expect.objectContaining({ userId: "maya", href: `/coral-offers/templates/${ids["annual-fee-waiver"]}` }),
    ]);
  });

  it("refuses an unknown block on a frozen version, an empty comment, and a version of another template", async () => {
    const v3 = await versionOf("cash-back", 3);
    as("jordan");
    expect(await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: "nope", body: "x" })).toEqual({
      ok: false,
      code: "block_gone",
      reason: "That block isn't in this version any more.",
    });
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "  " }),
    ).toEqual({ ok: false, code: "comment_empty", reason: "Write a comment first." });
    expect(
      await addComment({ templateId: ids["balance-transfer"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "x" }),
    ).toEqual({ ok: false, ...REASONS.generic });
  });
});

/** An open draft of the template, made from its Active version as Edit makes it. Returns a way to remove it. */
async function openDraftOf(template: string, createdBy: string, id: string) {
  if (await versionOf(template, null)) throw new Error(`${template} already has an open draft`);
  const live = (await db.query.versions.findFirst({
    where: and(eq(versions.templateId, ids[template]!), eq(versions.state, "active")),
  }))!;
  const { changes } = editLatest({ from: live, createdBy, now: BASE });
  await db.insert(versions).values(draftRow(changes.draft, { id, templateId: ids[template]! }));
  return id;
}

/** Removes threads (with their comments) and a draft this file added. */
async function remove(threadIds: string[], draftId?: string) {
  await db.delete(comments).where(inArray(comments.threadId, threadIds));
  await db.delete(commentThreads).where(inArray(commentThreads.id, threadIds));
  if (draftId) await db.delete(versions).where(eq(versions.id, draftId));
}

describe("reply notifications outside the team", () => {
  it("a stage reviewer from another team who wrote in a decided version's thread gets its review screen in their own space", async () => {
    // Balance Transfer v2 is Active (no longer in review), and Maya has started its next draft, whose margin
    // shows v2's threads. Naomi (Deposits only) commented on v2 as a named stage reviewer.
    const draftId = await openDraftOf("balance-transfer", "maya", "v_test_bt_draft");
    const v2 = await versionOf("balance-transfer", 2);
    const threadId = "th_outside_reply";
    await db.insert(commentThreads).values({ id: threadId, templateId: ids["balance-transfer"]!, originVersionId: v2.id, blockId: DOCUMENT_THREAD, createdAt: BASE });
    await db.insert(comments).values({ id: "cm_outside_reply", threadId, authorId: "naomi", body: "Legal note.", createdAt: BASE });

    try {
      const at = as("maya");
      expect(await reply({ threadId, body: "Thanks, fixed in the draft." })).toEqual({ ok: true });
      const hrefs = Object.fromEntries((await notificationsAt(at)).map((n) => [n.userId, n.href]));
      expect(hrefs.naomi).toBe(`/deposits/review/${ids["balance-transfer"]}/2`);
      // Everyone on the team still goes to the template.
      for (const [userId, href] of Object.entries(hrefs)) {
        if (userId !== "naomi") expect(href).toBe(`/coral-offers/templates/${ids["balance-transfer"]}`);
      }
    } finally {
      await remove([threadId], draftId);
    }
  });
});

// ── S7: only a draft and a version in review take comments ────

describe("which versions take comments", () => {
  const writtenAt = async (at: Date) => ({
    audit: await auditAt(at),
    notifications: await notificationsAt(at),
    threads: await db.select().from(commentThreads).where(eq(commentThreads.createdAt, at)),
    comments: await db.select().from(comments).where(eq(comments.createdAt, at)),
  });
  const nothing = { audit: [], notifications: [], threads: [], comments: [] };

  it("refuses a comment on an Active version, and writes nothing", async () => {
    const v2 = await versionOf("cash-back", 2);
    expect(v2.state).toBe("active");
    const at = as("jordan");
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: v2.id, blockId: blockAt(v2.body, 1), body: "Still right?" }),
    ).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
    expect(await writtenAt(at)).toEqual(nothing);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a comment on a Superseded, Revoked or sent-back version too", async () => {
    for (const [template, number, state] of [
      ["balance-transfer", 1, "superseded"],
      ["holiday-points", 1, "revoked"],
      ["annual-fee-waiver", 1, "changes_requested"],
    ] as const) {
      const version = await versionOf(template, number);
      expect(version.state).toBe(state);
      const at = as("maya");
      expect(
        await addComment({ templateId: ids[template]!, versionId: version.id, blockId: DOCUMENT_THREAD, body: "x" }),
        `${template} v${number}`,
      ).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
      expect(await writtenAt(at)).toEqual(nothing);
    }
  });

  it("refuses a reply, a resolve and a reopen when no version of the template takes comments", async () => {
    // Balance Transfer: v1 Superseded, v2 Active, no draft. Its threads are a record.
    const v2 = await versionOf("balance-transfer", 2);
    const open = "th_test_record_open";
    const resolved = "th_test_record_resolved";
    await db.insert(commentThreads).values([
      { id: open, templateId: ids["balance-transfer"]!, originVersionId: v2.id, blockId: DOCUMENT_THREAD, createdAt: BASE },
      { id: resolved, templateId: ids["balance-transfer"]!, originVersionId: v2.id, blockId: DOCUMENT_THREAD, status: "resolved", resolvedBy: "jordan", resolvedAt: BASE, createdAt: BASE },
    ]);
    await db.insert(comments).values({ id: "cm_test_record", threadId: open, authorId: "jordan", body: "Noted.", createdAt: BASE });
    try {
      const at = as("maya");
      expect(await reply({ threadId: open, body: "x" })).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
      expect(await resolveThread({ threadId: open })).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
      expect(await reopenThread({ threadId: resolved })).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
      expect(await writtenAt(at)).toEqual(nothing);
      expect(await threadRow(open)).toMatchObject({ status: "open" });
      expect(await threadRow(resolved)).toMatchObject({ status: "resolved", resolvedBy: "jordan" });
      expect(await db.select().from(comments).where(eq(comments.threadId, open))).toHaveLength(1);
    } finally {
      await remove([open, resolved]);
    }
  });

  it("refuses a comment once the version has been decided, though it was in review when the page loaded", async () => {
    const v3 = await versionOf("cash-back", 3);
    await db.update(versions).set({ state: "changes_requested" }).where(eq(versions.id, v3.id));
    try {
      const at = as("jordan");
      expect(
        await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "Late." }),
      ).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
      expect(await writtenAt(at)).toEqual(nothing);
    } finally {
      await db.update(versions).set({ state: "in_review" }).where(eq(versions.id, v3.id));
    }
  });
});

// ── S9: a stage reviewer from another team acts on the version in review only ──

describe("a stage reviewer from another team", () => {
  // Cash Back v3 waits on a second stage that names Naomi, who is on Deposits only. To give her something
  // she can't see, the template also has an open draft (made from v2) with a thread begun in it.
  const DRAFT = "v_test_cb_draft";
  const ON_DRAFT = "th_test_draft_only";
  const ON_V3 = "th_test_on_v3";
  const ON_V2 = "th_test_on_v2";
  let v3Stages: { stages: typeof versions.$inferSelect.stages; currentStage: number } = { stages: null, currentStage: 0 };

  beforeAll(async () => {
    await db.insert(approvalStages).values({
      id: "stage_test_outside",
      contentTypeId: "ct_disclosure",
      position: 1,
      name: "Legal reviewer",
      approverRule: { kind: "user", userId: "naomi" },
    });
    // As if v3 had been submitted under the two-stage chain and passed its first stage.
    const v3 = await versionOf("cash-back", 3);
    v3Stages = { stages: v3.stages, currentStage: v3.currentStage };
    const twoStages = [...(v3.stages ?? []), { id: "stage_test_outside", name: "Legal reviewer" }];
    await db.update(versions).set({ stages: twoStages, currentStage: 1 }).where(eq(versions.id, v3.id));
    await openDraftOf("cash-back", "maya", DRAFT);
    const v2 = await versionOf("cash-back", 2);
    const threads = [
      { id: ON_DRAFT, originVersionId: DRAFT },
      { id: ON_V3, originVersionId: v3.id },
      { id: ON_V2, originVersionId: v2.id },
    ];
    await db.insert(commentThreads).values(
      threads.map((t) => ({ ...t, templateId: ids["cash-back"]!, blockId: DOCUMENT_THREAD, createdAt: BASE })),
    );
    await db.insert(comments).values(
      threads.map((t) => ({ id: `cm_${t.id}`, threadId: t.id, authorId: "maya", body: "A note.", createdAt: BASE })),
    );
  });

  afterAll(async () => {
    await remove([ON_DRAFT, ON_V3, ON_V2], DRAFT);
    await db.update(versions).set(v3Stages).where(eq(versions.id, (await versionOf("cash-back", 3)).id));
    await db.delete(approvalStages).where(eq(approvalStages.id, "stage_test_outside"));
  });

  it("can't reply to, resolve or reopen a thread begun in the open draft, and nothing is written", async () => {
    const at = as("naomi");
    expect(await reply({ threadId: ON_DRAFT, body: "Seen." })).toEqual({ ok: false, ...REASONS.generic });
    expect(await resolveThread({ threadId: ON_DRAFT })).toEqual({ ok: false, ...REASONS.generic });
    expect(await threadRow(ON_DRAFT)).toMatchObject({ status: "open", resolvedBy: null });
    await db.update(commentThreads).set({ status: "resolved", resolvedBy: "maya", resolvedAt: BASE }).where(eq(commentThreads.id, ON_DRAFT));
    expect(await reopenThread({ threadId: ON_DRAFT })).toEqual({ ok: false, ...REASONS.generic });
    expect(await threadRow(ON_DRAFT)).toMatchObject({ status: "resolved", resolvedBy: "maya" });
    expect(await db.select().from(comments).where(eq(comments.threadId, ON_DRAFT))).toHaveLength(1);
    expect(await auditAt(at)).toEqual([]);
    expect(await notificationsAt(at)).toEqual([]);
  });

  it("can't start a thread on the open draft", async () => {
    const at = as("naomi");
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: DRAFT, blockId: DOCUMENT_THREAD, body: "x" }),
    ).toEqual({ ok: false, ...REASONS.generic });
    expect(await auditAt(at)).toEqual([]);
  });

  it("still comments on the version in review, and replies to and resolves its threads", async () => {
    const v3 = await versionOf("cash-back", 3);
    as("naomi");
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "Legal: fine." }),
    ).toMatchObject({ ok: true });

    const replied = as("naomi");
    expect(await reply({ threadId: ON_V3, body: "Agreed." })).toEqual({ ok: true });
    expect((await auditAt(replied)).map((r) => r.action)).toEqual(["comment.added"]);
    expect((await notificationsAt(replied)).map((n) => n.userId)).toEqual(["maya"]);

    as("naomi");
    expect(await resolveThread({ threadId: ON_V3 })).toEqual({ ok: true });
    expect(await threadRow(ON_V3)).toMatchObject({ status: "resolved", resolvedBy: "naomi" });
    as("naomi");
    expect(await reopenThread({ threadId: ON_V3 })).toEqual({ ok: true });
    expect(await threadRow(ON_V3)).toMatchObject({ status: "open", resolvedBy: null });
  });

  it("acts on an earlier version's thread, which the version in review shows", async () => {
    as("naomi");
    expect(await resolveThread({ threadId: ON_V2 })).toEqual({ ok: true });
    expect(await threadRow(ON_V2)).toMatchObject({ status: "resolved", resolvedBy: "naomi" });
  });

  it("a team author still acts on the draft's thread", async () => {
    as("maya");
    expect(await reply({ threadId: ON_DRAFT, body: "Mine." })).toEqual({ ok: true });
  });
});

describe("who may comment", () => {
  it("refuses a viewer and someone from another team, to comment, reply or resolve", async () => {
    const v3 = await versionOf("cash-back", 3);
    const [thread] = await db.select().from(commentThreads).where(eq(commentThreads.templateId, ids["annual-fee-waiver"]!));
    for (const userId of ["sam", "eli"]) {
      const at = as(userId);
      expect(
        await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "x" }),
      ).toEqual({ ok: false, ...REASONS.generic });
      expect(await reply({ threadId: thread!.id, body: "x" })).toEqual({ ok: false, ...REASONS.generic });
      expect(await resolveThread({ threadId: thread!.id })).toEqual({ ok: false, ...REASONS.generic });
      expect(await reopenThread({ threadId: thread!.id })).toEqual({ ok: false, ...REASONS.generic });
      expect(await auditAt(at)).toEqual([]);
    }
  });

  it("an unknown thread is refused like a forbidden one", async () => {
    as("jordan");
    expect(await reply({ threadId: "th_missing", body: "x" })).toEqual({ ok: false, ...REASONS.generic });
  });
});
