import "server-only";
import { cache } from "react";
import { formatAgo } from "@/domain/dates";
import {
  describeNotification,
  isNotificationKind,
} from "@/domain/notifications";
import { requireRequestContext } from "@/server/context/request";
import { notificationHref } from "@/server/notification-href";
import type {
  NotificationView,
  NotificationsData,
} from "@/server/queries/access-models";
import { services } from "@/server/services";
import type { NotificationList } from "@/server/services/notifications";
import { getShellFacts } from "./spaces";

// The bell. A notification is stored as facts and a link descriptor (decision 0055): the service lists the
// viewer's (`services().notifications.list`), and this read model words each one for the viewer
// (`describeNotification`), builds its href from its link with the slugs of the viewer's spaces (the identity
// service's shell), and says how long ago it came from the list's `asOf`. It decides nothing and reads no clock.

/** The bell holds this many, newest first. */
export const NOTIFICATIONS_LIMIT = 30;

/** The viewer's latest notifications (newest first) and how many are unread in all. */
export const getNotificationsData = cache(
  async (): Promise<NotificationsData> => {
    const ctx = await requireRequestContext();
    const [list, shell] = await Promise.all([
      services().notifications.list(ctx, { limit: NOTIFICATIONS_LIMIT }),
      getShellFacts(),
    ]);
    if (!list.ok)
      throw new Error(
        `The notifications refused a signed-in viewer: ${list.code}`,
      );
    return notificationsData(list, shell.spaces, ctx.viewer.userId);
  },
);

/**
 * The bell's rows from the stored notifications, for `readerId`: each worded (a person's own words stay its
 * body), linked under the slug of the space its link names (`spaces`: the viewer's, by team id; a team they
 * can't enter links to the app's root), and dated relative to the list's `asOf`. Pure.
 */
export function notificationsData(
  list: NotificationList,
  spaces: readonly { teamId: string | null; slug: string }[],
  readerId: string,
): NotificationsData {
  const slugs = new Map(
    spaces.flatMap((s): [string, string][] =>
      s.teamId === null ? [] : [[s.teamId, s.slug]],
    ),
  );
  const slugOf = (teamId: string) => slugs.get(teamId) ?? null;
  return {
    items: list.items.map((n): NotificationView => {
      const words = describeNotification(n.kind, n.facts, readerId);
      return {
        id: n.id,
        kind: isNotificationKind(n.kind) ? n.kind : null,
        title: words.title,
        body: n.body ?? words.body,
        href: notificationHref(n.link, slugOf),
        createdAt: n.createdAt,
        ago: formatAgo(n.createdAt, list.asOf, { capitalize: true }),
        unread: n.readAt === null,
      };
    }),
    unreadCount: list.unreadCount,
  };
}
