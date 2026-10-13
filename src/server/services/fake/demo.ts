import { sortRoles } from "@/domain/access/roles";
import { advanceDaysRefusal, personaLanding } from "@/domain/demo";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import type { DemoService, PersonaFacts } from "../demo";
import type { IdentityService } from "../identity";
import type { FakeDeps } from "./index";
import { clockOffsetDays, putSetting } from "./settings";
import { seededState, type FakeState } from "./state";
import { runFakeScheduledJobs } from "./sweeps";

// The demo tools in memory: the twin of services/local/demo.ts. The fake has no demo flag of its own (it is always
// a demo), and its clock is the one the test sets, so moving the clock records the offset the readout shows and
// runs the scheduled jobs at the test's clock. The reset loads the seed again, built at that clock.

/** SQLite's default (BINARY) order, which the local implementation's ORDER BY uses. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The personas, in the order they were added (the seed's), with their active memberships that hold a role. */
function personasOf(state: FakeState): PersonaFacts[] {
  return state.users
    .filter((u) => u.isPersona)
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials,
      hue: u.avatarHue,
      platformRole: u.platformRole ?? null,
      teams: state.memberships
        .filter((m) => m.userId === u.id && m.status === "active")
        .flatMap((m) => {
          const team = state.teams.find((t) => t.id === m.teamId);
          return team ? [{ team, membershipId: m.id }] : [];
        })
        .sort(
          (a, b) =>
            byCodePoint(a.team.name, b.team.name) ||
            byCodePoint(a.team.id, b.team.id),
        )
        .map(({ team, membershipId }) => ({
          teamId: team.id,
          teamName: team.name,
          roles: sortRoles(
            state.membershipRoles
              .filter((r) => r.membershipId === membershipId)
              .map((r) => r.role),
          ),
        }))
        .filter((t) => t.roles.length > 0),
    }));
}

export function fakeDemo(
  deps: FakeDeps,
  identity: IdentityService,
): DemoService {
  const { store, clock } = deps;
  const { state } = store;
  return {
    async reset() {
      const fresh = seededState(await clock()).state;
      for (const table of Object.keys(fresh) as (keyof FakeState)[])
        (state[table] as unknown[]).splice(
          0,
          state[table].length,
          ...fresh[table],
        );
      return { ok: true };
    },

    async advanceClock(_ctx, { days }) {
      const invalid = advanceDaysRefusal(days);
      if (invalid) return refuse(invalid);
      const offsetDays = store.command((tx) => {
        const next = clockOffsetDays(tx.state) + days;
        putSetting(tx, "clock_offset_days", next);
        return next;
      });
      runFakeScheduledJobs(store, await clock());
      return { ok: true, offsetDays };
    },

    async clockReadout() {
      const asOf = await clock();
      return {
        ok: true,
        offsetDays: clockOffsetDays(state),
        asOf: asOf.toISOString(),
      };
    },

    async personas() {
      return { ok: true, personas: personasOf(state) };
    },

    async switchPersona(_ctx, { userId, slug }) {
      const persona = state.users.find((u) => u.id === userId && u.isPersona);
      if (!persona) return refuse(REQUEST_REFUSALS.invalidInput());
      const now = await clock();
      runFakeScheduledJobs(store, now);
      store.command((tx) => tx.update("users", persona, { lastActiveAt: now }));
      const viewer = await identity.viewer({ kind: "in_process", userId });
      if (!viewer) throw new Error(`Persona ${userId} isn't a user.`);
      const team = slug ? state.teams.find((t) => t.slug === slug) : undefined;
      return { ok: true, ...personaLanding(viewer, slug, team) };
    },
  };
}
