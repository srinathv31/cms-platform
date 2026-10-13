import {
  describeNotification,
  type StoredNotificationLink,
} from "@/domain/notifications";
import { notificationHref } from "@/server/notification-href";
import { TEAM_SLUGS } from "@/server/seed/teams";

// Test support: a stored notification as the bell shows it to its recipient (decision 0055). A row stores facts
// and a link by team id; this words it (`describeNotification`, for the row's own user) and builds its href
// (`notificationHref`) with the seeded teams' slugs, so a test can check the sentence and the link a notification
// reads with from what it stores.

/** The parts of a stored notification the bell words and links. */
export interface StoredRow {
  userId: string;
  kind: string;
  facts: Record<string, unknown>;
  link: StoredNotificationLink;
  body: string | null;
}

/**
 * The row with the sentence (`title`), the second line (`body`: a person's own words, else the one the facts
 * word) and the `href` it shows. `slugs` maps a team id to its slug: the seed's teams, plus any a test made.
 */
export function asShown<T extends StoredRow>(
  row: T,
  slugs: Record<string, string> = TEAM_SLUGS,
): T & { title: string; href: string } {
  const words = describeNotification(row.kind, row.facts, row.userId);
  return {
    ...row,
    title: words.title,
    body: row.body ?? words.body,
    href: notificationHref(row.link, (id) => slugs[id] ?? null),
  };
}
