import "server-only";
import { cache } from "react";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { NotificationView, NotificationsData } from "@/domain/access-types";
import { notificationFallback } from "@/domain/audit";
import { db } from "@/server/db/client";
import { notifications, teams } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import { getViewer } from "@/server/viewer";
import { dayAgo } from "./format";

/** The bell holds this many, newest first. */
export const NOTIFICATIONS_LIMIT = 30;

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  ago: string;
  unread: boolean;
}

/** @deprecated Phase 3's shape; `getNotificationsData` supersedes it (kept until the bell switches). */
export const getNotifications = cache(async (): Promise<NotificationItem[]> => {
  const viewer = await getViewer();
  const nowDate = await demoNow();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewer.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  return rows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    href: n.href,
    ago: dayAgo(n.createdAt, nowDate),
    unread: n.readAt === null,
  }));
});

/**
 * The bell: the viewer's latest notifications (newest first) and how many are unread in all. Every
 * row has a sentence and a link: the ones its writer stored, else the kind's fallback
 * (domain/audit.ts `notificationFallback`). Times are relative to the demo clock.
 */
export const getNotificationsData = cache(async (): Promise<NotificationsData> => {
  const viewer = await getViewer();
  const nowDate = await demoNow();
  const [rows, unread, teamRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, viewer.userId))
      .orderBy(desc(notifications.createdAt), desc(sql`${notifications}.rowid`))
      .limit(NOTIFICATIONS_LIMIT),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, viewer.userId), isNull(notifications.readAt))),
    db.select({ id: teams.id, slug: teams.slug, name: teams.name }).from(teams),
  ]);
  const teamsById = new Map(teamRows.map((t) => [t.id, t]));

  const items: NotificationView[] = rows.map((n) => {
    const team = n.teamId ? teamsById.get(n.teamId) : undefined;
    const fallback = notificationFallback(n.kind, { team: team?.slug ?? null, teamName: team?.name ?? null });
    return {
      id: n.id,
      kind: n.kind,
      title: n.title.trim() || fallback.title,
      body: n.body,
      href: n.href || fallback.href,
      createdAt: n.createdAt.toISOString(),
      ago: dayAgo(n.createdAt, nowDate),
      unread: n.readAt === null,
    };
  });
  return { items, unreadCount: unread[0]?.n ?? 0 };
});
