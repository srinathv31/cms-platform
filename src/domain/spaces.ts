// Spaces as the backend answers them (the identity service, src/server/services/identity.ts): the space a URL's
// `[team]` slug names, and every space the viewer may switch to, each with what the viewer may do there. The URL
// names a team by its slug; this is where the slug becomes the team's id (decision 0053), and everything below
// takes the id. Both implementations of the service (the local one and the fake) decide with these functions.

import {
  ALL_SPACE,
  ALL_TEAMS_SPACE,
  can,
  canSeeSpace,
  spacesFor,
  type Space,
} from "./permissions";
import type { PermissionResult, Viewer } from "./types";

/** A team row, as a space needs it. */
export interface SpaceTeam {
  id: string;
  slug: string;
  name: string;
  /** Lucide icon key (`teams.icon`). */
  icon: string;
}

/** What the viewer may do in a space, decided. */
export interface SpaceActions {
  /** The Audit page (`audit.view`). */
  viewAudit: PermissionResult;
  /** The team's settings (`team.manageMembers`); refused in All teams. */
  manageMembers: PermissionResult;
  /** The platform's settings (`platform.manage`). */
  managePlatform: PermissionResult;
}

/** A space as facts: one team, or All teams (`teamId` null) for the platform roles. */
export interface SpaceFacts extends Space {
  /** The team's icon key; null for All teams. */
  icon: string | null;
  can: SpaceActions;
}

/** What the viewer may do in a space: a team by id, or All teams (null). */
export function spaceActions(
  viewer: Viewer,
  teamId: string | null,
): SpaceActions {
  return {
    viewAudit: can(viewer, "audit.view", { teamId }),
    manageMembers: can(viewer, "team.manageMembers", { teamId }),
    managePlatform: can(viewer, "platform.manage"),
  };
}

function facts(viewer: Viewer, space: Space, icon: string | null): SpaceFacts {
  return { ...space, icon, can: spaceActions(viewer, space.teamId) };
}

/**
 * The space a URL's `[team]` slug names, or null when there is none the viewer may enter: All teams for `all`,
 * else `team`, the team with that slug (undefined when no team has it). A team the viewer can't see and a slug
 * no team has both answer null, so the two read the same (decision 0052).
 */
export function spaceNamed(
  viewer: Viewer,
  slug: string,
  team: SpaceTeam | undefined,
): SpaceFacts | null {
  if (slug === ALL_SPACE)
    return canSeeSpace(viewer, null)
      ? facts(viewer, ALL_TEAMS_SPACE, null)
      : null;
  if (!team || team.slug !== slug || !canSeeSpace(viewer, team.id)) return null;
  return facts(
    viewer,
    { teamId: team.id, slug: team.slug, name: team.name, kind: "team" },
    team.icon,
  );
}

/** The app's frame for the viewer: the spaces they may switch to, and what they may do outside any space. */
export interface ShellFacts {
  /** Every space the viewer may switch to (`spacesFor`), with what they may do in each. */
  spaces: SpaceFacts[];
  can: {
    /** Asking a Team Admin for a role (`access.request`); refused to the Auditor, who holds none. */
    requestAccess: PermissionResult;
  };
}

/** The viewer's shell, from every team there is. */
export function shellOf(
  viewer: Viewer,
  teams: readonly SpaceTeam[],
): ShellFacts {
  const iconOf = new Map(teams.map((t) => [t.id, t.icon]));
  return {
    spaces: spacesFor(viewer, teams).map((space) =>
      facts(
        viewer,
        space,
        space.teamId === null ? null : (iconOf.get(space.teamId) ?? null),
      ),
    ),
    can: { requestAccess: can(viewer, "access.request") },
  };
}
