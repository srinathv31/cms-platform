import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { StoredNotification } from "../notifications";
import type { ContractHarness } from "./harness";

// The bell's behaviour, as every implementation must show it (NotificationService in
// src/server/services/notifications.ts), from the seed: Jordan has two reviews waiting (Cash Back v3 round 2
// and Card Used Abroad v1, both unread); Maya has a send-back unread and three read; Alex has an access request
// and a recertification unread, and an inactivity flag read. A notification is stored as facts and a link that
// names its team by id (decision 0055): its words and its href are the BFF's, so no case reads a sentence.
//
// Each case sets the backend's clock, acts through the services, and compares what the bell lists before and
// after. A refusal is checked by its code.

const CORAL = "t_coral";

export function notificationsContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** The bell as `userId` sees it, with every notification they have. */
  async function bell(userId: string) {
    const list = await h
      .services()
      .notifications.list(await h.as(userId), { limit: 100 });
    if (!list.ok) throw new Error(list.code);
    return list;
  }

  /** What the bell holds, whenever it is read (`asOf` aside). */
  async function held(userId: string) {
    const { items, unreadCount } = await bell(userId);
    return { items, unreadCount };
  }

  const unreadOf = (items: readonly StoredNotification[]) =>
    items.filter((n) => n.readAt === null);

  describe("notifications.list", () => {
    it("lists the viewer's own notifications, newest first, with how many are unread, as of the backend's clock", async () => {
      h.setClock(minute(1));
      const maya = await bell("maya");
      expect(maya.asOf).toBe(minute(1).toISOString());
      expect(maya.items.length).toBeGreaterThan(1);
      const times = maya.items.map((n) => n.createdAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(maya.unreadCount).toBe(unreadOf(maya.items).length);
      expect(maya.unreadCount).toBeGreaterThan(0);

      const newest = await h
        .services()
        .notifications.list(await h.as("maya"), { limit: 1 });
      expect(newest).toEqual({ ...maya, items: maya.items.slice(0, 1) });

      const jordan = await bell("jordan");
      const mine = new Set(maya.items.map((n) => n.id));
      expect(jordan.items.length).toBeGreaterThan(0);
      expect(jordan.items.filter((n) => mine.has(n.id))).toEqual([]);
    });

    it("serves the facts and the link each notification was written with, its team named by id", async () => {
      const jordan = await bell("jordan");
      const maya = (await h.as("maya")).viewer.name;
      const priya = (await h.as("priya")).viewer.name;
      const cashBack = h.templates["cash-back"]!;
      const abroad = h.templates["card-used-abroad"]!;
      // A review link names its round exactly when the round's label does: round 2, yes; round 1, no.
      expect(
        jordan.items.map(({ kind, facts, link, readAt }) => ({
          kind,
          facts,
          link,
          readAt,
        })),
      ).toEqual([
        {
          kind: "review_requested",
          facts: {
            actorName: maya,
            templateName: expect.any(String),
            number: 3,
            round: 2,
          },
          link: {
            to: "review",
            teamId: CORAL,
            templateId: cashBack,
            versionNumber: 3,
            round: 2,
          },
          readAt: null,
        },
        {
          kind: "review_requested",
          facts: {
            actorName: priya,
            templateName: expect.any(String),
            number: 1,
            round: 1,
          },
          link: {
            to: "review",
            teamId: CORAL,
            templateId: abroad,
            versionNumber: 1,
          },
          readAt: null,
        },
      ]);
      // The submit note is the body: a person's own words, the only words stored.
      for (const n of jordan.items) expect(n.body).toEqual(expect.any(String));
    });
  });

  describe("notifications.markRead", () => {
    async function unreadOfMaya() {
      const [first] = unreadOf((await bell("maya")).items);
      if (!first)
        throw new Error("The seed gives Maya an unread notification.");
      return first;
    }

    it("marks one of the viewer's notifications read at the backend's clock, and keeps that time when marked again", async () => {
      const target = await unreadOfMaya();
      const before = await bell("maya");
      h.setClock(minute(1));
      expect(
        await h
          .services()
          .notifications.markRead(await h.as("maya"), { id: target.id }),
      ).toEqual({ ok: true, changed: true });
      const after = await bell("maya");
      expect(after.unreadCount).toBe(before.unreadCount - 1);
      expect(after.items).toEqual(
        before.items.map((n) =>
          n.id === target.id ? { ...n, readAt: minute(1).toISOString() } : n,
        ),
      );

      h.setClock(minute(2));
      expect(
        await h
          .services()
          .notifications.markRead(await h.as("maya"), { id: target.id }),
      ).toEqual({ ok: true, changed: false });
      expect((await bell("maya")).items).toEqual(after.items);
    });

    it("refuses notification_gone, and writes nothing, for someone else's notification and for one that doesn't exist", async () => {
      const target = await unreadOfMaya();
      const before = await bell("maya");
      h.setClock(minute(1));
      for (const [userId, id] of [
        ["jordan", target.id],
        ["maya", "nt_nobody"],
      ] as const)
        expect(
          await h.services().notifications.markRead(await h.as(userId), { id }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.notificationGone.code,
        });
      expect(await held("maya")).toEqual({
        items: before.items,
        unreadCount: before.unreadCount,
      });
    });

    it("marks it read once when it is marked twice at the same moment", async () => {
      const target = await unreadOfMaya();
      const before = await bell("maya");
      h.setClock(minute(1));
      const ctx = await h.as("maya");
      const answers = await Promise.all([
        h.services().notifications.markRead(ctx, { id: target.id }),
        h.services().notifications.markRead(ctx, { id: target.id }),
      ]);
      expect(answers).toEqual(
        expect.arrayContaining([
          { ok: true, changed: true },
          { ok: true, changed: false },
        ]),
      );
      expect((await bell("maya")).unreadCount).toBe(before.unreadCount - 1);
    });

    it("finds nothing to change when another tab marks it read between the read and the write", async () => {
      const target = await unreadOfMaya();
      const before = await bell("maya");
      h.setClock(minute(1));
      h.hooks({
        beforeCompareAndSet: (row) =>
          row.table === "notifications" ? "competing_write" : undefined,
      });
      expect(
        await h
          .services()
          .notifications.markRead(await h.as("maya"), { id: target.id }),
      ).toEqual({ ok: true, changed: false });
      h.hooks({});
      // The other tab's write stands, once.
      const after = await bell("maya");
      expect(after.unreadCount).toBe(before.unreadCount - 1);
      expect(after.items.find((n) => n.id === target.id)?.readAt).toBe(
        minute(1).toISOString(),
      );
    });
  });

  describe("notifications.markAllRead", () => {
    it("marks every unread notification of the viewer's read, and only theirs", async () => {
      const before = await bell("alex");
      const jordan = await held("jordan");
      expect(before.unreadCount).toBeGreaterThan(0);
      h.setClock(minute(1));
      expect(
        await h.services().notifications.markAllRead(await h.as("alex")),
      ).toEqual({ ok: true, count: before.unreadCount });
      const after = await bell("alex");
      expect(after.unreadCount).toBe(0);
      expect(after.items).toEqual(
        before.items.map((n) => ({
          ...n,
          readAt: n.readAt ?? minute(1).toISOString(),
        })),
      );
      expect(await held("jordan")).toEqual(jordan);

      h.setClock(minute(2));
      expect(
        await h.services().notifications.markAllRead(await h.as("alex")),
      ).toEqual({ ok: true, count: 0 });
      expect(await bell("alex")).toEqual({
        ...after,
        asOf: minute(2).toISOString(),
      });
    });
  });
}
