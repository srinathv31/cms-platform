import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY_MS } from "@/domain/dates";
import { fileUrlOfPath } from "@/lib/file-url";
import type { Db } from "@/server/db/client";
import * as ucomp from "@/server/db/schema/ucomp";
import {
  FIXTURE_BASE,
  buildFixture,
  isTimeMarker,
  loadFixture,
  resolveJson,
  resolveMarker,
  stringifyFixture,
  type SeedFixture,
} from "./fixture";
import { buildSeed, seedDatabase, type SeedResult } from "./index";

// The fixture a Java loader reads (decision 0069): the same rows the seed writes, ids included, with no absolute
// time in it.

const dirs: string[] = [];
let client: Client;
let db: Db;
let seeded: SeedResult;
let fixture: SeedFixture;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucomp-seed-fixture-"));
  dirs.push(dir);
  client = createClient({ url: fileUrlOfPath(join(dir, "seed.db")) });
  db = drizzle(client, { schema: ucomp });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  seeded = await seedDatabase(db, { base: FIXTURE_BASE });
  fixture = buildFixture();
}, 60_000);

afterAll(() => {
  client?.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const table = (f: SeedFixture, name: string) => {
  const found = f.tables.find((t) => t.name === name);
  if (!found) throw new Error(`no table ${name}`);
  return found.rows;
};

describe("the seed fixture", () => {
  it("is the same file every time", () => {
    expect(stringifyFixture(buildFixture())).toBe(
      stringifyFixture(buildFixture(FIXTURE_BASE)),
    );
    expect(JSON.parse(stringifyFixture(fixture))).toEqual(fixture);
  });

  it("lists the tables in foreign-key order, with the template ids by key", () => {
    const names = fixture.tables.map((t) => t.name);
    expect(names.slice(0, 3)).toEqual(["users", "teams", "memberships"]);
    expect(names.indexOf("templates")).toBeLessThan(names.indexOf("versions"));
    expect(names.indexOf("versions")).toBeLessThan(names.indexOf("approvals"));
    expect(fixture.templates).toEqual(seeded.templates);
    expect(fixture.templates["balance-transfer"]).toBe("UC-D6KSGY");
  });

  it("has the rows and the ids of the seeded database", async () => {
    for (const { name, rows } of fixture.tables) {
      const stored = await client.execute(`select * from "${name}"`);
      expect(rows, name).toHaveLength(stored.rows.length);
      if (!stored.columns.includes("id")) continue;
      expect(rows.map((r) => r.id).sort(), name).toEqual(
        stored.rows.map((r) => r.id).sort(),
      );
    }
  });

  it("writes the columns by their database names", () => {
    const [version] = table(fixture, "versions");
    expect(Object.keys(version!)).toEqual(
      Object.values(getTableColumns(ucomp.versions)).map((c) => c.name),
    );
    expect(version).toMatchObject({
      template_id: expect.stringMatching(/^UC-/),
    });
  });

  it("makes every time relative to the reset, and resolves back to the rows the seed built", () => {
    const { tables } = buildSeed(FIXTURE_BASE);
    for (const { table: t, rows } of tables) {
      const exported = table(fixture, getTableName(t));
      expect(exported).toHaveLength(rows.length);
      const columns = Object.entries(getTableColumns(t));
      rows.forEach((row, i) => {
        for (const [key, column] of columns) {
          const given = (row as Record<string, unknown>)[key];
          const original = given ?? null;
          const value = exported[i]![column.name];
          const where = `${getTableName(t)}[${i}].${column.name}`;
          // A column the seed leaves out holds the database's default (the next case checks it).
          if (given === undefined && column.hasDefault) continue;
          if (original === null) expect(value, where).toBeNull();
          else if (column.dataType === "date") {
            expect(isTimeMarker(value), where).toBe(true);
            const resolved = resolveMarker(value as never, FIXTURE_BASE);
            expect((resolved as Date).getTime(), where).toBe(
              (original as Date).getTime(),
            );
          } else if (column.dataType === "json") {
            expect(resolveJson(value, FIXTURE_BASE), where).toEqual(
              JSON.parse(JSON.stringify(original)),
            );
          } else expect(value, where).toEqual(original);
        }
      });
    }
  });

  it("loads, at the moment it was built, as the seeded database: every row and column, defaults included", async () => {
    const loaded = loadFixture(fixture, FIXTURE_BASE);
    for (const { table: t } of buildSeed(FIXTURE_BASE).tables) {
      const name = getTableName(t);
      const rows = loaded.tables.find((l) => l.name === name)!.rows;
      expect(rows, name).toEqual(await db.select().from(t));
      for (const [key, column] of Object.entries(getTableColumns(t)))
        if (column.notNull)
          expect(
            rows.filter((r) => r[key] === null),
            `${name}.${column.name}`,
          ).toEqual([]);
    }
  });

  it("loads at another moment as the seed built then, but for its render times", () => {
    // Another quarter, and another time of day: 23:30 the evening before in New York.
    const later = new Date("2026-05-17T03:30:00.000Z");
    // The render history is one realization of the reset's calendar (business hours, weekdays): built at another
    // moment, the seed draws other times. A loader loads the realization the file holds. Notifications store
    // facts (decision 0055), so they load as the seed built then, sunsets and deadlines included.
    const comparable = (tables: ReturnType<typeof loadFixture>["tables"]) =>
      tables.filter((t) => t.name !== "render_log");
    const loaded = loadFixture(fixture, later);
    expect(comparable(loaded.tables)).toEqual(
      comparable(loadFixture(buildFixture(later), later).tables),
    );
    // The label a loader derives from the recertification's deadline, 30 days on.
    const recerts = loaded.tables.find((t) => t.name === "recertifications");
    expect(recerts!.rows.map((r) => r.label)).toEqual(["Q2 2026"]);
  });

  it("holds no absolute time: a seed built a week later is the same file", () => {
    const later = buildFixture(new Date(FIXTURE_BASE.getTime() + 7 * DAY_MS));
    expect(stringifyFixture(later)).toBe(stringifyFixture(fixture));
  });

  it("leaves no ISO instant or calendar day as a string", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null)
        Object.values(value).forEach(walk);
    };
    for (const { rows } of fixture.tables) rows.forEach(walk);
    expect(
      strings.filter(
        (s) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) ||
          /^\d{4}-\d{2}-\d{2}$/.test(s),
      ),
    ).toEqual([]);
  });

  it("says how each kind of time is relative", () => {
    const balanceTransfer = fixture.templates["balance-transfer"];
    const [v1] = table(fixture, "versions").filter(
      (v) => v.template_id === balanceTransfer && v.number === 1,
    );
    // An instant is days before the reset; a sunset is the start of a day in the business zone.
    expect(v1).toMatchObject({
      created_at: { daysAgo: 160 },
      sunset_at: {
        dayOffset: 21,
        zone: "America/New_York",
        startOfDay: true,
      },
    });
    // A notice records the same sunset as an instant and as the day it falls on, and the two stay in step.
    const sunset = table(fixture, "consumer_notices").find(
      (n) => n.kind === "sunset_scheduled",
    );
    expect(sunset!.payload).toMatchObject({
      sunsetAt: { dayOffset: 21, zone: "America/New_York", startOfDay: true },
      sunsetDay: { dayOffset: 21, zone: "America/New_York" },
      zone: "America/New_York",
    });
    // A date a variable samples is a calendar day counted from the reset, in UTC.
    expect(
      table(fixture, "versions").some((v) =>
        JSON.stringify(v.sample_sets).includes('{"dayOffset":45,"zone":"UTC"}'),
      ),
    ).toBe(true);
    // The reset's own moment.
    expect(
      table(fixture, "settings").find((s) => s.key === "seeded_at")!.value,
    ).toEqual({ daysAgo: 0 });
  });

  it("resolves a marker against the moment a loader loads", () => {
    const loadedAt = new Date("2027-03-05T20:00:00.000Z");
    expect(resolveMarker({ daysAgo: 1.5 }, loadedAt)).toEqual(
      new Date("2027-03-04T08:00:00.000Z"),
    );
    expect(resolveMarker({ daysAgo: -30 }, loadedAt)).toEqual(
      new Date("2027-04-04T20:00:00.000Z"),
    );
    expect(resolveMarker({ dayOffset: 45, zone: "UTC" }, loadedAt)).toBe(
      "2027-04-19",
    );
    // 15:00 on March 5 in New York: the sunset 21 days on starts at midnight on March 26 there (EDT, UTC-4).
    expect(
      resolveMarker(
        { dayOffset: 21, zone: "America/New_York", startOfDay: true },
        loadedAt,
      ),
    ).toEqual(new Date("2027-03-26T04:00:00.000Z"));
    expect(isTimeMarker({ daysAgo: 1 })).toBe(true);
    expect(isTimeMarker({ daysAgo: 1, extra: true })).toBe(false);
    expect(isTimeMarker({ dayOffset: 1 })).toBe(false);
    expect(isTimeMarker(["daysAgo"])).toBe(false);
  });
});
