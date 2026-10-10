import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LifecycleEffect } from "@/domain/review-types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { inTransaction, NOTICE_SEQ_KEY, notificationHref, takeNoticeSeqs, writeEffects, type EffectContext } from "./effects";

// The effects writer against a temporary database filled by the real seed: Coral Offers has two
// active approvers (Alex and Jordan), and Coral renders Balance Transfer Intro (not as a preview).

const { auditEvents, consumerNotices, memberships, notifications, renderLog, settings, versions } = schema;
const DAY = 86_400_000;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let dir: string;
let client: Client;
let db: Db;
let ids: Record<string, string>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ucomp-effects-"));
  client = createClient({ url: `file:${join(dir, "effects.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
}, 60_000);

afterAll(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

// Every test writes at its own instant, so its rows are easy to pick out.
let tick = 0;
function context(template: string, over: Partial<EffectContext> = {}): EffectContext {
  tick += 1;
  return {
    at: new Date(BASE.getTime() + tick * 1000),
    actorId: "jordan",
    teamId: "coral-offers",
    templateId: ids[template]!,
    versionId: "v_test",
    ...over,
  };
}

async function versionId(template: string, number: number) {
  const row = await db.query.versions.findFirst({
    where: and(eq(versions.templateId, ids[template]!), eq(versions.number, number)),
  });
  return row!.id;
}

async function write(effects: LifecycleEffect[], ctx: EffectContext) {
  return db.transaction((tx) => writeEffects(tx, effects, ctx));
}

const notificationsAt = (at: Date) =>
  db.select().from(notifications).where(eq(notifications.createdAt, at)).orderBy(notifications.userId);

describe("writeEffects: audit", () => {
  it("writes one row with the team, the template and the version", async () => {
    const ctx = context("cash-back", { versionId: await versionId("cash-back", 3) });
    const written = await write(
      [{ kind: "audit", action: "version.submitted", details: { number: 3, note: "Ready" } }],
      ctx,
    );
    expect(written).toEqual({ audit: 1, notifications: 0, consumerNotices: 0 });
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at));
    expect(rows).toEqual([
      expect.objectContaining({
        actorId: "jordan",
        teamId: "coral-offers",
        templateId: ids["cash-back"],
        versionId: ctx.versionId,
        action: "version.submitted",
        details: { number: 3, note: "Ready" },
        sessionKey: null,
      }),
    ]);
  });

  it("files template.created under the template alone, and honours an effect's own version", async () => {
    const ctx = context("cash-back");
    const other = await versionId("cash-back", 2);
    await write(
      [
        { kind: "audit", action: "template.created", details: {} },
        { kind: "audit", action: "version.superseded", versionId: other, details: { number: 2 } },
      ],
      ctx,
    );
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at));
    expect(Object.fromEntries(rows.map((r) => [r.action, r.versionId]))).toEqual({
      "template.created": null,
      "version.superseded": other,
    });
  });
});

describe("writeEffects: notifications", () => {
  const reviewRequested = (except: string[] = []): LifecycleEffect => ({
    kind: "notification",
    notification: "review_requested",
    to: { kind: "team_role", role: "approver", exceptUserIds: except },
    title: "Maya Chen submitted Cash Back Welcome Bonus — Terms v4 for review.",
    link: { to: "review", templateId: ids["cash-back"]!, versionNumber: 4 },
  });

  it("sends a team_role notification to every active member with the role, linked under the team slug", async () => {
    const ctx = context("cash-back", { actorId: "maya" });
    const written = await write([reviewRequested()], ctx);
    expect(written.notifications).toBe(2);
    const rows = await notificationsAt(ctx.at);
    expect(rows.map((r) => r.userId)).toEqual(["alex", "jordan"]);
    expect(rows[0]).toMatchObject({
      teamId: "coral-offers",
      kind: "review_requested",
      title: "Maya Chen submitted Cash Back Welcome Bonus — Terms v4 for review.",
      body: null,
      href: `/coral-offers/review/${ids["cash-back"]}/4`,
      readAt: null,
    });
  });

  it("leaves out exceptUserIds and the actor", async () => {
    const ctx = context("cash-back", { actorId: "jordan" });
    await write([reviewRequested(["maya"])], ctx);
    expect((await notificationsAt(ctx.at)).map((r) => r.userId)).toEqual(["alex"]);

    const both = context("cash-back", { actorId: "maya" });
    await write([reviewRequested(["alex", "jordan"])], both);
    expect(await notificationsAt(both.at)).toEqual([]);
  });

  it("skips members whose membership isn't active", async () => {
    const alex = await db.query.memberships.findFirst({
      where: and(eq(memberships.userId, "alex"), eq(memberships.teamId, "coral-offers")),
    });
    await db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, alex!.id));
    try {
      const ctx = context("cash-back", { actorId: "maya" });
      await write([reviewRequested()], ctx);
      expect((await notificationsAt(ctx.at)).map((r) => r.userId)).toEqual(["jordan"]);
    } finally {
      await db.update(memberships).set({ status: "active" }).where(eq(memberships.id, alex!.id));
    }
  });

  it("sends a user notification to that user, with the body and the link", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    await write(
      [
        {
          kind: "notification",
          notification: "version_live",
          to: { kind: "user", userId: "maya" },
          title: "Balance Transfer Intro — Terms v3 is Active.",
          body: "Approved by Jordan Ellis.",
          link: { to: "versions", templateId: ids["balance-transfer"]! },
        },
        {
          kind: "notification",
          notification: "comment_added",
          to: { kind: "user", userId: "jordan" }, // the actor: dropped
          title: "x",
          link: { to: "template", templateId: ids["balance-transfer"]! },
        },
      ],
      ctx,
    );
    expect(await notificationsAt(ctx.at)).toEqual([
      expect.objectContaining({
        userId: "maya",
        kind: "version_live",
        body: "Approved by Jordan Ellis.",
        href: `/coral-offers/templates/${ids["balance-transfer"]}/versions`,
      }),
    ]);
  });

  it("links a review to the reviewer's own space when they can't see the template's team", async () => {
    // A stage naming Naomi (Deposits only) or Riley (Platform Admin) on a Coral Offers version.
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = { to: "review" as const, templateId: ids["balance-transfer"]!, versionNumber: 3 };
    await write(
      ["naomi", "riley", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "review_requested" as const,
        to: { kind: "user" as const, userId },
        title: "Waiting on you.",
        link,
      })),
      ctx,
    );
    expect((await notificationsAt(ctx.at)).map((n) => [n.userId, n.href])).toEqual([
      ["maya", `/coral-offers/review/${ids["balance-transfer"]}/3`],
      ["naomi", `/deposits/review/${ids["balance-transfer"]}/3`],
      ["riley", `/coral-offers/review/${ids["balance-transfer"]}/3`],
    ]);
  });

  it("a template link that names a version: the team opens the template, someone outside it that version's review", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = { to: "template" as const, templateId: ids["balance-transfer"]!, reviewVersion: { number: 2 } };
    await write(
      ["naomi", "riley", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "comment_added" as const,
        to: { kind: "user" as const, userId },
        title: "Jordan replied.",
        link,
      })),
      ctx,
    );
    expect((await notificationsAt(ctx.at)).map((n) => [n.userId, n.href])).toEqual([
      ["maya", `/coral-offers/templates/${ids["balance-transfer"]}`],
      ["naomi", `/deposits/review/${ids["balance-transfer"]}/2`],
      ["riley", `/coral-offers/templates/${ids["balance-transfer"]}`],
    ]);
  });

  it("names a round sent back in the outside reviewer's link: bare, it would open the number's newer round", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = { to: "template" as const, templateId: ids["balance-transfer"]!, reviewVersion: { number: 3, round: 1 } };
    await write(
      ["naomi", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "comment_added" as const,
        to: { kind: "user" as const, userId },
        title: "Jordan replied.",
        link,
      })),
      ctx,
    );
    expect((await notificationsAt(ctx.at)).map((n) => [n.userId, n.href])).toEqual([
      ["maya", `/coral-offers/templates/${ids["balance-transfer"]}`],
      ["naomi", `/deposits/review/${ids["balance-transfer"]}/3?round=1`],
    ]);
  });

  it("builds the three kinds of href, a review link with its round when it names one", () => {
    expect(notificationHref("deposits", { to: "review", templateId: "UC-AAAAAA", versionNumber: 2 })).toBe(
      "/deposits/review/UC-AAAAAA/2",
    );
    expect(notificationHref("deposits", { to: "review", templateId: "UC-AAAAAA", versionNumber: 2, round: 3 })).toBe(
      "/deposits/review/UC-AAAAAA/2?round=3",
    );
    expect(notificationHref("deposits", { to: "template", templateId: "UC-AAAAAA" })).toBe(
      "/deposits/templates/UC-AAAAAA",
    );
    expect(notificationHref("deposits", { to: "versions", templateId: "UC-AAAAAA" })).toBe(
      "/deposits/templates/UC-AAAAAA/versions",
    );
  });
});

describe("writeEffects: consumer notices", () => {
  const sunsetNotice = (versionId: string): LifecycleEffect => ({
    kind: "consumer_notice",
    notice: "sunset_scheduled",
    versionId,
    payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2026-11-01T00:00:00.000Z", contractLines: [] },
  });

  it("writes one notice per consumer that rendered the template in the last 90 days, without values", async () => {
    const v1 = await versionId("balance-transfer", 1);
    const ctx = context("balance-transfer", { versionId: v1 });
    const written = await write([sunsetNotice(v1)], ctx);
    expect(written.consumerNotices).toBe(1);
    const rows = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, ctx.at));
    expect(rows).toEqual([
      expect.objectContaining({
        consumerId: "coral",
        templateId: ids["balance-transfer"],
        versionId: v1,
        kind: "sunset_scheduled",
        payload: {
          templateName: "Balance Transfer Intro — Terms",
          versionNumber: 1,
          activeVersion: 2,
          sunsetAt: "2026-11-01T00:00:00.000Z",
          contractLines: [],
        },
      }),
    ]);
    // The payload is the effect's: numbers, dates and contract lines. No variable values.
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("first_name");
  });

  /** The settings counter: the last notice number handed out. */
  const counter = async () => (await db.select().from(settings).where(eq(settings.key, NOTICE_SEQ_KEY)))[0]?.value;
  const lastTaken = async () => {
    const value = await counter();
    expect(typeof value).toBe("number");
    return value as number;
  };

  it("carries on from the seed's counter: while nothing is deleted, the counter is the number of notices", async () => {
    // The seed numbers its notices 1…n and stores n; every write since took the next numbers.
    const rows = await db.select({ seq: consumerNotices.seq }).from(consumerNotices);
    expect(await counter()).toBe(rows.length);
    expect(rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
  });

  it("numbers notices in the order they are written, past the last number taken, whatever their clock says", async () => {
    const v1 = await versionId("balance-transfer", 1);
    const before = await lastTaken();

    // One action, two notices at the same instant: consecutive numbers.
    const first = context("balance-transfer", { versionId: v1 });
    await write([sunsetNotice(v1), sunsetNotice(v1)], first);
    const firstRows = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, first.at));
    expect(firstRows.map((r) => r.seq).sort((a, b) => a - b)).toEqual([before + 1, before + 2]);

    // An action whose clock was read earlier but that commits later still numbers after: the
    // notices API pages on seq, so a consumer already past `before + 2` still gets it.
    const earlier = context("balance-transfer", { versionId: v1, at: new Date(first.at.getTime() - 500) });
    await write([sunsetNotice(v1)], earlier);
    const [late] = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, earlier.at));
    expect(late!.seq).toBe(before + 3);
  });

  it("a notice to two consumers takes two consecutive numbers, in consumer order", async () => {
    const v1 = await versionId("balance-transfer", 1);
    // Deposits Online renders Balance Transfer too, so it joins Coral in the audience.
    await db.insert(renderLog).values({
      id: "rl_two_consumers",
      at: new Date(BASE.getTime() - DAY),
      templateId: ids["balance-transfer"]!,
      versionId: v1,
      versionNumber: 1,
      consumerId: "deposits-online",
      channel: "web",
      isPreview: false,
      correlationId: "two-consumers",
      outcome: "ok",
      errorCode: null,
      durationMs: 5,
    });
    try {
      const before = await lastTaken();
      const ctx = context("balance-transfer", { versionId: v1 });
      expect((await write([sunsetNotice(v1)], ctx)).consumerNotices).toBe(2);
      const rows = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, ctx.at));
      expect(rows.map((r) => [r.consumerId, r.seq]).sort((a, b) => Number(a[1]) - Number(b[1]))).toEqual([
        ["coral", before + 1],
        ["deposits-online", before + 2],
      ]);
      expect(await counter()).toBe(before + 2);
    } finally {
      await db.delete(renderLog).where(eq(renderLog.id, "rl_two_consumers"));
    }
  });

  it("never hands a number out twice, even after the newest notices are deleted", async () => {
    const v1 = await versionId("balance-transfer", 1);
    const gone = context("balance-transfer", { versionId: v1 });
    await write([sunsetNotice(v1)], gone);
    const [deleted] = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, gone.at));
    // Test cleanup removes a template's notices; max(seq) + 1 would now be deleted.seq again.
    await db.delete(consumerNotices).where(eq(consumerNotices.id, deleted!.id));

    const next = context("balance-transfer", { versionId: v1 });
    await write([sunsetNotice(v1)], next);
    const [row] = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, next.at));
    expect(row!.seq).toBe(deleted!.seq + 1);
  });

  it("carries on from the highest stored number when the counter row is missing", async () => {
    const highest = (await db.select({ seq: consumerNotices.seq }).from(consumerNotices)).reduce((m, r) => Math.max(m, r.seq), 0);
    await db.delete(settings).where(eq(settings.key, NOTICE_SEQ_KEY));
    expect(await db.transaction((tx) => takeNoticeSeqs(tx, 3))).toBe(highest + 1);
    expect(await counter()).toBe(highest + 3);
  });

  it("ignores preview renders and renders older than 90 days", async () => {
    // Annual Fee Waiver has only previews.
    const previewOnly = context("annual-fee-waiver");
    expect((await write([sunsetNotice("v_x")], previewOnly)).consumerNotices).toBe(0);

    // A hundred days on, Coral's last render of Balance Transfer is outside the window.
    const later = context("balance-transfer", { at: new Date(BASE.getTime() + 100 * DAY) });
    expect((await write([sunsetNotice("v_x")], later)).consumerNotices).toBe(0);
  });

  it("writtenAt: the audience is read back from `at`, and the audit row dated then; the notice is created at writtenAt", async () => {
    // The sunset sweep's case: the sunset came (at), and the sweep runs a hundred days later (writtenAt).
    const v1 = await versionId("balance-transfer", 1);
    const ctx = context("balance-transfer", { versionId: v1, actorId: null });
    const writtenAt = new Date(ctx.at.getTime() + 100 * DAY);
    const written = await write(
      [
        { kind: "audit", action: "version.sunset_passed", details: { number: 1, sunsetAt: ctx.at.toISOString(), sunsetDay: "2026-10-04", zone: "America/New_York" } },
        { kind: "consumer_notice", notice: "sunset_passed", versionId: v1, payload: { versionNumber: 1, activeVersion: 2, sunsetAt: ctx.at.toISOString() } },
      ],
      { ...ctx, writtenAt },
    );
    // Coral's last render is within 90 days of `at`, though not of `writtenAt`.
    expect(written).toEqual({ audit: 1, notifications: 0, consumerNotices: 1 });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at))).toHaveLength(1);
    const rows = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, writtenAt));
    expect(rows.map((r) => [r.consumerId, r.kind])).toEqual([["coral", "sunset_passed"]]);
  });

  it("rolls back with the transaction that wrote it", async () => {
    const ctx = context("balance-transfer", { actorId: "maya" });
    await expect(
      db.transaction(async (tx) => {
        await writeEffects(
          tx,
          [
            { kind: "audit", action: "version.revoked", details: {} },
            {
              kind: "notification",
              notification: "version_revoked",
              to: { kind: "team_role", role: "approver" },
              title: "x",
              link: { to: "versions", templateId: ctx.templateId },
            },
            sunsetNotice("v_x"),
          ],
          ctx,
        );
        throw new Error("the transition failed");
      }),
    ).rejects.toThrow("the transition failed");
    expect(await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at))).toEqual([]);
    expect(await notificationsAt(ctx.at)).toEqual([]);
    expect(await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, ctx.at))).toEqual([]);
  });
});

describe("inTransaction", () => {
  const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

  it("retries a transaction that found the file busy", async () => {
    const transaction = vi.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce("done");
    await expect(inTransaction({ transaction } as unknown as Db, async () => "unused")).resolves.toBe("done");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("recognises a busy error wrapped as a cause", async () => {
    const wrapped = Object.assign(new Error("tx failed"), { cause: busy });
    const transaction = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce(1);
    await expect(inTransaction({ transaction } as unknown as Db, async () => 0)).resolves.toBe(1);
  });

  it("passes any other error straight through", async () => {
    const transaction = vi.fn().mockRejectedValue(new Error("constraint failed"));
    await expect(inTransaction({ transaction } as unknown as Db, async () => 0)).rejects.toThrow("constraint failed");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few attempts", async () => {
    const transaction = vi.fn().mockRejectedValue(busy);
    await expect(inTransaction({ transaction } as unknown as Db, async () => 0)).rejects.toBe(busy);
    expect(transaction).toHaveBeenCalledTimes(6);
  });
});
