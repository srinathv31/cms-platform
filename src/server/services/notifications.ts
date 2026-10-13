// The bell: the viewer's notifications, and marking them read. A notification is stored as its kind, its
// facts and a link descriptor, and the BFF words it and builds its href when it reads it (decision 0055).
//
// Typed for step 2b: they still run in src/server/actions/notifications.ts and
// src/server/queries/notifications.ts.

import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

export interface NotificationService {
  list(
    ctx: RequestContext,
  ): Promise<ReadResult<Unsettled<"2b-0: notifications as facts (B2)">>>;
  markRead(ctx: RequestContext, input: { id: string }): Promise<ActionResult>;
  markAllRead(ctx: RequestContext): Promise<ActionResult<{ count: number }>>;
}
