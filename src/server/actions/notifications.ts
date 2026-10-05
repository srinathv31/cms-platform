"use server";

import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult } from "@/domain/access-types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema/ucomp";
import { getViewer } from "@/server/viewer";

// The bell's two writes. A notification belongs to one person: only they mark it read (the check is
// the row's owner, so nobody can mark someone else's). Read times are on the demo clock. Marking an
// already-read one again is a no-op that succeeds (a double click, two tabs).

const REASONS = {
  notFound: "This notification no longer exists.",
} as const;

const MarkInput = z.object({ id: z.string().min(1).max(64) });

export async function markNotificationRead(input: { id: string }): Promise<ActionResult> {
  const parsed = MarkInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.notFound };
  const viewer = await getViewer();
  const row = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, parsed.data.id), eq(notifications.userId, viewer.userId)),
  });
  // Someone else's notification reads as missing: it doesn't confirm the id exists.
  if (!row) return { ok: false, reason: REASONS.notFound };
  if (row.readAt === null) {
    await db
      .update(notifications)
      .set({ readAt: await now() })
      .where(and(eq(notifications.id, row.id), isNull(notifications.readAt)));
    refresh();
  }
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  const viewer = await getViewer();
  const marked = await db
    .update(notifications)
    .set({ readAt: await now() })
    .where(and(eq(notifications.userId, viewer.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (marked.length > 0) refresh();
  return { ok: true, count: marked.length };
}
