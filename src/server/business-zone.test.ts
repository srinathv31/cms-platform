import { readFileSync, readdirSync, rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { eq, isNotNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sunsetDay, sunsetInstant } from "@/domain/business-zone";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { BUSINESS_ZONE_KEY, countPendingSunsets, readBusinessZone } from "./business-zone";

// The business time zone's setting, and the migration that moved every stored sunset from midnight UTC
// to 00:00 Eastern on the same day (decision 0017), run on a seeded database.

const env = vi.hoisted(() => ({ dir: "" }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-business-zone-");
  env.dir = temp.dir;
  return temp;
});

const { settings, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const NY = "America/New_York";
const DAY = 86_400_000;

let db: Db;
let libsql: Client;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

describe("the business time zone setting", () => {
  afterEach(async () => {
    await db.delete(settings).where(eq(settings.key, BUSINESS_ZONE_KEY));
  });

  it("is Eastern with no row, the row's zone once set, and Eastern again for a zone off the list", async () => {
    expect(await readBusinessZone(db)).toBe(NY);
    await db.insert(settings).values({ key: BUSINESS_ZONE_KEY, value: "America/Chicago" });
    expect(await readBusinessZone(db)).toBe("America/Chicago");
    await db.update(settings).set({ value: "Mars/Olympus_Mons" }).where(eq(settings.key, BUSINESS_ZONE_KEY));
    expect(await readBusinessZone(db)).toBe(NY);
  });

  it("counts the Superseded versions whose sunset is still to come", async () => {
    // The seed's one sunset: Balance Transfer v1, 21 days after the base.
    expect(await countPendingSunsets(db, BASE)).toBe(1);
    expect(await countPendingSunsets(db, new Date(BASE.getTime() + 30 * DAY))).toBe(0);
  });
});

describe("the migration to 00:00 Eastern", () => {
  const folder = "./src/server/db/migrations";
  const file = readdirSync(folder).find((name) => name.endsWith("_sunset_business_zone.sql"))!;
  const sql = readFileSync(`${folder}/${file}`, "utf8");
  const sunsets = async () =>
    Object.fromEntries(
      (await db.select({ id: versions.id, sunsetAt: versions.sunsetAt }).from(versions).where(isNotNull(versions.sunsetAt))).map((v) => [
        v.id,
        v.sunsetAt!.toISOString(),
      ]),
    );
  /** Sets the demo clock so that "now" is `at`, as the migration reads it (real time plus the offset). */
  const clockAt = (at: Date) =>
    db.update(settings).set({ value: (at.getTime() - Date.now()) / DAY }).where(eq(settings.key, "clock_offset_days"));

  let seeded: Record<string, string>;
  beforeAll(async () => {
    seeded = await sunsets();
  });
  afterEach(async () => {
    await db.update(settings).set({ value: 0 }).where(eq(settings.key, "clock_offset_days"));
  });

  it("leaves the seed's sunsets alone: they are already 00:00 Eastern", async () => {
    expect(Object.values(seeded)).toHaveLength(1);
    const [at] = Object.values(seeded);
    expect(sunsetInstant(sunsetDay(new Date(at!), NY), NY).toISOString()).toBe(at);
    await libsql.execute(sql);
    expect(await sunsets()).toEqual(seeded);
  });

  it("moves a sunset stored at its day's midnight UTC to 00:00 Eastern that day, on both sides of each DST change", async () => {
    const [id] = Object.keys(seeded);
    // Day picked → what the rule before stored → what it is now.
    const cases: [string, string][] = [
      ["2027-03-01", "2027-03-01T05:00:00.000Z"], // EST
      ["2026-10-25", "2026-10-25T04:00:00.000Z"], // EDT
      ["2027-03-14", "2027-03-14T05:00:00.000Z"], // the spring-forward day: still EST at midnight
      ["2027-03-15", "2027-03-15T04:00:00.000Z"],
      ["2026-11-01", "2026-11-01T04:00:00.000Z"], // the fall-back day: still EDT at midnight
      ["2026-11-02", "2026-11-02T05:00:00.000Z"],
      ["2026-01-02", "2026-01-02T05:00:00.000Z"], // long passed: it stays passed
    ];
    try {
      for (const [day, expected] of cases) {
        await db.update(versions).set({ sunsetAt: new Date(`${day}T00:00:00.000Z`) }).where(eq(versions.id, id!));
        await libsql.execute(sql);
        const moved = (await sunsets())[id!];
        expect(moved, day).toBe(expected);
        expect(moved, `${day}, the rule's instant`).toBe(sunsetInstant(day, NY).toISOString());
        // A second run changes nothing.
        await libsql.execute(sql);
        expect((await sunsets())[id!], `${day}, run twice`).toBe(expected);
      }
    } finally {
      await db.update(versions).set({ sunsetAt: new Date(seeded[id!]!) }).where(eq(versions.id, id!));
    }
  });

  it("keeps the instant of a sunset the move would carry across now: a passed sunset stays passed", async () => {
    const [id] = Object.keys(seeded);
    const legacy = new Date("2027-03-01T00:00:00.000Z"); // 7 PM Eastern on February 28
    try {
      await db.update(versions).set({ sunsetAt: legacy }).where(eq(versions.id, id!));
      // Two hours after it passed; 00:00 Eastern would still be three hours away.
      await clockAt(new Date(legacy.getTime() + 2 * 3_600_000));
      await libsql.execute(sql);
      expect((await sunsets())[id!]).toBe(legacy.toISOString());

      // Once 00:00 Eastern has passed too, it moves: passed either way.
      await clockAt(new Date("2027-03-02T12:00:00.000Z"));
      await libsql.execute(sql);
      expect((await sunsets())[id!]).toBe("2027-03-01T05:00:00.000Z");
    } finally {
      await db.update(versions).set({ sunsetAt: new Date(seeded[id!]!) }).where(eq(versions.id, id!));
    }
  });
});
