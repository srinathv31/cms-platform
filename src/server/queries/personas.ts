import "server-only";
import { cache } from "react";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { membershipRoles, memberships, teams } from "@/server/db/schema/ucomp";
import { getPersonas } from "@/server/viewer";
import type { PlatformRole, TeamRole } from "@/domain/types";

export interface PersonaSummary {
  id: string;
  name: string;
  initials: string;
  hue: number;
  /** One line: "Coral Offers · Author", "Platform Admin", "No team yet". */
  summary: string;
}

const ROLE_LABEL: Record<TeamRole, string> = {
  viewer: "Viewer",
  author: "Author",
  approver: "Approver",
  team_admin: "Team Admin",
};

const PLATFORM_LABEL: Record<PlatformRole, string> = {
  platform_admin: "Platform Admin",
  auditor: "Auditor",
};

/** The role order inside a team reads from least to most authority. */
const ROLE_ORDER: TeamRole[] = ["viewer", "author", "approver", "team_admin"];

/** All switchable personas with their one-line role summary. Order = the switcher's order. */
export const getPersonaSummaries = cache(async (): Promise<PersonaSummary[]> => {
  const personas = await getPersonas();
  const ids = personas.map((p) => p.id);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      teamName: teams.name,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(inArray(memberships.userId, ids));

  const roleRows = rows.length
    ? await db
        .select()
        .from(membershipRoles)
        .where(inArray(membershipRoles.membershipId, rows.map((r) => r.membershipId)))
    : [];

  return personas.map((p) => {
    const parts: string[] = [];
    if (p.platformRole) parts.push(PLATFORM_LABEL[p.platformRole]);
    for (const m of rows.filter((r) => r.userId === p.id && r.status === "active")) {
      const roles = roleRows
        .filter((rr) => rr.membershipId === m.membershipId)
        .map((rr) => rr.role as TeamRole)
        .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
      if (roles.length === 0) continue;
      parts.push(`${m.teamName} · ${roles.map((r) => ROLE_LABEL[r]).join(" & ")}`);
    }
    return {
      id: p.id,
      name: p.name,
      initials: p.initials,
      hue: p.avatarHue,
      summary: parts.length ? parts.join(", ") : "No team yet",
    };
  });
});
