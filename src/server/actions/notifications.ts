"use server";

import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult } from "@/domain/access-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema/ucomp";
import { refuse, serverAction } from "./kit";

// The bell's two writes, on the server action kit (kit.ts). A notification belongs to one person: only
// they mark it read (the check is the row's owner, so nobody can mark someone else's). Read times are on
// the demo clock. Marking an already-read one again is a no-op that succeeds (a double click, two tabs).

const MarkInput = z.object({ id: z.string().min(1).max(64) });

export async function markNotificationRead(input: { id: string }): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: MarkInput,
    invalid: REQUEST_REFUSALS.notificationGone,
    authorize: async ({ viewer, input }) => {
      const row = await db.query.notifications.findFirst({
        columns: { id: true, readAt: true },
        where: and(eq(notifications.id, input.id), eq(notifications.userId, viewer.userId)),
      });
      // Someone else's notification reads as missing: it doesn't confirm the id exists.
      if (!row) refuse(REQUEST_REFUSALS.notificationGone);
      return row;
    },
    transaction: async (tx, { found, now }) => {
      if (found.readAt !== null) return { ok: true };
      await tx
        .update(notifications)
        .set({ readAt: now })
        .where(and(eq(notifications.id, found.id), isNull(notifications.readAt)));
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refresh();
    },
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  return serverAction(undefined, {
    input: z.undefined(),
    // The viewer's own notifications: nothing to check.
    authorize: () => undefined,
    transaction: async (tx, { viewer, now }) => {
      const marked = await tx
        .update(notifications)
        .set({ readAt: now })
        .where(and(eq(notifications.userId, viewer.userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return { ok: true, count: marked.length };
    },
    after: ({ count }) => {
      if (count > 0) refresh();
    },
  });
}
