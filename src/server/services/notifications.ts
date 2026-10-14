// The bell: the viewer's notifications, and marking them read. A notification is stored as its kind, the kind's
// facts (names as they were) and a link descriptor that names its team by id (decision 0055). The BFF words it
// (`describeNotification` in src/domain/notifications.ts) and builds its href from the link and the viewer's
// spaces when it reads it, so nothing here is English or an app URL but a person's own words (`body`).

import type { StoredNotificationLink } from "@/domain/notifications";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
} from "./types";

export type { StoredNotificationLink } from "@/domain/notifications";

/** One notification, as stored. */
export interface StoredNotification {
  id: string;
  /**
   * One of the notification kinds (`AnyNotificationKind`). The BFF words a kind it doesn't know yet as a generic
   * sentence, so the backend can add one first.
   */
  kind: string;
  /** The kind's facts (`NotificationFacts`, `AccessNotificationFacts` in src/domain), names as they were. */
  facts: Record<string, unknown>;
  /** Where it opens, placed for this recipient: ids only. */
  link: StoredNotificationLink;
  /** A person's own words (a submit note, a reason, a comment, an admin's note), or null. */
  body: string | null;
  /** ISO. */
  createdAt: string;
  /** ISO; null while unread. */
  readAt: string | null;
}

/** The viewer's latest notifications, and how many are unread. */
export interface NotificationList {
  /** ISO: the backend's instant it read them at. The BFF words "5 minutes ago" from it. */
  asOf: string;
  /** Newest first (by when they were created, then the order they were written), at most `limit`. */
  items: StoredNotification[];
  /** Every unread notification the viewer has, not only those listed. */
  unreadCount: number;
}

export interface NotificationService {
  /** The viewer's own notifications, at most `limit` (1 to 100) of them. */
  list(
    ctx: RequestContext,
    input: { limit: number },
  ): Promise<ReadResult<NotificationList>>;

  /**
   * Marks one of the viewer's notifications read, dated by the backend's clock. Refuses `notification_gone` for
   * one that doesn't exist and for someone else's: the two read the same, so an id is never confirmed. One
   * already read (a double click, two tabs) is `ok` with `changed` false, and keeps its first read time.
   */
  markRead(
    ctx: RequestContext,
    input: { id: string },
  ): Promise<ActionResult<Changed>>;

  /** Marks every unread notification of the viewer's read; `count` is how many it marked (0: nothing changed). */
  markAllRead(ctx: RequestContext): Promise<ActionResult<{ count: number }>>;
}
