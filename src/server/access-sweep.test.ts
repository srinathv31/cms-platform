import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { asShown } from "@/server/testing/notifications";
import { seededDatabasePerTest } from "@/server/testing/review-fixtures";
import { runAccessSweep } from "./access-sweep";

// The sweep against a temporary database filled by the real seed, with the demo clock moved by hand.
// Seed facts it relies on: the Coral Offers review started 4 days ago and is due in 30 days; it
// covers Dana, Devon, Jordan, Maya, Priya and Sam. Devon last signed in 95 days ago (flagged 5 days
// ago), so the 120-day suspension lands 25 days after the seed. Alex is Coral's only Team Admin.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-access-sweep-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

const {
  auditEvents,
  memberships,
  notifications,
  recertifications,
  recertItems,
} = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(BASE.getTime() + n * DAY);

let db: Db;
let recertId: string;

seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  recertId = (await db.query.recertifications.findFirst({
    where: eq(recertifications.teamId, "t_coral"),
  }))!.id;
});

beforeEach(() => {
  env.now = BASE;
});

const coral = (userId: string) =>
  db.query.memberships.findFirst({
    where: and(
      eq(memberships.teamId, "t_coral"),
      eq(memberships.userId, userId),
    ),
  });
const count = async (table: typeof auditEvents | typeof notifications) =>
  (await db.select().from(table)).length;
const auditAfter = (at: Date) =>
  db
    .select()
    .from(auditEvents)
    .where(gt(auditEvents.at, at))
    .orderBy(asc(auditEvents.at), asc(auditEvents.action));

/** Alex confirms every member but Sam on day 16 (recertification Keep does not restart Devon's inactivity clock). */
const alexKeepsAllButSam = () =>
  db
    .update(recertItems)
    .set({ decision: "keep", decidedBy: "alex", decidedAt: day(16) })
    .where(
      and(
        eq(recertItems.recertId, recertId),
        inArray(recertItems.userId, [
          "dana",
          "devon",
          "jordan",
          "maya",
          "priya",
        ]),
      ),
    );

/** The sweep as it runs `n` days after the seed. */
async function sweepAt(n: number) {
  env.now = day(n);
  return runAccessSweep();
}

describe("runAccessSweep across the seed's deadlines", () => {
  it("finds nothing to do on a freshly seeded database", async () => {
    const before = await count(auditEvents);
    expect(await runAccessSweep()).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    expect(await count(auditEvents)).toBe(before);
  });

  it("15 days on: Devon is flagged but still active, and the review is still open", async () => {
    const result = await sweepAt(15);
    expect(result.membershipChanges).toEqual([]);
    expect(result.recertsClosed).toEqual([]);
    expect(await coral("devon")).toMatchObject({
      status: "active",
      statusReason: null,
    });
    expect(
      (await db.query.recertifications.findFirst({
        where: eq(recertifications.id, recertId),
      }))!.completedAt,
    ).toBeNull();
  });

  it("31 days on (Alex kept everyone but Sam): Devon suspended at day 25, Sam lapsed at the deadline", async () => {
    await alexKeepsAllButSam();

    const auditBefore = await count(auditEvents);
    const result = await sweepAt(31);

    const suspendAt = day(25); // 95 days idle at the seed + 25 = 120
    const dueAt = day(30);
    expect(result.recertsClosed).toEqual([
      { id: recertId, completedAt: dueAt },
    ]);
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
    for (const kept of ["dana", "jordan", "maya", "priya"])
      expect((await coral(kept))!.status).toBe("active");
    expect(
      (await db.query.recertifications.findFirst({
        where: eq(recertifications.id, recertId),
      }))!.completedAt,
    ).toEqual(dueAt);

    // Audit rows, by the system, backdated to each boundary, in time order.
    const rows = await auditAfter(day(15));
    expect(rows.map((r) => [r.action, r.at, r.actorId, r.teamId])).toEqual([
      ["access.suspended", suspendAt, null, "t_coral"],
      ["access.lapsed", dueAt, null, "t_coral"],
      ["recert.closed", dueAt, null, "t_coral"],
    ]);
    expect(rows[0]!.details).toMatchObject({
      userId: "devon",
      reason: "inactivity_auto",
      daysInactive: 120,
    });
    expect(rows[1]!.details).toMatchObject({ userId: "sam", recertId });
    expect(rows[2]!.details).toMatchObject({ kept: 5, removed: 0, lapsed: 1 });
    expect(await count(auditEvents)).toBe(auditBefore + 3);

    // Notifications: the member and the team's Team Admins, backdated too.
    const sent = (
      await db
        .select()
        .from(notifications)
        .where(gt(notifications.createdAt, day(15)))
        .orderBy(asc(notifications.createdAt), asc(notifications.userId))
    ).map((n) => asShown(n));
    expect(sent.map((n) => [n.kind, n.userId, n.createdAt, n.href])).toEqual([
      [
        "access_suspended",
        "alex",
        suspendAt,
        "/coral-offers/settings/inactivity",
      ],
      ["access_suspended", "devon", suspendAt, "/request-access"],
      [
        "access_lapsed",
        "alex",
        dueAt,
        "/coral-offers/settings/recertification",
      ],
      ["access_lapsed", "sam", dueAt, "/request-access"],
    ]);
    // Stored by team id, not by slug: the BFF builds the href when it reads the row.
    expect(sent.map((n) => [n.kind, n.userId, n.link])).toEqual([
      [
        "access_suspended",
        "alex",
        { to: "settings", teamId: "t_coral", section: "inactivity" },
      ],
      ["access_suspended", "devon", { to: "request-access" }],
      [
        "access_lapsed",
        "alex",
        { to: "settings", teamId: "t_coral", section: "recertification" },
      ],
      ["access_lapsed", "sam", { to: "request-access" }],
    ]);
  });

  it("is idempotent: sweeping again, or later, writes nothing more", async () => {
    await alexKeepsAllButSam();
    await sweepAt(31);
    const audit = await count(auditEvents);
    const sent = await count(notifications);
    expect(await sweepAt(31)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    expect(await sweepAt(32)).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
    expect(await count(auditEvents)).toBe(audit);
    expect(await count(notifications)).toBe(sent);
  });

  it("flags a newly idle member once, at day 90, and tells the Team Admins", async () => {
    await alexKeepsAllButSam();
    await sweepAt(31);
    // Dana last signed in 9 days before the seed: day 81 is her 90th day.
    const result = await sweepAt(82);
    const flagAt = day(81);
    expect((await coral("dana"))!.inactivityFlaggedAt).toEqual(flagAt);
    expect(
      result.effects.map((e) => [
        e.kind,
        e.kind === "audit" ? e.action : e.notification,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["audit", "access.flagged_inactive"],
        ["notification", "inactivity_flagged"],
      ]),
    );
    const flagged = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, "inactivity_flagged"),
          eq(notifications.createdAt, flagAt),
        ),
      );
    expect(flagged.map((n) => n.userId)).toEqual(["alex"]);
    // Again: already flagged, nothing new.
    expect(
      (await runAccessSweep()).effects.filter(
        (e) => e.kind === "audit" && e.action === "access.flagged_inactive",
      ),
    ).toEqual([]);
  });
});

describe("runAccessSweep in one 31-day jump with nobody confirmed", () => {
  it("lapses every unconfirmed member at the deadline; Devon's earlier suspension wins", async () => {
    const result = await sweepAt(31);
    const statuses = await db
      .select({
        userId: memberships.userId,
        status: memberships.status,
        at: memberships.statusChangedAt,
      })
      .from(memberships)
      .where(eq(memberships.teamId, "t_coral"))
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
    expect(await runAccessSweep()).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });
});

describe("runAccessSweep never leaves a team without a Team Admin", () => {
  it("130 days on with nobody signing in: each team's only Team Admin stays active and Riley is told", async () => {
    await sweepAt(130);
    const adminRows = await db
      .select({ userId: memberships.userId, status: memberships.status })
      .from(memberships)
      .where(inArray(memberships.userId, ["alex", "naomi", "hana"]))
      .orderBy(memberships.userId);
    expect(adminRows).toEqual([
      { userId: "alex", status: "active" },
      { userId: "hana", status: "active" },
      { userId: "naomi", status: "active" },
    ]);
    expect((await coral("jordan"))?.status).not.toBe("active"); // everyone else did lapse or go idle
    const kept = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "access.kept_last_admin"));
    expect(kept.map((r) => r.teamId).sort()).toEqual(
      ["t_cards", "t_coral", "t_deposits"].sort(),
    );
    const told = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, "riley"))
    )
      .map((n) => asShown(n))
      .filter((n) => n.href === "/all/settings/teams");
    expect(told).toHaveLength(3);
    expect(told.map((n) => n.link)).toEqual(
      told.map(() => ({ to: "platform", section: "teams" })),
    );
    expect(await runAccessSweep()).toEqual({
      membershipChanges: [],
      recertsClosed: [],
      effects: [],
    });
  });
});
