// Who a lifecycle notification reaches, and where its link opens for each person. Pure TypeScript: every
// implementation behind the service interfaces follows these rules over the facts it loads (the local one from
// the database in src/server/effects.ts, the fake from its arrays), so the two can't word them apart.

import type { NotificationLink, Recipients } from "./review-types";
import type { MembershipStatus, PlatformRole, TeamRole } from "./types";

/** One membership, as these rules read it. */
export interface RecipientMembership {
  userId: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  status: MembershipStatus;
  roles: readonly TeamRole[];
}

/** A person a notification may go to: their platform role and every membership they hold. */
export interface RecipientFacts {
  userId: string;
  platformRole: PlatformRole | null;
  memberships: readonly RecipientMembership[];
}

/**
 * The users a notification goes to: the one it names, or every active member holding the role on the
 * template's team, less `exceptUserIds`. Nobody is notified of their own action. Sorted, without repeats.
 * `teamMembers` are the template's team's memberships (only read for a `team_role`).
 */
export function notificationRecipients(
  to: Recipients,
  teamId: string,
  teamMembers: readonly RecipientMembership[],
  actorId: string | null,
): string[] {
  const named =
    to.kind === "user"
      ? [to.userId]
      : teamMembers
          .filter(
            (m) =>
              m.teamId === teamId &&
              m.status === "active" &&
              m.roles.includes(to.role) &&
              !(to.exceptUserIds ?? []).includes(m.userId),
          )
          .map((m) => m.userId);
  return [...new Set(named)]
    .filter((id) => id !== actorId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Whether a link can open somewhere other than the template's team for some recipient: a review link, or a
 * template link that names a version. Only then do the recipients' memberships need reading.
 */
export function linkMayMove(link: NotificationLink): boolean {
  return (
    link.to === "review" ||
    (link.to === "template" && link.reviewVersion !== undefined)
  );
}

/**
 * Where one recipient opens a notification's link: the template's team (`teamSlug`) when they can see it (an
 * active membership with a role there, or a platform role). A stage reviewer outside the team can't open the
 * workspace, so a review link opens in their own first space by name, and a template link that names a version
 * becomes that version's review there.
 */
export function recipientLink(
  recipient: RecipientFacts,
  teamSlug: string,
  link: NotificationLink,
): { teamSlug: string; link: NotificationLink } {
  if (!linkMayMove(link)) return { teamSlug, link };
  const own = ownSpace(recipient, teamSlug);
  if (own === null) return { teamSlug, link };
  return {
    teamSlug: own,
    link:
      link.to === "template" && link.reviewVersion !== undefined
        ? {
            to: "review",
            templateId: link.templateId,
            versionNumber: link.reviewVersion.number,
            round: link.reviewVersion.round,
          }
        : link,
  };
}

/** The recipient's own first space by name, or null when they can see the template's team. */
function ownSpace(recipient: RecipientFacts, teamSlug: string): string | null {
  if (recipient.platformRole) return null;
  const mine = recipient.memberships.filter(
    (m) => m.status === "active" && m.roles.length > 0,
  );
  if (mine.length === 0 || mine.some((m) => m.teamSlug === teamSlug))
    return null;
  return [...mine].sort((a, b) => a.teamName.localeCompare(b.teamName))[0]!
    .teamSlug;
}
