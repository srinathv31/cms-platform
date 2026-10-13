import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeActivity } from "@/domain/activity";
import { sunsetDay } from "@/domain/business-zone";
import { formatLongDate } from "@/domain/dates";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { freshDatabasePerTest } from "@/server/testing/review-fixtures";
import { seedDatabase } from "@/server/seed";
import { NOTICE_SEQ_KEY } from "./effects";
import { runSunsetSweep } from "./sweeps";

// The sunset sweep on this app's own database, beyond what the contract suite sees (./contract/sweeps.ts and the
// review contract run it through `runScheduledJobs` on both implementations): the audit row's details, the notice
// audience drawn from the render log, and the notice counter. Seed facts it relies on: Balance Transfer v1 is
// Superseded with a sunset 21 days after the seed, at 00:00 Eastern on that day, and it's the seed's only sunset; v2
// is Active. Coral renders it (not as a preview) up to the seed's day. No business zone is set (Eastern). The
// database every test starts from adds renders that shape the notice audience: Deposits Online within 90 days
// before the sunset (told), a third consumer only longer ago than that or as a preview (not told).

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-sunset-sweep-");
});

const {
  auditEvents,
  consumerNotices,
  consumers,
  renderLog,
  settings,
  versions,
} = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(BASE.getTime() + n * DAY);

let db: Db;
let templateId: string;
let v1: typeof versions.$inferSelect;

const passedRows = () =>
  db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "version.sunset_passed"));
const passedNotices = () =>
  db
    .select()
    .from(consumerNotices)
    .where(eq(consumerNotices.kind, "sunset_passed"))
    .orderBy(consumerNotices.seq);
const lastSeq = async () =>
  (await db.select().from(settings).where(eq(settings.key, NOTICE_SEQ_KEY)))[0]
    ?.value as number;
/** The sweep as it runs `n` days after the seed. */
async function sweepAt(n: number) {
  env.now = day(n);
  return runSunsetSweep(env.now);
}

freshDatabasePerTest(async (built) => {
  templateId = (await seedDatabase(built, { base: BASE })).templates[
    "balance-transfer"
  ]!;
  v1 = (await built.query.versions.findFirst({
    where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
  }))!;

  const sunset = v1.sunsetAt!.getTime();
  await built.insert(consumers).values({
    id: "ledger",
    name: "Ledger",
    description: "Test consumer",
    clientName: "ledger",
  });
  const render = (
    id: string,
    consumerId: string,
    at: number,
    isPreview = false,
  ) => ({
    id,
    at: new Date(at),
    templateId,
    versionId: v1.id,
    versionNumber: 1,
    consumerId,
    channel: "web" as const,
    isPreview,
    correlationId: id,
    outcome: "ok" as const,
  });
  await built
    .insert(renderLog)
    .values([
      render("rl_deposits", "deposits-online", sunset - 30 * DAY),
      render("rl_ledger_old", "ledger", sunset - 91 * DAY),
      render("rl_ledger_preview", "ledger", sunset - DAY, true),
    ]);
});

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

beforeEach(() => {
  env.now = BASE;
});

describe("runSunsetSweep across the seed's sunset", () => {
  it("finds nothing before the sunset, up to the millisecond before it", async () => {
    expect(v1).toMatchObject({ state: "superseded" });
    expect(v1.sunsetAt).not.toBeNull();
    env.now = BASE;
    expect(await runSunsetSweep(env.now)).toEqual([]);
    env.now = new Date(v1.sunsetAt!.getTime() - 1);
    expect(await runSunsetSweep(env.now)).toEqual([]);
    expect(await passedRows()).toEqual([]);
  });

  it("past the sunset: one row, by the system, dated at the sunset, with the day in the business zone", async () => {
    const passed = await sweepAt(22);
    expect(passed.map((p) => p.versionId)).toEqual([v1.id]);

    const rows = await passedRows();
    expect(rows).toHaveLength(1);
    const day21 = sunsetDay(v1.sunsetAt!, "America/New_York");
    expect(rows[0]).toMatchObject({
      at: v1.sunsetAt,
      actorId: null,
      teamId: "t_coral",
      templateId,
      versionId: v1.id,
      details: {
        number: 1,
        sunsetAt: v1.sunsetAt!.toISOString(),
        sunsetDay: day21,
        zone: "America/New_York",
      },
    });
    // What the Activity tab and the Audit page say for it.
    expect(
      describeActivity(
        {
          action: rows[0]!.action,
          details: rows[0]!.details,
          version: { number: 1, round: 1, state: "superseded" },
        },
        null,
      ),
    ).toBe(
      `v1 stopped rendering: its sunset passed on ${formatLongDate(day21)}.`,
    );
  });

  it("and one sunset_passed notice per consumer that rendered the template in the 90 days before the sunset", async () => {
    await sweepAt(22);
    const notices = await passedNotices();
    // Coral (the seed's renders) and Deposits Online (30 days before); not Ledger (91 days before, or a preview).
    expect(notices.map((n) => n.consumerId)).toEqual([
      "coral",
      "deposits-online",
    ]);
    const day21 = sunsetDay(v1.sunsetAt!, "America/New_York");
    for (const notice of notices) {
      expect(notice).toMatchObject({
        templateId,
        versionId: v1.id,
        kind: "sunset_passed",
        // Created when the sweep wrote it, not backdated: the payload says when renders stopped.
        createdAt: day(22),
        payload: {
          templateName: "Balance Transfer Intro — Terms",
          versionNumber: 1,
          activeVersion: 2,
          sunsetAt: v1.sunsetAt!.toISOString(),
          sunsetDay: day21,
          zone: "America/New_York",
        },
      });
    }
    // The next numbers in the outbox, one after the other, and the counter moved past them.
    const seqs = notices.map((n) => n.seq);
    expect(seqs[1]).toBe(seqs[0]! + 1);
    expect(await lastSeq()).toBe(seqs[1]);
    expect(JSON.stringify(notices.map((n) => n.payload))).not.toContain(
      "first_name",
    );
  });

  it("is idempotent: a second sweep, now or later, writes nothing: no row, no notice", async () => {
    await sweepAt(22);
    const audit = (await db.select().from(auditEvents)).length;
    const notices = (await db.select().from(consumerNotices)).length;
    const seq = await lastSeq();
    expect(await runSunsetSweep(env.now)).toEqual([]);
    expect(await sweepAt(60)).toEqual([]);
    expect((await db.select().from(auditEvents)).length).toBe(audit);
    expect((await db.select().from(consumerNotices)).length).toBe(notices);
    expect(await lastSeq()).toBe(seq);
    expect(await passedRows()).toHaveLength(1);
    expect(await passedNotices()).toHaveLength(2);
  });

  it("changes nothing on the version: the render rule alone decides that it stopped", async () => {
    await sweepAt(22);
    const after = await db.query.versions.findFirst({
      where: eq(versions.id, v1.id),
    });
    expect(after).toEqual(v1);
  });
});

describe("a sweep that runs long after the sunset", () => {
  it("tells the same consumers, from the 90 days before the sunset, and the notice is created when it runs", async () => {
    // 179 days after the sunset: nobody has rendered the template in the 90 days before now.
    expect((await sweepAt(200)).map((p) => p.versionId)).toEqual([v1.id]);
    const notices = await passedNotices();
    expect(notices.map((n) => n.consumerId)).toEqual([
      "coral",
      "deposits-online",
    ]);
    expect(notices.map((n) => n.createdAt)).toEqual([day(200), day(200)]);
    expect(notices.map((n) => n.payload.sunsetAt)).toEqual([
      v1.sunsetAt!.toISOString(),
      v1.sunsetAt!.toISOString(),
    ]);
    expect(
      (await passedRows())[0]!.at,
      "the row is still dated at the sunset",
    ).toEqual(v1.sunsetAt);
  });
});

describe("two sweeps at once", () => {
  it("write the row, and each consumer's notice, once", async () => {
    env.now = day(22);
    const [a, b] = await Promise.all([
      runSunsetSweep(env.now),
      runSunsetSweep(env.now),
    ]);
    expect([...a, ...b].map((p) => p.versionId)).toEqual([v1.id]);
    expect(await passedRows()).toHaveLength(1);
    expect((await passedNotices()).map((n) => n.consumerId)).toEqual([
      "coral",
      "deposits-online",
    ]);
  });
});
