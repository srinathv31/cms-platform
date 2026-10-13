import type { NotificationLink } from "@/domain/review-types";

// Where a notification links to, as an app URL under a team's slug. It builds the href from the link
// descriptor a transition gives (`NotificationLink`); no database, so every implementation behind the service
// interfaces uses the same one.

/**
 * `/{team}/review/{templateId}/{n}` (plus `?round=N` when the link names its round), `/{team}/templates/{id}`
 * or `/{team}/templates/{id}/versions`.
 */
export function notificationHref(
  teamSlug: string,
  link: NotificationLink,
): string {
  switch (link.to) {
    case "review": {
      // A link names its round only when the round's label shows it (`reviewLink`); bare, it is the number's head.
      const path = `/${teamSlug}/review/${link.templateId}/${link.versionNumber}`;
      return link.round === undefined ? path : `${path}?round=${link.round}`;
    }
    case "template":
      return `/${teamSlug}/templates/${link.templateId}`;
    case "versions":
      return `/${teamSlug}/templates/${link.templateId}/versions`;
  }
}
