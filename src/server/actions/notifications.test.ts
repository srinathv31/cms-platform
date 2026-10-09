import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_KINDS } from "@/domain/audit";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { getNotificationsData } from "@/server/queries/notifications";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { markAllNotificationsRead, markNotificationRead } from "./notifications";

// The bell against a temporary database filled by the real seed. Alex has three notifications:
// Chris's access request and the recertification (unread), Devon's inactivity flag (read).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-notifications-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const { notifications } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
  for (const id of ["alex", "maya", "priya", "morgan"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(refresh).mockClear();
});

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

const unreadOf = (userId: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

describe("getNotificationsData", () => {
  it("lists the viewer's notifications newest first, with the unread count and demo-clock times", async () => {
    as("alex");
    const data = await getNotificationsData();
    expect(data.items.map((n) => n.kind)).toEqual(["access_requested", "recert_due", "inactivity_flagged"]);
    expect(data.unreadCount).toBe(2);
    expect(data.items.map((n) => n.unread)).toEqual([true, true, false]);
    expect(data.items[0]).toMatchObject({
      title: "Chris Morales asked for Author access to Coral Offers.",
      href: "/coral-offers/settings/access-requests",
      ago: "Yesterday", // 1.5 days ago: calendar days on the demo clock
    });
    expect(data.items[2]!.ago).toBe("5 days ago");
  });

  it("gives every row a sentence and a link, falling back by kind when a row lacks them", async () => {
    const at = new Date(BASE.getTime() - 60_000);
    await db.insert(notifications).values(
      NOTIFICATION_KINDS.map((kind, i) => ({
        id: `nt_fallback_${i}`,
        userId: "morgan",
        teamId: "coral-offers",
        kind,
        title: "",
        body: null,
        href: null,
        createdAt: new Date(at.getTime() - i * 1000),
        readAt: null,
      })),
    );
    as("morgan");
    const data = await getNotificationsData();
    expect(data.unreadCount).toBe(NOTIFICATION_KINDS.length);
    expect(new Set(data.items.map((n) => n.kind))).toEqual(new Set(NOTIFICATION_KINDS));
    for (const n of data.items) {
      expect(n.title, n.kind).toMatch(/^[A-Z].*[.]$/);
      expect(n.href, n.kind).toMatch(/^\//);
    }
    expect(data.items.find((n) => n.kind === "recert_due")!.href).toBe("/coral-offers/settings/recertification");
  });
});

describe("markNotificationRead", () => {
  it("marks one of the viewer's own notifications read, on the demo clock", async () => {
    as("priya");
    const [first] = await unreadOf("priya");
    expect(await markNotificationRead({ id: first!.id })).toEqual({ ok: true });
    const row = await db.query.notifications.findFirst({ where: eq(notifications.id, first!.id) });
    expect(row!.readAt).toEqual(env.now);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Again: a no-op that succeeds.
    expect(await markNotificationRead({ id: first!.id })).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses someone else's notification, and one that doesn't exist, the same way", async () => {
    as("maya");
    const [alexs] = await unreadOf("alex");
    const refused = await markNotificationRead({ id: alexs!.id });
    expect(refused).toEqual({ ok: false, code: "notification_gone", reason: "This notification no longer exists." });
    expect(await markNotificationRead({ id: "nt_nope" })).toEqual(refused);
    expect(await markNotificationRead({ id: "" })).toEqual(refused);
    expect((await unreadOf("alex")).map((n) => n.id)).toContain(alexs!.id);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every unread one of the viewer's, and nobody else's", async () => {
    as("alex");
    const mayaBefore = (await unreadOf("maya")).length;
    expect(await markAllNotificationsRead()).toEqual({ ok: true, count: 2 });
    expect(await unreadOf("alex")).toEqual([]);
    expect((await unreadOf("maya")).length).toBe(mayaBefore);
    expect((await getNotificationsData()).unreadCount).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Nothing left: count 0, no refresh.
    expect(await markAllNotificationsRead()).toEqual({ ok: true, count: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
