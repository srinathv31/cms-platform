import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { runAccessSweep } from "./access-sweep";

// The sweep against a temporary database filled by the real seed, with the demo clock moved by hand.
// Seed facts it relies on: the Coral Offers review started 4 days ago and is due in 30 days; it
// covers Dana, Devon, Jordan, Maya, Priya and Sam. Devon last signed in 95 days ago (flagged 5 days
// ago), so the 120-day suspension lands 25 days after the seed. Alex is Coral's only Team Admin.

const env = vi.hoisted(() => ({
  dir: "",
  now: new Date("2026-10-04T12:00:00.000Z"),
  /** The database the code under test sees; a test may point it elsewhere. */
  db: null as unknown,
}));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-access-sweep-");
  env.dir = temp.dir;
  env.db = temp.db;
  return {
    DATABASE_URL: temp.DATABASE_URL,
    libsql: temp.libsql,
    get db() {
      return env.db;
    },
  };
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

const { auditEvents, memberships, notifications, recertifications, recertItems } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(BASE.getTime() + n * DAY);

let db: Db;
let libsql: Client;
let recertId: string;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
  recertId = (await db.query.recertifications.findFirst({ where: eq(recertifications.teamId, "coral-offers") }))!.id;
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const coral = (userId: string) =>
  db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, "coral-offers"), eq(memberships.userId, userId)),
  });
const count = async (table: typeof auditEvents | typeof notifications) => (await db.select().from(table)).length;
const auditAfter = (at: Date) =>
  db.select().from(auditEvents).where(gt(auditEvents.at, at)).orderBy(asc(auditEvents.at), asc(auditEvents.action));

describe("runAccessSweep across the seed's deadlines", () => {
  it("finds nothing to do on a freshly seeded database", async () => {
    env.now = BASE;
    const before = await count(auditEvents);
    expect(await runAccessSweep()).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    expect(await count(auditEvents)).toBe(before);
  });

  it("15 days on: Devon is flagged but still active, and the review is still open", async () => {
    env.now = day(15);
    const result = await runAccessSweep();
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toEqual([]);
    expect(await coral("devon")).toMatchObject({ status: "active", statusReason: null });
    expect((await db.query.recertifications.findFirst({ where: eq(recertifications.id, recertId) }))!.completedAt).toBeNull();
  });

  it("31 days on (Alex kept everyone but Sam): Devon suspended at day 25, Sam lapsed at the deadline", async () => {
    // Alex confirms every member but Sam (recertification Keep does not restart Devon's inactivity clock).
    await db
      .update(recertItems)
      .set({ decision: "keep", decidedBy: "alex", decidedAt: day(16) })
      .where(and(eq(recertItems.recertId, recertId), inArray(recertItems.userId, ["dana", "devon", "jordan", "maya", "priya"])));

    env.now = day(31);
    const auditBefore = await count(auditEvents);
    const result = await runAccessSweep();

    const suspendAt = day(25); // 95 days idle at the seed + 25 = 120
    const dueAt = day(30);
    expect(result.recertsClosed).toEqual([{ id: recertId, completedAt: dueAt }]);
    expect(result.membershipChanges).toHaveLength(2);

    expect(await coral("devon")).toMatchObject({
      status: "suspended",
      statusReason: "inactivity_auto",
      statusChangedAt: suspendAt,
    });
    expect(await coral("sam")).toMatchObject({
      status: "lapsed",
      statusReason: "recert_unconfirmed",
      statusChangedAt: dueAt,
    });
    for (const kept of ["dana", "jordan", "maya", "priya"]) expect((await coral(kept))!.status).toBe("active");
    expect((await db.query.recertifications.findFirst({ where: eq(recertifications.id, recertId) }))!.completedAt).toEqual(
      dueAt,
    );

    // Audit rows, by the system, backdated to each boundary, in time order.
    const rows = await auditAfter(day(15));
    expect(rows.map((r) => [r.action, r.at, r.actorId, r.teamId])).toEqual([
      ["access.suspended", suspendAt, null, "coral-offers"],
      ["access.lapsed", dueAt, null, "coral-offers"],
      ["recert.closed", dueAt, null, "coral-offers"],
    ]);
    expect(rows[0]!.details).toMatchObject({ userId: "devon", reason: "inactivity_auto", daysInactive: 120 });
    expect(rows[1]!.details).toMatchObject({ userId: "sam", recertId });
    expect(rows[2]!.details).toMatchObject({ kept: 5, removed: 0, lapsed: 1 });
    expect(await count(auditEvents)).toBe(auditBefore + 3);

    // Notifications: the member and the team's Team Admins, backdated too.
    const sent = await db
      .select()
      .from(notifications)
      .where(gt(notifications.createdAt, day(15)))
      .orderBy(asc(notifications.createdAt), asc(notifications.userId));
    expect(sent.map((n) => [n.kind, n.userId, n.createdAt, n.href])).toEqual([
      ["access_suspended", "alex", suspendAt, "/coral-offers/settings/inactivity"],
      ["access_suspended", "devon", suspendAt, "/request-access"],
      ["access_lapsed", "alex", dueAt, "/coral-offers/settings/recertification"],
      ["access_lapsed", "sam", dueAt, "/request-access"],
    ]);
  });

  it("is idempotent: sweeping again, or later, writes nothing more", async () => {
    const audit = await count(auditEvents);
    const sent = await count(notifications);
    env.now = day(31);
    expect(await runAccessSweep()).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    env.now = day(32);
    expect(await runAccessSweep()).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
    expect(await count(auditEvents)).toBe(audit);
    expect(await count(notifications)).toBe(sent);
  });

  it("flags a newly idle member once, at day 90, and tells the Team Admins", async () => {
    // Dana last signed in 9 days before the seed: day 81 is her 90th day.
    env.now = day(82);
    const result = await runAccessSweep();
    const flagAt = day(81);
    expect((await coral("dana"))!.inactivityFlaggedAt).toEqual(flagAt);
    expect(result.effects.map((e) => [e.kind, e.kind === "audit" ? e.action : e.notification])).toEqual(
      expect.arrayContaining([
        ["audit", "access.flagged_inactive"],
        ["notification", "inactivity_flagged"],
      ]),
    );
    const flagged = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "inactivity_flagged"), eq(notifications.createdAt, flagAt)));
    expect(flagged.map((n) => n.userId)).toEqual(["alex"]);
    // Again: already flagged, nothing new.
    expect((await runAccessSweep()).effects.filter((e) => e.kind === "audit" && e.action === "access.flagged_inactive")).toEqual(
      [],
    );
  });
});

describe("runAccessSweep in one 31-day jump with nobody confirmed", () => {
  it("lapses every unconfirmed member at the deadline; Devon's earlier suspension wins", async () => {
    // A second database: the seed again, untouched.
    const { tempDatabase } = await import("@/server/testing/review-fixtures");
    const temp = tempDatabase("ucomp-access-sweep-2-");
    try {
      await migrate(temp.db, { migrationsFolder: "./src/server/db/migrations" });
      await seedDatabase(temp.db, { base: BASE });
      const original = env.db;
      env.db = temp.db; // the code under test now reads the fresh database
      try {
        env.now = day(31);
        const result = await runAccessSweep();
        const statuses = await temp.db
          .select({ userId: memberships.userId, status: memberships.status, at: memberships.statusChangedAt })
          .from(memberships)
          .where(eq(memberships.teamId, "coral-offers"))
          .orderBy(memberships.userId);
        expect(statuses).toEqual([
          { userId: "alex", status: "active", at: null },
          { userId: "dana", status: "lapsed", at: day(30) },
          { userId: "devon", status: "suspended", at: day(25) },
          { userId: "jordan", status: "lapsed", at: day(30) },
          { userId: "maya", status: "lapsed", at: day(30) },
          { userId: "priya", status: "lapsed", at: day(30) },
          { userId: "sam", status: "lapsed", at: day(30) },
        ]);
        expect(result.recertsClosed).toHaveLength(1);
        expect(await runAccessSweep()).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
      } finally {
        env.db = original;
      }
    } finally {
      temp.libsql.close();
      rmSync(temp.dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("runAccessSweep never leaves a team without a Team Admin", () => {
  it("130 days on with nobody signing in: each team's only Team Admin stays active and Riley is told", async () => {
    const { tempDatabase } = await import("@/server/testing/review-fixtures");
    const temp = tempDatabase("ucomp-access-sweep-3-");
    try {
      await migrate(temp.db, { migrationsFolder: "./src/server/db/migrations" });
      await seedDatabase(temp.db, { base: BASE });
      const original = env.db;
      env.db = temp.db;
      try {
        env.now = day(130);
        await runAccessSweep();
        const adminRows = await temp.db
          .select({ userId: memberships.userId, status: memberships.status })
          .from(memberships)
          .where(inArray(memberships.userId, ["alex", "naomi", "hana"]))
          .orderBy(memberships.userId);
        expect(adminRows).toEqual([
          { userId: "alex", status: "active" },
          { userId: "hana", status: "active" },
          { userId: "naomi", status: "active" },
        ]);
        expect((await coralIn(temp.db, "jordan"))?.status).not.toBe("active"); // everyone else did lapse or go idle
        const kept = await temp.db.select().from(auditEvents).where(eq(auditEvents.action, "access.kept_last_admin"));
        expect(kept.map((r) => r.teamId).sort()).toEqual(["card-statements", "coral-offers", "deposits"].sort());
        const told = await temp.db
          .select({ userId: notifications.userId, href: notifications.href })
          .from(notifications)
          .where(and(eq(notifications.userId, "riley"), eq(notifications.href, "/all/settings/teams")));
        expect(told).toHaveLength(3);
        expect(await runAccessSweep()).toEqual({ membershipChanges: [], recertsClosed: [], effects: [] });
      } finally {
        env.db = original;
      }
    } finally {
      temp.libsql.close();
      rmSync(temp.dir, { recursive: true, force: true });
    }
  }, 60_000);
});

const coralIn = (d: Db, userId: string) =>
  d.query.memberships.findFirst({ where: and(eq(memberships.teamId, "coral-offers"), eq(memberships.userId, userId)) });
