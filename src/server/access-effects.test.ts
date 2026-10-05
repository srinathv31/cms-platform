import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessEffect } from "@/domain/access-types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { accessHref, applyMembershipChange, resolveAccessRecipients, writeAccessEffects } from "./access-effects";
import { inTransaction } from "./effects";

// The access effects writer against a temporary database filled by the real seed: Alex is Coral
// Offers' only Team Admin; Naomi is Deposits'.

const { auditEvents, membershipRoles, memberships, notifications } = schema;
const BASE = new Date("2027-02-01T12:00:00.000Z");

let dir: string;
let client: Client;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ucomp-access-effects-"));
  client = createClient({ url: `file:${join(dir, "access.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
}, 60_000);

afterAll(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

let tick = 0;
const instant = () => new Date(BASE.getTime() + ++tick * 1000);

describe("accessHref", () => {
  it("builds links from team ids (which are the slugs)", () => {
    expect(accessHref({ to: "settings", teamId: "coral-offers", section: "access-requests" })).toBe(
      "/coral-offers/settings/access-requests",
    );
    expect(accessHref({ to: "library", teamId: "deposits" })).toBe("/deposits/library");
    expect(accessHref({ to: "request-access" })).toBe("/request-access");
    expect(accessHref({ to: "platform", section: "teams" })).toBe("/all/settings/teams");
  });
});

describe("resolveAccessRecipients", () => {
  it("finds the team's active Team Admins, minus the exceptions", async () => {
    await inTransaction(db, async (tx) => {
      expect(await resolveAccessRecipients(tx, { kind: "team_admins", teamId: "coral-offers" })).toEqual(["alex"]);
      expect(await resolveAccessRecipients(tx, { kind: "team_admins", teamId: "deposits" })).toEqual(["naomi"]);
      expect(
        await resolveAccessRecipients(tx, { kind: "team_admins", teamId: "coral-offers", exceptUserIds: ["alex"] }),
      ).toEqual([]);
      expect(await resolveAccessRecipients(tx, { kind: "user", userId: "morgan" })).toEqual(["morgan"]);
      expect(await resolveAccessRecipients(tx, { kind: "platform_admins" })).toEqual(["riley"]);
    });
  });
});

describe("writeAccessEffects", () => {
  it("writes audit rows (actor from the context, or the system) and notifications with hrefs", async () => {
    const now = instant();
    const backdated = new Date(now.getTime() - 86_400_000);
    const effects: AccessEffect[] = [
      { kind: "audit", action: "access.requested", teamId: "coral-offers", details: { userId: "morgan", role: "author" } },
      { kind: "audit", action: "access.lapsed", teamId: "coral-offers", actorId: null, at: backdated, details: { userId: "sam" } },
      {
        kind: "notification",
        notification: "access_requested",
        to: { kind: "team_admins", teamId: "coral-offers", exceptUserIds: ["morgan"] },
        teamId: "coral-offers",
        title: "Morgan Lee asked for Author access to Coral Offers.",
        body: "Drafting.",
        link: { to: "settings", teamId: "coral-offers", section: "access-requests" },
      },
    ];
    const written = await inTransaction(db, (tx) => writeAccessEffects(tx, effects, { now, actorId: "morgan" }));
    expect(written).toEqual({ audit: 2, notifications: 1 });

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "access.lapsed"));
    expect(audit.at(-1)).toMatchObject({ actorId: null, at: backdated, teamId: "coral-offers", templateId: null });
    const requested = (await db.select().from(auditEvents).where(eq(auditEvents.action, "access.requested"))).find(
      (e) => e.at.getTime() === now.getTime(),
    );
    expect(requested?.actorId).toBe("morgan");

    const [note] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, "alex"), eq(notifications.kind, "access_requested"), eq(notifications.createdAt, now)));
    expect(note).toMatchObject({ href: "/coral-offers/settings/access-requests", body: "Drafting.", readAt: null });
  });

  it("never notifies the actor", async () => {
    const now = instant();
    const written = await inTransaction(db, (tx) =>
      writeAccessEffects(
        tx,
        [
          {
            kind: "notification",
            notification: "recert_due",
            to: { kind: "team_admins", teamId: "coral-offers" },
            teamId: "coral-offers",
            title: "Q1 2027 access review for Coral Offers is due March 3, 2027.",
            link: { to: "settings", teamId: "coral-offers", section: "recertification" },
          },
        ],
        { now, actorId: "alex" },
      ),
    );
    expect(written.notifications).toBe(0);
  });
});

describe("applyMembershipChange", () => {
  it("inserts, updates (replacing roles) and deletes", async () => {
    const now = instant();
    const id = await inTransaction(db, (tx) =>
      applyMembershipChange(tx, {
        kind: "insert",
        membership: { userId: "morgan", teamId: "coral-offers", roles: ["author"], addedAt: now, addedBy: "alex" },
      }),
    );
    const roles = async () =>
      (await db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, id))).map((r) => r.role).sort();
    expect(await roles()).toEqual(["author"]);

    await inTransaction(db, (tx) =>
      applyMembershipChange(tx, {
        kind: "update",
        membershipId: id,
        set: { roles: ["viewer", "approver"], status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: now },
      }),
    );
    expect(await roles()).toEqual(["approver", "viewer"]);
    const [row] = await db.select().from(memberships).where(eq(memberships.id, id));
    expect(row).toMatchObject({ status: "lapsed", statusReason: "recert_unconfirmed", statusChangedAt: now });

    await inTransaction(db, (tx) => applyMembershipChange(tx, { kind: "delete", membershipId: id }));
    expect(await db.select().from(memberships).where(eq(memberships.id, id))).toEqual([]);
    expect(await roles()).toEqual([]);
  });
});
