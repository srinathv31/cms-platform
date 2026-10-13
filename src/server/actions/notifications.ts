"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/domain/access-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { services } from "@/server/services";
import { serverAction } from "./kit";

// The bell's two writes, on the server action kit (kit.ts), behind the notification service
// (src/server/services/notifications.ts): a notification belongs to one person, and only they mark it read.
// Marking an already-read one again succeeds and changes nothing (a double click, two tabs).

const MarkInput = z.object({ id: z.string().min(1).max(64) });

export async function markNotificationRead(input: {
  id: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: MarkInput,
    invalid: REQUEST_REFUSALS.notificationGone,
    call: (ctx, { id }) => services().notifications.markRead(ctx, { id }),
    after: ({ changed }) => {
      if (changed) refresh();
    },
  }).then((result) => (result.ok ? { ok: true } : result));
}

export async function markAllNotificationsRead(): Promise<
  ActionResult<{ count: number }>
> {
  return serverAction(undefined, {
    input: z.undefined(),
    call: (ctx) => services().notifications.markAllRead(ctx),
    after: ({ count }) => {
      if (count > 0) refresh();
    },
  });
}
