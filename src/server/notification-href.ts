import { ALL_SPACE } from "@/domain/permissions";
import type { StoredNotificationLink } from "@/domain/notifications";

// Where a notification opens, as an app URL. A stored link names its team by id (decision 0053); the BFF builds
// the href when it reads the notification (decision 0055), with the slug the viewer's spaces give that team, so a
// route or a slug can change without touching a row.

/**
 * The href of a stored link, under its team's slug (`slugOf`): `/{team}/review/{templateId}/{n}` (plus
 * `?round=N` when the link names its round), `/{team}/templates/{id}`, `/{team}/templates/{id}/versions`,
 * `/{team}/settings/{section}`, `/{team}/library`, `/request-access`, or a Platform settings section in All
 * teams. A team the viewer can't enter has no slug for them, and a link this code doesn't know has no route:
 * either opens the app's root, which lands in the viewer's own space.
 */
export function notificationHref(
  link: StoredNotificationLink,
  slugOf: (teamId: string) => string | null,
): string {
  switch (link.to) {
    case "request-access":
      return "/request-access";
    case "platform":
      return `/${ALL_SPACE}/settings/${link.section}`;
    case "review":
    case "template":
    case "versions":
    case "settings":
    case "library": {
      const slug = slugOf(link.teamId);
      return slug === null ? "/" : teamHref(link, slug);
    }
    default:
      return "/";
  }
}

function teamHref(
  link: Extract<StoredNotificationLink, { teamId: string }>,
  slug: string,
): string {
  switch (link.to) {
    case "review": {
      // A link names its round only when the round's label shows it (`reviewLink`); bare, it is the number's head.
      const path = `/${slug}/review/${link.templateId}/${link.versionNumber}`;
      return link.round === undefined ? path : `${path}?round=${link.round}`;
    }
    case "template":
      return `/${slug}/templates/${link.templateId}`;
    case "versions":
      return `/${slug}/templates/${link.templateId}/versions`;
    case "settings":
      return `/${slug}/settings/${link.section}`;
    case "library":
      return `/${slug}/library`;
  }
}
