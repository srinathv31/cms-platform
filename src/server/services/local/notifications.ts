import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema/ucomp";
import type { NotificationService, StoredNotification } from "../notifications";
import { refuse, runCommand, type LocalDeps } from "./command";

// The bell on this app's own database (src/server/services/notifications.ts says what each method promises). A
// notification belongs to one person: every method reads and writes only the viewer's own rows, so there is no
// permission to check beyond the row's owner. Read times are the backend's clock.

/** The most `list` answers, whatever it is asked for. */
const LIST_MAX = 100;

export function localNotifications(deps: LocalDeps): NotificationService {
  return {
    async list(ctx, { limit }) {
      const asOf = await deps.clock();
      const mine = eq(notifications.userId, ctx.viewer.userId);
      const [rows, [unread]] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(mine)
          .orderBy(
            desc(notifications.createdAt),
            desc(sql`${notifications}.rowid`),
          )
          .limit(Math.max(1, Math.min(LIST_MAX, Math.trunc(limit)))),
        db
          .select({ n: count() })
          .from(notifications)
          .where(and(mine, isNull(notifications.readAt))),
      ]);
      return {
        ok: true,
        asOf: asOf.toISOString(),
        items: rows.map((n): StoredNotification => ({
          id: n.id,
          kind: n.kind,
          facts: n.facts,
          link: n.link,
          body: n.body,
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt?.toISOString() ?? null,
        })),
        unreadCount: unread?.n ?? 0,
      };
    },

    markRead: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const row = await db.query.notifications.findFirst({
            columns: { id: true, readAt: true },
            where: and(
              eq(notifications.id, input.id),
              eq(notifications.userId, ctx.viewer.userId),
            ),
          });
          // Someone else's notification reads as missing: it doesn't confirm the id exists.
          if (!row) refuse(REQUEST_REFUSALS.notificationGone);
          return row;
        },
        transaction: async (tx, { found, now }) => {
          if (found.readAt !== null) return { ok: true, changed: false };
          // Another tab marking it read in between (a test's hook stands in for it on SQLite, which serializes).
          if (
            deps.hooks.beforeCompareAndSet?.({
              table: "notifications",
              id: found.id,
            }) === "competing_write"
          )
            await tx
              .update(notifications)
              .set({ readAt: now })
              .where(eq(notifications.id, found.id));
          // Compare-and-set on `read_at`: the first read time stays.
          const marked = await tx
            .update(notifications)
            .set({ readAt: now })
            .where(
              and(eq(notifications.id, found.id), isNull(notifications.readAt)),
            )
            .returning({ id: notifications.id });
          return { ok: true, changed: marked.length > 0 };
        },
      }),

    markAllRead: (ctx) =>
      runCommand(deps, ctx, undefined, {
        // The viewer's own notifications: nothing to check.
        authorize: () => undefined,
        transaction: async (tx, { ctx, now }) => {
          const marked = await tx
            .update(notifications)
            .set({ readAt: now })
            .where(
              and(
                eq(notifications.userId, ctx.viewer.userId),
                isNull(notifications.readAt),
              ),
            )
            .returning({ id: notifications.id });
          return { ok: true, count: marked.length };
        },
      }),
  };
}
