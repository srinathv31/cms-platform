import { REQUEST_REFUSALS } from "@/domain/refusals";
import { shellOf, spaceNamed } from "@/domain/spaces";
import type { TeamRole, Viewer } from "@/domain/types";
import type { IdentityService } from "../identity";
import { refusal } from "../results";
import type { FakeState } from "./state";

// Who is asking and where they may go, over the fake's arrays: the twin of services/local/identity.ts, deciding
// the spaces with the same domain functions.

/**
 * The user with their memberships (by team name, then id) and roles (by name), as the local implementation loads
 * them; null when there is no such user.
 */
export function viewerOf(state: FakeState, userId: string): Viewer | null {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  return {
    userId: user.id,
    name: user.name,
    initials: user.initials,
    title: user.title,
    platformRole: user.platformRole ?? null,
    memberships: state.memberships
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const team = state.teams.find((t) => t.id === m.teamId);
        if (!team) return [];
        return [
          {
            teamId: team.id,
            teamSlug: team.slug,
            teamName: team.name,
            status: m.status,
            roles: state.membershipRoles
              .filter((r) => r.membershipId === m.id)
              .map((r) => r.role as TeamRole)
              .sort(byCodePoint),
          },
        ];
      })
      .sort(
        (a, b) =>
          byCodePoint(a.teamName, b.teamName) ||
          byCodePoint(a.teamId, b.teamId),
      ),
  };
}

/** SQLite's default (BINARY) order, which the local implementation's ORDER BY uses. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function fakeIdentity(state: FakeState): IdentityService {
  return {
    async viewer(credential) {
      return viewerOf(state, credential.userId);
    },

    async space(ctx, { slug }) {
      const team = state.teams.find((t) => t.slug === slug);
      const space = spaceNamed(ctx.viewer, slug, team);
      return space
        ? { ok: true, space }
        : refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    },

    async shell(ctx) {
      return { ok: true, ...shellOf(ctx.viewer, state.teams) };
    },
  };
}
