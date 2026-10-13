// The bell: the viewer's notifications, and marking them read. A notification is stored as its kind, its
// facts and a link descriptor, and worded when read (decision 0055).
//
// Typed for step 2b: they still run in src/server/actions/notifications.ts and
// src/server/queries/notifications.ts.

import type { NotificationsData } from "@/domain/access-types";
import type { ActionResult, RequestContext } from "./types";

export interface NotificationService {
  list(ctx: RequestContext): Promise<NotificationsData>;
  markRead(ctx: RequestContext, input: { id: string }): Promise<ActionResult>;
  markAllRead(ctx: RequestContext): Promise<ActionResult<{ count: number }>>;
}
