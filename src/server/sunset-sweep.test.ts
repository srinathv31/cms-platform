import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeActivity } from "@/domain/activity";
import { sunsetDay } from "@/domain/business-zone";
import { formatLongDate } from "@/domain/dates";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { advanceClockAction } from "./actions/demo";
import { NOTICE_SEQ_KEY } from "./effects";
import { runSunsetSweep } from "./sunset-sweep";

// The sunset sweep against a temporary database filled by the real seed, with the demo clock moved by
// hand. Seed facts it relies on: Balance Transfer v1 is Superseded with a sunset 21 days after the seed,
// at 00:00 Eastern on that day, and it's the seed's only sunset; v2 is Active. Coral renders it (not as a
// preview) up to the seed's day. No business zone is set (Eastern). beforeAll adds renders that shape the
// notice audience: Deposits Online within 90 days before the sunset (told), a third consumer only longer
// ago than that or as a preview (not told).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-sunset-sweep-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({
  now: vi.fn(async () => env.now),
  advanceClock: vi.fn(async (days: number) => {
    env.now = new Date(env.now.getTime() + days * 86_400_000);
  }),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const { auditEvents, consumerNotices, consumers, renderLog, settings, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(BASE.getTime() + n * DAY);

let db: Db;
let libsql: Client;
let templateId: string;
let v1: typeof versions.$inferSelect;

const passedRows = () => db.select().from(auditEvents).where(eq(auditEvents.action, "version.sunset_passed"));
const passedNotices = () =>
  db.select().from(consumerNotices).where(eq(consumerNotices.kind, "sunset_passed")).orderBy(consumerNotices.seq);
const lastSeq = async () => (await db.select().from(settings).where(eq(settings.key, NOTICE_SEQ_KEY)))[0]?.value as number;
/** Forget the sweep's work, as if it had never run: its rows and its notices. */
async function unsweep() {
  await db.delete(auditEvents).where(eq(auditEvents.action, "version.sunset_passed"));
  await db.delete(consumerNotices).where(eq(consumerNotices.kind, "sunset_passed"));
}

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  templateId = (await seedDatabase(db, { base: BASE })).templates["balance-transfer"]!;
  v1 = (await db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.number, 1)) }))!;

  const sunset = v1.sunsetAt!.getTime();
  await db.insert(consumers).values({ id: "ledger", name: "Ledger", description: "Test consumer", clientName: "ledger" });
  const render = (id: string, consumerId: string, at: number, isPreview = false) => ({
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
  await db.insert(renderLog).values([
    render("rl_deposits", "deposits-online", sunset - 30 * DAY),
    render("rl_ledger_old", "ledger", sunset - 91 * DAY),
    render("rl_ledger_preview", "ledger", sunset - DAY, true),
  ]);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

describe("runSunsetSweep across the seed's sunset", () => {
  it("finds nothing before the sunset, up to the millisecond before it", async () => {
    expect(v1).toMatchObject({ state: "superseded" });
    expect(v1.sunsetAt).not.toBeNull();
    env.now = BASE;
    expect(await runSunsetSweep()).toEqual([]);
    env.now = new Date(v1.sunsetAt!.getTime() - 1);
    expect(await runSunsetSweep()).toEqual([]);
    expect(await passedRows()).toEqual([]);
  });

  it("past the sunset: one row, by the system, dated at the sunset, with the day in the business zone", async () => {
    env.now = day(22);
    const passed = await runSunsetSweep();
    expect(passed.map((p) => p.versionId)).toEqual([v1.id]);

    const rows = await passedRows();
    expect(rows).toHaveLength(1);
    const day21 = sunsetDay(v1.sunsetAt!, "America/New_York");
    expect(rows[0]).toMatchObject({
      at: v1.sunsetAt,
      actorId: null,
      teamId: "coral-offers",
      templateId,
      versionId: v1.id,
      details: { number: 1, sunsetAt: v1.sunsetAt!.toISOString(), sunsetDay: day21, zone: "America/New_York" },
    });
    // What the Activity tab and the Audit page say for it.
    expect(describeActivity({ action: rows[0]!.action, details: rows[0]!.details, versionNumber: 1 }, null)).toBe(
      `v1 stopped rendering: its sunset passed on ${formatLongDate(day21)}.`,
    );
  });

  it("and one sunset_passed notice per consumer that rendered the template in the 90 days before the sunset", async () => {
    const notices = await passedNotices();
    // Coral (the seed's renders) and Deposits Online (30 days before); not Ledger (91 days before, or a preview).
    expect(notices.map((n) => n.consumerId)).toEqual(["coral", "deposits-online"]);
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
    expect(JSON.stringify(notices.map((n) => n.payload))).not.toContain("first_name");
  });

  it("is idempotent: a second sweep, now or later, writes nothing: no row, no notice", async () => {
    const audit = (await db.select().from(auditEvents)).length;
    const notices = (await db.select().from(consumerNotices)).length;
    const seq = await lastSeq();
    expect(await runSunsetSweep()).toEqual([]);
    env.now = day(60);
    expect(await runSunsetSweep()).toEqual([]);
    expect((await db.select().from(auditEvents)).length).toBe(audit);
    expect((await db.select().from(consumerNotices)).length).toBe(notices);
    expect(await lastSeq()).toBe(seq);
    expect(await passedRows()).toHaveLength(1);
    expect(await passedNotices()).toHaveLength(2);
  });

  it("changes nothing on the version: the render rule alone decides that it stopped", async () => {
    const after = await db.query.versions.findFirst({ where: eq(versions.id, v1.id) });
    expect(after).toEqual(v1);
  });
});

describe("a sweep that runs long after the sunset", () => {
  it("tells the same consumers, from the 90 days before the sunset, and the notice is created when it runs", async () => {
    await unsweep();
    // 179 days after the sunset: nobody has rendered the template in the 90 days before now.
    env.now = day(200);
    expect((await runSunsetSweep()).map((p) => p.versionId)).toEqual([v1.id]);
    const notices = await passedNotices();
    expect(notices.map((n) => n.consumerId)).toEqual(["coral", "deposits-online"]);
    expect(notices.map((n) => n.createdAt)).toEqual([day(200), day(200)]);
    expect(notices.map((n) => n.payload.sunsetAt)).toEqual([v1.sunsetAt!.toISOString(), v1.sunsetAt!.toISOString()]);
    expect((await passedRows())[0]!.at, "the row is still dated at the sunset").toEqual(v1.sunsetAt);
  });
});

describe("two sweeps at once", () => {
  it("write the row, and each consumer's notice, once", async () => {
    await unsweep();
    env.now = day(22);
    const [a, b] = await Promise.all([runSunsetSweep(), runSunsetSweep()]);
    expect([...a, ...b].map((p) => p.versionId)).toEqual([v1.id]);
    expect(await passedRows()).toHaveLength(1);
    expect((await passedNotices()).map((n) => n.consumerId)).toEqual(["coral", "deposits-online"]);
  });
});

describe("Advance clock", () => {
  it("runs the sweep after moving the clock", async () => {
    await unsweep();
    env.now = BASE;
    await advanceClockAction(22);
    expect(env.now).toEqual(day(22));
    expect((await passedRows()).map((r) => r.versionId)).toEqual([v1.id]);
    expect((await passedNotices()).map((n) => [n.consumerId, n.createdAt])).toEqual([
      ["coral", day(22)],
      ["deposits-online", day(22)],
    ]);
    expect(refresh).toHaveBeenCalled();
  });
});
