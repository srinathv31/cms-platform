import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { LifecycleEffect } from "@/domain/review-types";
import * as schema from "@/server/db/schema/ucomp";
import { standaloneDatabasePerTest } from "@/server/testing/review-fixtures";
import {
  NOTICE_SEQ_KEY,
  takeNoticeSeqs,
  writeEffects,
  type EffectContext,
} from "./effects";

// The effects writer against a temporary database filled by the real seed: Coral Offers has two
// active approvers (Alex and Jordan), and Coral renders Balance Transfer Intro (not as a preview).

const {
  auditEvents,
  consumerNotices,
  memberships,
  notifications,
  renderLog,
  settings,
  versions,
} = schema;
const DAY = 86_400_000;
const BASE = new Date("2026-10-04T12:00:00.000Z");

const { db, ids } = standaloneDatabasePerTest({ base: BASE });

// Every test writes at its own instant, so its rows are easy to pick out.
let tick = 0;
function context(
  template: string,
  over: Partial<EffectContext> = {},
): EffectContext {
  tick += 1;
  return {
    at: new Date(BASE.getTime() + tick * 1000),
    actorId: "jordan",
    teamId: "t_coral",
    templateId: ids[template]!,
    versionId: "v_test",
    ...over,
  };
}

async function versionId(template: string, number: number) {
  const row = await db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, ids[template]!),
      eq(versions.number, number),
    ),
  });
  return row!.id;
}

async function write(effects: LifecycleEffect[], ctx: EffectContext) {
  return db.transaction((tx) => writeEffects(tx, effects, ctx));
}

const notificationsAt = (at: Date) =>
  db
    .select()
    .from(notifications)
    .where(eq(notifications.createdAt, at))
    .orderBy(notifications.userId);

describe("writeEffects: audit", () => {
  it("writes one row with the team, the template and the version", async () => {
    const ctx = context("cash-back", {
      versionId: await versionId("cash-back", 3),
    });
    const written = await write(
      [
        {
          kind: "audit",
          action: "version.submitted",
          details: { number: 3, note: "Ready" },
        },
      ],
      ctx,
    );
    expect(written).toEqual({ audit: 1, notifications: 0, consumerNotices: 0 });
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.at, ctx.at));
    expect(rows).toEqual([
      expect.objectContaining({
        actorId: "jordan",
        teamId: "t_coral",
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
        {
          kind: "audit",
          action: "version.superseded",
          versionId: other,
          details: { number: 2 },
        },
      ],
      ctx,
    );
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.at, ctx.at));
    expect(
      Object.fromEntries(rows.map((r) => [r.action, r.versionId])),
    ).toEqual({
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
    facts: {
      actorName: "Maya Chen",
      templateName: "Cash Back Welcome Bonus — Terms",
      number: 4,
      round: 1,
    },
    link: { to: "review", templateId: ids["cash-back"]!, versionNumber: 4 },
  });

  /** A comment's facts: what the writer stores, never a sentence. */
  const commented = {
    actorName: "Jordan Ellis",
    templateName: "Balance Transfer Intro — Terms",
    number: 2,
    round: 1,
    state: "superseded" as const,
    reply: true,
  };

  it("sends a team_role notification to every active member with the role: its facts, and its link placed in the team by id", async () => {
    const ctx = context("cash-back", { actorId: "maya" });
    const written = await write([reviewRequested()], ctx);
    expect(written.notifications).toBe(2);
    const rows = await notificationsAt(ctx.at);
    expect(rows.map((r) => r.userId)).toEqual(["alex", "jordan"]);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      userId: "alex",
      teamId: "t_coral",
      kind: "review_requested",
      facts: {
        actorName: "Maya Chen",
        templateName: "Cash Back Welcome Bonus — Terms",
        number: 4,
        round: 1,
      },
      link: {
        to: "review",
        teamId: "t_coral",
        templateId: ids["cash-back"],
        versionNumber: 4,
      },
      body: null,
      createdAt: ctx.at,
      readAt: null,
    });
  });

  it("leaves out exceptUserIds and the actor", async () => {
    const ctx = context("cash-back", { actorId: "jordan" });
    await write([reviewRequested(["maya"])], ctx);
    expect((await notificationsAt(ctx.at)).map((r) => r.userId)).toEqual([
      "alex",
    ]);

    const both = context("cash-back", { actorId: "maya" });
    await write([reviewRequested(["alex", "jordan"])], both);
    expect(await notificationsAt(both.at)).toEqual([]);
  });

  it("skips members whose membership isn't active", async () => {
    const alex = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, "alex"),
        eq(memberships.teamId, "t_coral"),
      ),
    });
    await db
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.id, alex!.id));
    try {
      const ctx = context("cash-back", { actorId: "maya" });
      await write([reviewRequested()], ctx);
      expect((await notificationsAt(ctx.at)).map((r) => r.userId)).toEqual([
        "jordan",
      ]);
    } finally {
      await db
        .update(memberships)
        .set({ status: "active" })
        .where(eq(memberships.id, alex!.id));
    }
  });

  it("sends a user notification to that user, with the body and the link", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    await write(
      [
        {
          kind: "notification",
          notification: "revoke_started",
          to: { kind: "user", userId: "maya" },
          facts: {
            actorName: "Jordan Ellis",
            templateName: "Balance Transfer Intro — Terms",
            number: 2,
          },
          body: "Wrong intro APR.",
          link: { to: "versions", templateId: ids["balance-transfer"]! },
        },
        {
          kind: "notification",
          notification: "comment_added",
          to: { kind: "user", userId: "jordan" }, // the actor: dropped
          facts: commented,
          link: { to: "template", templateId: ids["balance-transfer"]! },
        },
      ],
      ctx,
    );
    expect(await notificationsAt(ctx.at)).toEqual([
      expect.objectContaining({
        userId: "maya",
        kind: "revoke_started",
        body: "Wrong intro APR.",
        link: {
          to: "versions",
          teamId: "t_coral",
          templateId: ids["balance-transfer"],
        },
      }),
    ]);
  });

  it("links a review to the reviewer's own space when they can't see the template's team", async () => {
    // A stage naming Naomi (Deposits only) or Riley (Platform Admin) on a Coral Offers version.
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = {
      to: "review" as const,
      templateId: ids["balance-transfer"]!,
      versionNumber: 3,
    };
    await write(
      ["naomi", "riley", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "review_requested" as const,
        to: { kind: "user" as const, userId },
        facts: {
          actorName: "Jordan Ellis",
          templateName: "Balance Transfer Intro — Terms",
          number: 3,
          round: 1,
          stage: "Legal",
        },
        link,
      })),
      ctx,
    );
    const review = {
      to: "review",
      templateId: link.templateId,
      versionNumber: 3,
    };
    expect(
      (await notificationsAt(ctx.at)).map((n) => [n.userId, n.link]),
    ).toEqual([
      ["maya", { ...review, teamId: "t_coral" }],
      ["naomi", { ...review, teamId: "t_deposits" }],
      ["riley", { ...review, teamId: "t_coral" }],
    ]);
  });

  it("a template link that names a version: the team opens the template, someone outside it that version's review", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = {
      to: "template" as const,
      templateId: ids["balance-transfer"]!,
      reviewVersion: { number: 2 },
    };
    await write(
      ["naomi", "riley", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "comment_added" as const,
        to: { kind: "user" as const, userId },
        facts: commented,
        link,
      })),
      ctx,
    );
    const templateId = ids["balance-transfer"];
    expect(
      (await notificationsAt(ctx.at)).map((n) => [n.userId, n.link]),
    ).toEqual([
      ["maya", { to: "template", teamId: "t_coral", templateId }],
      [
        "naomi",
        { to: "review", teamId: "t_deposits", templateId, versionNumber: 2 },
      ],
      ["riley", { to: "template", teamId: "t_coral", templateId }],
    ]);
  });

  it("names a round sent back in the outside reviewer's link: bare, it would open the number's newer round", async () => {
    const ctx = context("balance-transfer", { actorId: "jordan" });
    const link = {
      to: "template" as const,
      templateId: ids["balance-transfer"]!,
      reviewVersion: { number: 3, round: 1 },
    };
    await write(
      ["naomi", "maya"].map((userId) => ({
        kind: "notification" as const,
        notification: "comment_added" as const,
        to: { kind: "user" as const, userId },
        facts: {
          ...commented,
          number: 3,
          round: 1,
          state: "changes_requested",
        },
        link,
      })),
      ctx,
    );
    const templateId = ids["balance-transfer"];
    expect(
      (await notificationsAt(ctx.at)).map((n) => [n.userId, n.link]),
    ).toEqual([
      ["maya", { to: "template", teamId: "t_coral", templateId }],
      [
        "naomi",
        {
          to: "review",
          teamId: "t_deposits",
          templateId,
          versionNumber: 3,
          round: 1,
        },
      ],
    ]);
  });
});

describe("writeEffects: consumer notices", () => {
  const sunsetNotice = (versionId: string): LifecycleEffect => ({
    kind: "consumer_notice",
    notice: "sunset_scheduled",
    versionId,
    payload: {
      versionNumber: 1,
      activeVersion: 2,
      sunsetAt: "2026-11-01T00:00:00.000Z",
      contractChanges: [],
    },
  });

  it("writes one notice per consumer that rendered the template in the last 90 days, without values", async () => {
    const v1 = await versionId("balance-transfer", 1);
    const ctx = context("balance-transfer", { versionId: v1 });
    const written = await write([sunsetNotice(v1)], ctx);
    expect(written.consumerNotices).toBe(1);
    const rows = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, ctx.at));
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
          contractChanges: [],
        },
      }),
    ]);
    // The payload is the effect's: numbers, dates and contract changes. No variable values.
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("first_name");
  });

  /** The settings counter: the last notice number handed out. */
  const counter = async () =>
    (
      await db.select().from(settings).where(eq(settings.key, NOTICE_SEQ_KEY))
    )[0]?.value;
  const lastTaken = async () => {
    const value = await counter();
    expect(typeof value).toBe("number");
    return value as number;
  };

  it("carries on from the seed's counter: while nothing is deleted, the counter is the number of notices", async () => {
    // The seed numbers its notices 1…n and stores n; every write since took the next numbers.
    const rows = await db
      .select({ seq: consumerNotices.seq })
      .from(consumerNotices);
    expect(await counter()).toBe(rows.length);
    expect(rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
      rows.map((_, i) => i + 1),
    );
  });

  it("numbers notices in the order they are written, past the last number taken, whatever their clock says", async () => {
    const v1 = await versionId("balance-transfer", 1);
    const before = await lastTaken();

    // One action, two notices at the same instant: consecutive numbers.
    const first = context("balance-transfer", { versionId: v1 });
    await write([sunsetNotice(v1), sunsetNotice(v1)], first);
    const firstRows = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, first.at));
    expect(firstRows.map((r) => r.seq).sort((a, b) => a - b)).toEqual([
      before + 1,
      before + 2,
    ]);

    // An action whose clock was read earlier but that commits later still numbers after: the
    // notices API pages on seq, so a consumer already past `before + 2` still gets it.
    const earlier = context("balance-transfer", {
      versionId: v1,
      at: new Date(first.at.getTime() - 500),
    });
    await write([sunsetNotice(v1)], earlier);
    const [late] = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, earlier.at));
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
      const rows = await db
        .select()
        .from(consumerNotices)
        .where(eq(consumerNotices.createdAt, ctx.at));
      expect(
        rows
          .map((r) => [r.consumerId, r.seq])
          .sort((a, b) => Number(a[1]) - Number(b[1])),
      ).toEqual([
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
    const [deleted] = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, gone.at));
    // Test cleanup removes a template's notices; max(seq) + 1 would now be deleted.seq again.
    await db.delete(consumerNotices).where(eq(consumerNotices.id, deleted!.id));

    const next = context("balance-transfer", { versionId: v1 });
    await write([sunsetNotice(v1)], next);
    const [row] = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, next.at));
    expect(row!.seq).toBe(deleted!.seq + 1);
  });

  it("carries on from the highest stored number when the counter row is missing", async () => {
    const highest = (
      await db.select({ seq: consumerNotices.seq }).from(consumerNotices)
    ).reduce((m, r) => Math.max(m, r.seq), 0);
    await db.delete(settings).where(eq(settings.key, NOTICE_SEQ_KEY));
    expect(await db.transaction((tx) => takeNoticeSeqs(tx, 3))).toBe(
      highest + 1,
    );
    expect(await counter()).toBe(highest + 3);
  });

  it("ignores preview renders and renders older than 90 days", async () => {
    // Annual Fee Waiver has only previews.
    const previewOnly = context("annual-fee-waiver");
    expect(
      (await write([sunsetNotice("v_x")], previewOnly)).consumerNotices,
    ).toBe(0);

    // A hundred days on, Coral's last render of Balance Transfer is outside the window.
    const later = context("balance-transfer", {
      at: new Date(BASE.getTime() + 100 * DAY),
    });
    expect((await write([sunsetNotice("v_x")], later)).consumerNotices).toBe(0);
  });

  it("writtenAt: the audience is read back from `at`, and the audit row dated then; the notice is created at writtenAt", async () => {
    // The sunset sweep's case: the sunset came (at), and the sweep runs a hundred days later (writtenAt).
    const v1 = await versionId("balance-transfer", 1);
    const ctx = context("balance-transfer", { versionId: v1, actorId: null });
    const writtenAt = new Date(ctx.at.getTime() + 100 * DAY);
    const written = await write(
      [
        {
          kind: "audit",
          action: "version.sunset_passed",
          details: {
            number: 1,
            sunsetAt: ctx.at.toISOString(),
            sunsetDay: "2026-10-04",
            zone: "America/New_York",
          },
        },
        {
          kind: "consumer_notice",
          notice: "sunset_passed",
          versionId: v1,
          payload: {
            versionNumber: 1,
            activeVersion: 2,
            sunsetAt: ctx.at.toISOString(),
          },
        },
      ],
      { ...ctx, writtenAt },
    );
    // Coral's last render is within 90 days of `at`, though not of `writtenAt`.
    expect(written).toEqual({ audit: 1, notifications: 0, consumerNotices: 1 });
    expect(
      await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at)),
    ).toHaveLength(1);
    const rows = await db
      .select()
      .from(consumerNotices)
      .where(eq(consumerNotices.createdAt, writtenAt));
    expect(rows.map((r) => [r.consumerId, r.kind])).toEqual([
      ["coral", "sunset_passed"],
    ]);
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
              facts: { actorName: "Maya Chen", templateName: "x", number: 1 },
              link: { to: "versions", templateId: ctx.templateId },
            },
            sunsetNotice("v_x"),
          ],
          ctx,
        );
        throw new Error("the transition failed");
      }),
    ).rejects.toThrow("the transition failed");
    expect(
      await db.select().from(auditEvents).where(eq(auditEvents.at, ctx.at)),
    ).toEqual([]);
    expect(await notificationsAt(ctx.at)).toEqual([]);
    expect(
      await db
        .select()
        .from(consumerNotices)
        .where(eq(consumerNotices.createdAt, ctx.at)),
    ).toEqual([]);
  });
});
