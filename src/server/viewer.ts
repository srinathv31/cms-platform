import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { membershipRoles, memberships, teams, users } from "./db/schema/ucomp";
import type { TeamRole, Viewer, ViewerMembership } from "@/domain/types";
import { DEMO_MODE } from "./config";

// The sign-in stand-in. There is no real login yet: the persona switcher sets this cookie, and the request
// context (src/server/context/request.ts) asks `getViewer()` who it names. It fails closed: a missing or unknown
// cookie is nobody, signed out, unless the demo tools are on (DEMO_MODE, decision 0051), where it is Maya so a
// fresh browser lands somewhere (handoff review S2). Real sign-in replaces this file.
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
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.membershipId),
          ),
        )
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

/**
 * The person the persona cookie names, or null when nobody is signed in: no cookie, or one naming no user.
 * With the demo tools on, that is Maya instead. Per-request cached; read only by the request context.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const id = (await cookies()).get(PERSONA_COOKIE)?.value;
  const named = id ? await loadViewer(id) : null;
  if (named) return named;
  if (!DEMO_MODE) return null;
  const fallback = await loadViewer(DEFAULT_PERSONA);
  if (!fallback)
    throw new Error("Database is not seeded. Run `npm run db:reset`.");
  return fallback;
});

/** Switchable personas, in the order the switcher shows them. */
export const getPersonas = cache(async () =>
  db.query.users.findMany({ where: eq(users.isPersona, true) }),
);
