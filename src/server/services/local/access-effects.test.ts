import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AccessEffect } from "@/domain/access-types";
import * as schema from "@/server/db/schema/ucomp";
import { standaloneDatabasePerTest } from "@/server/testing/review-fixtures";
import {
  applyMembershipChange,
  resolveAccessRecipients,
  writeAccessEffects,
} from "./access-effects";
import { inTransaction } from "./transaction";

// The access effects writer against a temporary database filled by the real seed: Alex is Coral
// Offers' only Team Admin; Naomi is Deposits'.

const { auditEvents, membershipRoles, memberships, notifications } = schema;
const BASE = new Date("2027-02-01T12:00:00.000Z");

const { db } = standaloneDatabasePerTest({ base: BASE });

let tick = 0;
const instant = () => new Date(BASE.getTime() + ++tick * 1000);

describe("resolveAccessRecipients", () => {
  it("finds the team's active Team Admins, minus the exceptions", async () => {
    await inTransaction(db, async (tx) => {
      expect(
        await resolveAccessRecipients(tx, {
          kind: "team_admins",
          teamId: "t_coral",
        }),
      ).toEqual(["alex"]);
      expect(
        await resolveAccessRecipients(tx, {
          kind: "team_admins",
          teamId: "t_deposits",
        }),
      ).toEqual(["naomi"]);
      expect(
        await resolveAccessRecipients(tx, {
          kind: "team_admins",
          teamId: "t_coral",
          exceptUserIds: ["alex"],
        }),
      ).toEqual([]);
      expect(
        await resolveAccessRecipients(tx, { kind: "user", userId: "morgan" }),
      ).toEqual(["morgan"]);
      expect(
        await resolveAccessRecipients(tx, { kind: "platform_admins" }),
      ).toEqual(["riley"]);
    });
  });
});

describe("writeAccessEffects", () => {
  it("writes audit rows (actor from the context, or the system) and notifications as facts and a link by team id", async () => {
    const now = instant();
    const backdated = new Date(now.getTime() - 86_400_000);
    const effects: AccessEffect[] = [
      {
        kind: "audit",
        action: "access.requested",
        teamId: "t_coral",
        details: { userId: "morgan", role: "author" },
      },
      {
        kind: "audit",
        action: "access.lapsed",
        teamId: "t_coral",
        actorId: null,
        at: backdated,
        details: { userId: "sam" },
      },
      {
        kind: "notification",
        notification: "access_requested",
        to: {
          kind: "team_admins",
          teamId: "t_coral",
          exceptUserIds: ["morgan"],
        },
        teamId: "t_coral",
        facts: {
          actorName: "Morgan Lee",
          teamName: "Coral Offers",
          role: "author",
        },
        body: "Drafting.",
        link: {
          to: "settings",
          teamId: "t_coral",
          section: "access-requests",
        },
      },
    ];
    const written = await inTransaction(db, (tx) =>
      writeAccessEffects(tx, effects, { now, actorId: "morgan" }),
    );
    expect(written).toEqual({ audit: 2, notifications: 1 });

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "access.lapsed"));
    expect(audit.at(-1)).toMatchObject({
      actorId: null,
      at: backdated,
      teamId: "t_coral",
      templateId: null,
    });
    const requested = (
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "access.requested"))
    ).find((e) => e.at.getTime() === now.getTime());
    expect(requested?.actorId).toBe("morgan");

    const [note] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, "alex"),
          eq(notifications.kind, "access_requested"),
          eq(notifications.createdAt, now),
        ),
      );
    expect(note).toEqual({
      id: expect.any(String),
      userId: "alex",
      teamId: "t_coral",
      kind: "access_requested",
      facts: {
        actorName: "Morgan Lee",
        teamName: "Coral Offers",
        role: "author",
      },
      link: { to: "settings", teamId: "t_coral", section: "access-requests" },
      body: "Drafting.",
      createdAt: now,
      readAt: null,
    });
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
            to: { kind: "team_admins", teamId: "t_coral" },
            teamId: "t_coral",
            facts: {
              teamName: "Coral Offers",
              dueAt: "2027-03-03T12:00:00.000Z",
              members: 6,
            },
            link: {
              to: "settings",
              teamId: "t_coral",
              section: "recertification",
            },
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
        membership: {
          userId: "morgan",
          teamId: "t_coral",
          roles: ["author"],
          addedAt: now,
          addedBy: "alex",
        },
      }),
    );
    const roles = async () =>
      (
        await db
          .select()
          .from(membershipRoles)
          .where(eq(membershipRoles.membershipId, id))
      )
        .map((r) => r.role)
        .sort();
    expect(await roles()).toEqual(["author"]);

    await inTransaction(db, (tx) =>
      applyMembershipChange(tx, {
        kind: "update",
        membershipId: id,
        set: {
          roles: ["viewer", "approver"],
          status: "lapsed",
          statusReason: "recert_unconfirmed",
          statusChangedAt: now,
        },
      }),
    );
    expect(await roles()).toEqual(["approver", "viewer"]);
    const [row] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, id));
    expect(row).toMatchObject({
      status: "lapsed",
      statusReason: "recert_unconfirmed",
      statusChangedAt: now,
    });

    await inTransaction(db, (tx) =>
      applyMembershipChange(tx, { kind: "delete", membershipId: id }),
    );
    expect(
      await db.select().from(memberships).where(eq(memberships.id, id)),
    ).toEqual([]);
    expect(await roles()).toEqual([]);
  });
});
