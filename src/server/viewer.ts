import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { membershipRoles, memberships, teams, users } from "./db/schema/ucomp";
import type { TeamRole, Viewer, ViewerMembership } from "@/domain/types";

// No real login: the persona switcher sets this cookie (build plan, "Personas").
export const PERSONA_COOKIE = "ucomp_persona";
export const DEFAULT_PERSONA = "maya";

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
    .where(eq(memberships.userId, userId));

  const roleRows = rows.length
    ? await db
        .select()
        .from(membershipRoles)
        .where(inArray(membershipRoles.membershipId, rows.map((r) => r.membershipId)))
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

/** The current persona. Per-request cached. Must be called inside a <Suspense> boundary. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const id = (await cookies()).get(PERSONA_COOKIE)?.value ?? DEFAULT_PERSONA;
  const viewer = (await loadViewer(id)) ?? (await loadViewer(DEFAULT_PERSONA));
  if (!viewer) throw new Error("Database is not seeded. Run `npm run db:reset`.");
  return viewer;
});

/** Switchable personas, in the order the switcher shows them. */
export const getPersonas = cache(async () =>
  db.query.users.findMany({ where: eq(users.isPersona, true) }),
);
