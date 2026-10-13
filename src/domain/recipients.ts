// Who a lifecycle notification reaches, and where its link opens for each person. Pure TypeScript: every
// implementation behind the service interfaces follows these rules over the facts it loads (the local one from
// the database in src/server/services/local/effects.ts, the fake from its arrays), so the two can't place them
// apart. A link is placed in a team by its id; the BFF builds its href from the team's slug when it reads it.

import type {
  NotificationLink,
  PlacedNotificationLink,
  Recipients,
} from "./review-types";
import type { MembershipStatus, PlatformRole, TeamRole } from "./types";

/** One membership, as these rules read it. */
export interface RecipientMembership {
  userId: string;
  teamId: string;
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
 * Where one recipient opens a notification's link, placed in a team by its id: the template's team (`teamId`)
 * when they can see it (an active membership with a role there, or a platform role). A stage reviewer outside
 * the team can't open the workspace, so a review link opens in their own first space by name, and a template
 * link that names a version becomes that version's review there. `recipient` is read only for a link that may
 * move (`linkMayMove`); null places it in the template's team.
 */
export function recipientLink(
  recipient: RecipientFacts | null,
  teamId: string,
  link: NotificationLink,
): PlacedNotificationLink {
  const own =
    recipient && linkMayMove(link) ? ownSpace(recipient, teamId) : null;
  if (own === null) return placed(link, teamId);
  if (link.to === "template" && link.reviewVersion !== undefined) {
    const { number, round } = link.reviewVersion;
    return placed(
      {
        to: "review",
        templateId: link.templateId,
        versionNumber: number,
        ...(round === undefined ? {} : { round }),
      },
      own,
    );
  }
  return placed(link, own);
}

/** A link placed in a team, as a row stores it: a template link's `reviewVersion` has done its work by then. */
function placed(
  link: NotificationLink,
  teamId: string,
): PlacedNotificationLink {
  switch (link.to) {
    case "review": {
      const { templateId, versionNumber, round } = link;
      return round === undefined
        ? { to: "review", teamId, templateId, versionNumber }
        : { to: "review", teamId, templateId, versionNumber, round };
    }
    case "template":
    case "versions":
      return { to: link.to, teamId, templateId: link.templateId };
  }
}

/** The id of the recipient's own first space by name, or null when they can see the template's team. */
function ownSpace(recipient: RecipientFacts, teamId: string): string | null {
  if (recipient.platformRole) return null;
  const mine = recipient.memberships.filter(
    (m) => m.status === "active" && m.roles.length > 0,
  );
  if (mine.length === 0 || mine.some((m) => m.teamId === teamId)) return null;
  return [...mine].sort((a, b) => a.teamName.localeCompare(b.teamName))[0]!
    .teamId;
}
