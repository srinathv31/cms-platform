import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { shellOf, spaceNamed } from "@/domain/spaces";
import type { TeamRole, Viewer, ViewerMembership } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  membershipRoles,
  memberships,
  teams,
  users,
} from "@/server/db/schema/ucomp";
import type { IdentityService } from "../identity";
import { refusal } from "../results";

// Who is asking and where they may go, on this app's own database (src/server/services/identity.ts says what
// each method promises). The local implementation trusts the credential it is handed (`in_process`: this
// process's own sign-in stand-in found the user id); the spaces are decided by the domain (src/domain/spaces.ts).

/**
 * The user with their memberships (by team name, then id) and each one's team and roles (by name); null when
 * there is no such user.
 */
async function loadViewer(userId: string): Promise<Viewer | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;

  const rows = await db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(teams.name), asc(teams.id));

  const roleRows = rows.length
    ? await db
        .select()
        .from(membershipRoles)
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.membershipId),
          ),
        )
        .orderBy(asc(membershipRoles.role))
    : [];

  const list: ViewerMembership[] = rows.map((r) => ({
    teamId: r.teamId,
    teamSlug: r.teamSlug,
    teamName: r.teamName,
    status: r.status,
    roles: roleRows
      .filter((rr) => rr.membershipId === r.membershipId)
      .map((rr) => rr.role as TeamRole),
  }));

  return {
    userId: user.id,
    name: user.name,
    initials: user.initials,
    title: user.title,
    platformRole: user.platformRole ?? null,
    memberships: list,
  };
}

const teamColumns = {
  id: teams.id,
  slug: teams.slug,
  name: teams.name,
  icon: teams.icon,
};

export function localIdentity(): IdentityService {
  return {
    viewer: (credential) => loadViewer(credential.userId),

    async space(ctx, { slug }) {
      const [team] = await db
        .select(teamColumns)
        .from(teams)
        .where(eq(teams.slug, slug))
        .limit(1);
      const space = spaceNamed(ctx.viewer, slug, team);
      return space
        ? { ok: true, space }
        : refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    },

    async shell(ctx) {
      // `shellOf` orders the spaces (by name), so the query needn't.
      const rows = await db.select(teamColumns).from(teams);
      return { ok: true, ...shellOf(ctx.viewer, rows) };
    },
  };
}
