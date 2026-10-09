import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeActivity } from "@/domain/activity";
import { sunsetDay } from "@/domain/business-zone";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { advanceClockAction } from "./actions/demo";
import { runSunsetSweep } from "./sunset-sweep";

// The sunset sweep against a temporary database filled by the real seed, with the demo clock moved by
// hand. Seed facts it relies on: Balance Transfer v1 is Superseded with a sunset 21 days after the seed,
// at 00:00 Eastern on that day, and it's the seed's only sunset. No business zone is set (Eastern).

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

const { auditEvents, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(BASE.getTime() + n * DAY);

let db: Db;
let libsql: Client;
let templateId: string;
let v1: typeof versions.$inferSelect;

const passedRows = () => db.select().from(auditEvents).where(eq(auditEvents.action, "version.sunset_passed"));

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  templateId = (await seedDatabase(db, { base: BASE })).templates["balance-transfer"]!;
  v1 = (await db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.number, 1)) }))!;
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
    const long = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${day21}T00:00:00Z`),
    );
    expect(describeActivity({ action: rows[0]!.action, details: rows[0]!.details, versionNumber: 1 }, null)).toBe(
      `v1 stopped rendering: its sunset passed on ${long}.`,
    );
  });

  it("is idempotent: a second sweep, now or later, writes nothing", async () => {
    const audit = (await db.select().from(auditEvents)).length;
    expect(await runSunsetSweep()).toEqual([]);
    env.now = day(60);
    expect(await runSunsetSweep()).toEqual([]);
    expect((await db.select().from(auditEvents)).length).toBe(audit);
    expect(await passedRows()).toHaveLength(1);
  });

  it("changes nothing on the version: the render rule alone decides that it stopped", async () => {
    const after = await db.query.versions.findFirst({ where: eq(versions.id, v1.id) });
    expect(after).toEqual(v1);
  });
});

describe("two sweeps at once", () => {
  it("write the row once", async () => {
    await db.delete(auditEvents).where(eq(auditEvents.action, "version.sunset_passed"));
    env.now = day(22);
    const [a, b] = await Promise.all([runSunsetSweep(), runSunsetSweep()]);
    expect([...a, ...b].map((p) => p.versionId)).toEqual([v1.id]);
    expect(await passedRows()).toHaveLength(1);
  });
});

describe("Advance clock", () => {
  it("runs the sweep after moving the clock", async () => {
    await db.delete(auditEvents).where(eq(auditEvents.action, "version.sunset_passed"));
    env.now = BASE;
    await advanceClockAction(22);
    expect(env.now).toEqual(day(22));
    expect((await passedRows()).map((r) => r.versionId)).toEqual([v1.id]);
    expect(refresh).toHaveBeenCalled();
  });
});
