import "server-only";
import { cache } from "react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import { getViewer } from "@/server/viewer";
import { relativeTime } from "./format";

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  ago: string;
  unread: boolean;
}

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
    ago: relativeTime(n.createdAt, nowDate),
    unread: n.readAt === null,
  }));
});
