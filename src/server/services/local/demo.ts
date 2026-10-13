import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { sortRoles } from "@/domain/access/roles";
import {
  advanceDaysRefusal,
  demoToolsRefusal,
  personaLanding,
} from "@/domain/demo";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import type { TeamRole } from "@/domain/types";
import { advanceClock, getClockOffsetDays } from "@/server/clock";
import { DEMO_MODE } from "@/server/config";
import { db } from "@/server/db/client";
import {
  membershipRoles,
  memberships,
  teams,
  users,
} from "@/server/db/schema/ucomp";
import { resetDemo } from "@/server/reset";
import type { DemoService, PersonaFacts } from "../demo";
import type { IdentityService } from "../identity";
import type { LocalDeps } from "./command";
import { runScheduledJobs } from "./sweeps";

// The demo tools on this app's own database (src/server/services/demo.ts says what each promises). The demo clock is
// this implementation's own clock (src/server/clock.ts: the real time plus `settings.clock_offset_days`), and the
// reset is its own machinery (src/server/reset.ts). Each command checks the demo flag first: the BFF has, but the
// flag is this backend's configuration too.

/** The personas, in the order they were added (the seed's), with their active memberships that hold a role. */
async function loadPersonas(): Promise<PersonaFacts[]> {
  const people = await db.query.users.findMany({
    where: eq(users.isPersona, true),
  });
  if (people.length === 0) return [];
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(
      and(
        inArray(
          memberships.userId,
          people.map((p) => p.id),
        ),
        eq(memberships.status, "active"),
      ),
    )
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
    : [];
  const rolesOf = (membershipId: string) =>
    sortRoles(
      roleRows
        .filter((rr) => rr.membershipId === membershipId)
        .map((rr) => rr.role as TeamRole),
    );
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    initials: p.initials,
    hue: p.avatarHue,
    platformRole: p.platformRole ?? null,
    teams: rows
      .filter((r) => r.userId === p.id)
      .map((r) => ({
        teamId: r.teamId,
        teamName: r.teamName,
        roles: rolesOf(r.membershipId),
      }))
      .filter((t) => t.roles.length > 0),
  }));
}

export function localDemo(
  deps: LocalDeps,
  identity: IdentityService,
): DemoService {
  return {
    async reset() {
      const off = demoToolsRefusal(DEMO_MODE);
      if (off) return off;
      const reset = await resetDemo();
      return reset.ok ? { ok: true } : reset;
    },

    async advanceClock(_ctx, { days }) {
      const off = demoToolsRefusal(DEMO_MODE);
      if (off) return off;
      const invalid = advanceDaysRefusal(days);
      if (invalid) return refuse(invalid);
      const offsetDays = await advanceClock(days);
      // The clock it moved to: the demo clock reads the new offset.
      await runScheduledJobs(await deps.clock());
      return { ok: true, offsetDays };
    },

    async clockReadout() {
      const asOf = await deps.clock();
      return {
        ok: true,
        offsetDays: await getClockOffsetDays(),
        asOf: asOf.toISOString(),
      };
    },

    async personas() {
      return { ok: true, personas: await loadPersonas() };
    },

    async switchPersona(_ctx, { userId, slug }) {
      const off = demoToolsRefusal(DEMO_MODE);
      if (off) return off;
      const persona = await db.query.users.findFirst({
        where: and(eq(users.id, userId), eq(users.isPersona, true)),
      });
      if (!persona) return refuse(REQUEST_REFUSALS.invalidInput());
      // The sweeps first: a member past a deadline lost access before signing in. Then the sign-in.
      const now = await deps.clock();
      await runScheduledJobs(now);
      await db
        .update(users)
        .set({ lastActiveAt: now })
        .where(eq(users.id, userId));
      const viewer = await identity.viewer({ kind: "in_process", userId });
      if (!viewer) throw new Error(`Persona ${userId} isn't a user.`);
      const [team] = slug
        ? await db
            .select({
              id: teams.id,
              slug: teams.slug,
              name: teams.name,
              icon: teams.icon,
            })
            .from(teams)
            .where(eq(teams.slug, slug))
            .limit(1)
        : [];
      return { ok: true, ...personaLanding(viewer, slug, team) };
    },
  };
}
