import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
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

const { auditEvents, commentThreads, comments, notifications, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "jordan", "alex", "sam", "eli"]) people[id] = await loadPersona(db, id);
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
      reason: "That block isn't in this version any more.",
    });
    expect(
      await addComment({ templateId: ids["cash-back"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "  " }),
    ).toEqual({ ok: false, reason: "Write a comment first." });
    expect(
      await addComment({ templateId: ids["balance-transfer"]!, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "x" }),
    ).toEqual({ ok: false, reason: REASONS.generic });
  });
});

describe("reply notifications outside the team", () => {
  it("a stage reviewer from another team who wrote in a decided version's thread gets its review screen in their own space", async () => {
    // Balance Transfer v2 is Active (no longer in review). Naomi (Deposits only) commented on it as a named stage reviewer.
    const v2 = await versionOf("balance-transfer", 2);
    const threadId = "th_outside_reply";
    await db.insert(commentThreads).values({ id: threadId, templateId: ids["balance-transfer"]!, originVersionId: v2.id, blockId: DOCUMENT_THREAD, createdAt: BASE });
    await db.insert(comments).values({ id: "cm_outside_reply", threadId, authorId: "naomi", body: "Legal note.", createdAt: BASE });

    const at = as("maya");
    expect(await reply({ threadId, body: "Thanks, fixed in the draft." })).toEqual({ ok: true });
    const hrefs = Object.fromEntries((await notificationsAt(at)).map((n) => [n.userId, n.href]));
    expect(hrefs.naomi).toBe(`/deposits/review/${ids["balance-transfer"]}/2`);
    // Everyone on the team still goes to the template.
    for (const [userId, href] of Object.entries(hrefs)) {
      if (userId !== "naomi") expect(href).toBe(`/coral-offers/templates/${ids["balance-transfer"]}`);
    }
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
      ).toEqual({ ok: false, reason: REASONS.generic });
      expect(await reply({ threadId: thread!.id, body: "x" })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await resolveThread({ threadId: thread!.id })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await reopenThread({ threadId: thread!.id })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await auditAt(at)).toEqual([]);
    }
  });

  it("an unknown thread is refused like a forbidden one", async () => {
    as("jordan");
    expect(await reply({ threadId: "th_missing", body: "x" })).toEqual({ ok: false, reason: REASONS.generic });
  });
});
