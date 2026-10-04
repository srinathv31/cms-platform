import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { recertifications, teams, templates, versions } from "@/server/db/schema/ucomp";
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
import type { Viewer } from "@/domain/types";
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
  /** Versions waiting on this viewer's decision. */
  reviewCount: number;
  recert: RecertCard | null;
}

export interface ShellData {
  viewer: { userId: string; name: string };
  spaces: SpaceNav[];
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
  if (spaces.length === 0) return { viewer: { userId: viewer.userId, name: viewer.name }, spaces: [] };

  const iconBySlug = new Map(teamRows.map((t) => [t.slug, t.icon]));

  // Review queue: in-review versions this viewer is allowed to decide (approver, not the submitter).
  const inReview = await db
    .select({ teamId: templates.teamId, submittedBy: versions.submittedBy })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(eq(versions.state, "in_review"));
  const reviewByTeam = new Map<string, number>();
  for (const row of inReview) {
    if (can(viewer, "version.decide", { teamId: row.teamId, submittedBy: row.submittedBy }).ok) {
      reviewByTeam.set(row.teamId, (reviewByTeam.get(row.teamId) ?? 0) + 1);
    }
  }
  const reviewTotal = [...reviewByTeam.values()].reduce((a, b) => a + b, 0);

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

  return {
    viewer: { userId: viewer.userId, name: viewer.name },
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
        reviewCount: isAll ? reviewTotal : (reviewByTeam.get(s.slug) ?? 0),
        recert: isAll ? null : (recertByTeam.get(s.slug) ?? null),
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
