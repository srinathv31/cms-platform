import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { recertifications, teams } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import { getViewer } from "@/server/viewer";
import {
  ALL_SPACE,
  can,
  canSeeSpace,
  defaultSpace,
  spacesFor,
  type Space,
} from "@/domain/permissions";
import type { SidebarCardModel } from "@/domain/access-types";
import type { Viewer } from "@/domain/types";
import { getHomeCard, getSidebarCards } from "./access";
import { shortDate } from "./format";

// ── Settings access (which groups of the settings modal this viewer may use) ──

export interface SettingsAccess {
  team: boolean;
  platform: boolean;
}

export function settingsAccessFor(viewer: Viewer, teamSlug: string): SettingsAccess {
  const teamId = teamSlug === ALL_SPACE ? null : teamSlug;
  return {
    team: teamId ? can(viewer, "team.manageMembers", { teamId }).ok : false,
    platform: can(viewer, "platform.manage").ok,
  };
}

// ── One entry per space the viewer can switch to ──

export interface RecertCard {
  id: string;
  label: string;
  dueLabel: string;
}

export interface SpaceNav {
  slug: string;
  name: string;
  kind: Space["kind"];
  /** Lucide icon key (teams.icon). */
  icon: string;
  showAudit: boolean;
  settings: SettingsAccess;
  /** Superseded by `card` (kept until the sidebar switches). */
  recert: RecertCard | null;
  /** The one dismissible sidebar card for this space (access requests, then recertification). */
  card: SidebarCardModel | null;
}

export interface ShellData {
  viewer: { userId: string; name: string };
  spaces: SpaceNav[];
  /** The card for a viewer with no space yet (their pending request, on /request-access). */
  homeCard: SidebarCardModel | null;
}

/** Everything the sidebar needs, for every space at once, so a team switch never refetches. */
export const getShell = cache(async (): Promise<ShellData> => {
  const viewer = await getViewer();
  const teamRows = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name, icon: teams.icon })
    .from(teams)
    .orderBy(teams.name);
  // Platform Admin and Auditor get "All teams" first, then every team to step into.
  const spaces = spacesFor(viewer, teamRows);
  if (spaces.length === 0) {
    return { viewer: { userId: viewer.userId, name: viewer.name }, spaces: [], homeCard: await getHomeCard() };
  }

  const iconBySlug = new Map(teamRows.map((t) => [t.slug, t.icon]));

  // Open recertification (Team Admins only).
  const nowDate = await demoNow();
  const openRecerts = await db
    .select()
    .from(recertifications)
    .where(isNull(recertifications.completedAt));
  const recertByTeam = new Map<string, RecertCard>();
  for (const r of openRecerts) {
    if (r.startsAt.getTime() > nowDate.getTime()) continue;
    if (!can(viewer, "team.manageMembers", { teamId: r.teamId }).ok) continue;
    const existing = recertByTeam.get(r.teamId);
    if (existing) continue;
    recertByTeam.set(r.teamId, { id: r.id, label: r.label, dueLabel: shortDate(r.dueAt) });
  }

  const cards = await getSidebarCards();

  return {
    viewer: { userId: viewer.userId, name: viewer.name },
    homeCard: null,
    spaces: spaces.map((s): SpaceNav => {
      const isAll = s.slug === ALL_SPACE;
      const teamId = isAll ? undefined : s.slug;
      return {
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        icon: isAll ? "layers" : (iconBySlug.get(s.slug) ?? "users"),
        showAudit: can(viewer, "audit.view", { teamId }).ok,
        settings: settingsAccessFor(viewer, s.slug),
        recert: isAll ? null : (recertByTeam.get(s.slug) ?? null),
        card: cards[s.slug] ?? null,
      };
    }),
  };
});

// ── Route guard ──

export interface SpaceContext {
  viewer: Viewer;
  slug: string;
  isAll: boolean;
  /** The team id (same as the slug) or null in the cross-team space. */
  teamId: string | null;
  name: string;
}

/**
 * Resolves the `[team]` segment for the current viewer.
 * Unknown slug → 404. A real team the viewer can't see → their default space (or request-access).
 */
export const requireSpace = cache(async (slug: string): Promise<SpaceContext> => {
  const viewer = await getViewer();
  const isAll = slug === ALL_SPACE;
  const team = isAll
    ? null
    : ((await db.query.teams.findFirst({ where: eq(teams.slug, slug) })) ?? null);
  if (!isAll && !team) notFound();

  if (!canSeeSpace(viewer, slug)) {
    const fallback = defaultSpace(viewer);
    redirect(fallback ? `/${fallback}/library` : "/request-access");
  }
  return {
    viewer,
    slug,
    isAll,
    teamId: team ? team.id : null,
    name: isAll ? "All teams" : team!.name,
  };
});

/** Resolve a params promise to a space (for streamed server components). */
export async function requireSpaceFromParams(
  params: Promise<{ team: string }>,
): Promise<SpaceContext> {
  const { team } = await params;
  return requireSpace(team);
}
