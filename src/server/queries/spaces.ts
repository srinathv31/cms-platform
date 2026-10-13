import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { SidebarCardModel } from "@/domain/access-types";
import type { PermissionResult, Viewer } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { SpaceFacts } from "@/server/services/identity";
import { getHomeCard, getSidebarCards } from "./access";

// The spaces read models: the `[team]` segment resolved to its team, once, at the edge (`requireSpace`), and
// the sidebar's list of spaces (`getShell`). The identity service resolves and decides (decision 0053: the
// slug becomes the team's id here, and everything below takes the id); these lay its facts out for the screens.

// ── Settings access (which groups of the settings modal this viewer may use) ──

export interface SettingsAccess {
  team: boolean;
  platform: boolean;
}

function settingsAccess(space: SpaceFacts): SettingsAccess {
  return {
    team: space.can.manageMembers.ok,
    platform: space.can.managePlatform.ok,
  };
}

// ── One entry per space the viewer can switch to ──

export interface SpaceNav {
  /** The team's id; null for All teams. */
  teamId: string | null;
  /** Its name in the URL. */
  slug: string;
  name: string;
  kind: SpaceFacts["kind"];
  /** Lucide icon key (teams.icon). */
  icon: string;
  showAudit: boolean;
  settings: SettingsAccess;
  /** The one dismissible sidebar card for this space (access requests, then recertification). */
  card: SidebarCardModel | null;
}

export interface ShellData {
  viewer: { userId: string; name: string };
  spaces: SpaceNav[];
  /** The card for a viewer with no space yet (their pending request, on /request-access). */
  homeCard: SidebarCardModel | null;
  /** Whether the viewer may ask for a role on a team (the Auditor may not). */
  canRequestAccess: PermissionResult;
}

/** Everything the sidebar needs, for every space at once, so a team switch never refetches. */
export const getShell = cache(async (): Promise<ShellData> => {
  const ctx = await requireRequestContext();
  const shell = await services().identity.shell(ctx);
  if (!shell.ok)
    throw new Error(`The shell refused a signed-in viewer: ${shell.code}`);
  const base = {
    viewer: { userId: ctx.viewer.userId, name: ctx.viewer.name },
    canRequestAccess: shell.can.requestAccess,
  };
  if (shell.spaces.length === 0)
    return { ...base, spaces: [], homeCard: await getHomeCard() };

  const cards = await getSidebarCards();
  return {
    ...base,
    homeCard: null,
    spaces: shell.spaces.map((space): SpaceNav => ({
      teamId: space.teamId,
      slug: space.slug,
      name: space.name,
      kind: space.kind,
      icon: space.icon ?? (space.teamId === null ? "layers" : "users"),
      showAudit: space.can.viewAudit.ok,
      settings: settingsAccess(space),
      card: space.teamId === null ? null : (cards[space.teamId] ?? null),
    })),
  };
});

// ── Route guard ──

export interface SpaceContext {
  viewer: Viewer;
  /** The `[team]` segment: the space's name in the URL, for links. */
  slug: string;
  isAll: boolean;
  /** The team's id, which every check and query takes; null in the cross-team space. */
  teamId: string | null;
  name: string;
  /** Which groups of the settings modal the viewer may use here. */
  settings: SettingsAccess;
}

/**
 * Resolves the `[team]` segment for the current viewer, once per render (`identity.space`). Not found for an
 * unknown slug, and the same page for a team (or "All teams") the viewer can't see.
 */
export const requireSpace = cache(
  async (slug: string): Promise<SpaceContext> => {
    const ctx = await requireRequestContext();
    const found = await services().identity.space(ctx, { slug });
    if (!found.ok) notFound();
    const { space } = found;
    return {
      viewer: ctx.viewer,
      slug: space.slug,
      isAll: space.teamId === null,
      teamId: space.teamId,
      name: space.name,
      settings: settingsAccess(space),
    };
  },
);

/** Resolve a params promise to a space (for streamed server components). */
export async function requireSpaceFromParams(
  params: Promise<{ team: string }>,
): Promise<SpaceContext> {
  const { team } = await params;
  return requireSpace(team);
}
