import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { NotificationService } from "../notifications";
import { answerFor, refuse } from "../refuse";
import type { Changed } from "../types";
import type { FakeDeps } from "./index";
import type { NotificationRow } from "./state";

// The bell in memory: the same methods as the local implementation (services/local/notifications.ts), over the
// fake's notifications. A notification belongs to one person: every method reads and writes only the viewer's own.
// Rows are kept in the order they were written, which stands in for the database's rowid.

const LIST_MAX = 100;

export function fakeNotifications(deps: FakeDeps): NotificationService {
  const { store, clock, hooks } = deps;
  return {
    async list(ctx, { limit }) {
      const asOf = await clock();
      const mine = store.state.notifications
        .map((row, written) => ({ row, written }))
        .filter(({ row }) => row.userId === ctx.viewer.userId);
      const newestFirst = [...mine].sort(
        (a, b) =>
          b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
          b.written - a.written,
      );
      return {
        ok: true,
        asOf: asOf.toISOString(),
        items: newestFirst
          .slice(0, Math.max(1, Math.min(LIST_MAX, Math.trunc(limit))))
          .map(({ row }) => ({
            id: row.id,
            kind: row.kind,
            facts: row.facts,
            link: row.link,
            body: row.body,
            createdAt: row.createdAt.toISOString(),
            readAt: row.readAt?.toISOString() ?? null,
          })),
        unreadCount: mine.filter(({ row }) => row.readAt === null).length,
      };
    },

    async markRead(ctx, input) {
      const now = await clock();
      try {
        return store.command((tx): ActionResult<Changed> => {
          const row = tx.state.notifications.find(
            (n) => n.id === input.id && n.userId === ctx.viewer.userId,
          );
          // Someone else's notification reads as missing: it doesn't confirm the id exists.
          if (!row) refuse(REQUEST_REFUSALS.notificationGone);
          if (!unread(row)) return { ok: true, changed: false };
          // Another tab marking it read in between (a test's hook stands in for it).
          if (
            hooks.beforeCompareAndSet?.({
              table: "notifications",
              id: row.id,
            }) === "competing_write"
          )
            tx.update("notifications", row, { readAt: now });
          // Compare-and-set on `readAt`: the first read time stays.
          if (!unread(row)) return { ok: true, changed: false };
          tx.update("notifications", row, { readAt: now });
          return { ok: true, changed: true };
        });
      } catch (error) {
        return answerFor(error);
      }
    },

    async markAllRead(ctx) {
      const now = await clock();
      return store.command((tx): ActionResult<{ count: number }> => {
        const mine = tx.state.notifications.filter(
          (n) => n.userId === ctx.viewer.userId && unread(n),
        );
        for (const row of mine)
          tx.update("notifications", row, { readAt: now });
        return { ok: true, count: mine.length };
      });
    },
  };
}

/** Read through a call, so a write in between is seen (a narrowed field would not be). */
function unread(row: NotificationRow): boolean {
  return row.readAt === null;
}
