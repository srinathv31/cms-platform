import {
  DEFAULT_BUSINESS_ZONE,
  isBusinessZone,
  type BusinessZone,
} from "@/domain/business-zone";
import { compareRounds, isReleased } from "@/domain/rounds";
import type { TeamRole, Viewer } from "@/domain/types";
import type { FakeState, TemplateRow, VersionRow } from "./state";

// The lookups the fake's areas share, each the in-memory twin of a query the local implementation runs: the
// same rows, in the same order, so the two answer alike (the contract suite checks they do).

/** A setting's value, or undefined. */
export function setting(state: FakeState, key: string): unknown {
  return state.settings.find((s) => s.key === key)?.value;
}

/** The business time zone sunset dates are read in (`readBusinessZone`). */
export function businessZone(state: FakeState): BusinessZone {
  const value = setting(state, "business_zone");
  return isBusinessZone(value) ? value : DEFAULT_BUSINESS_ZONE;
}

export function templateById(
  state: FakeState,
  templateId: string,
): TemplateRow | undefined {
  return state.templates.find((t) => t.id === templateId);
}

/**
 * A version row by number and round (`findRound`): with a round, exactly that row; without one, the
 * number's head, its released row, else its latest round.
 */
export function findRound(
  state: FakeState,
  templateId: string,
  number: number,
  round?: number | null,
): VersionRow | undefined {
  return state.versions
    .filter(
      (v) =>
        v.templateId === templateId &&
        v.number === number &&
        (round == null || v.round === round),
    )
    .sort(
      (a, b) =>
        Number(isReleased(b.state)) - Number(isReleased(a.state)) ||
        (b.round ?? 0) - (a.round ?? 0),
    )[0];
}

/** The template's Active version. */
export function activeVersion(
  state: FakeState,
  templateId: string,
): VersionRow | undefined {
  return state.versions.find(
    (v) => v.templateId === templateId && v.state === "active",
  );
}

/** The name the CMS shows for a template (`currentName`): its open draft's, else its newest version's, else its id. */
export function currentName(state: FakeState, templateId: string): string {
  const rows = state.versions.filter((v) => v.templateId === templateId);
  const latest =
    rows.find((v) => v.state === "draft") ??
    rows.reduce<VersionRow | undefined>(
      (best, v) =>
        best === undefined || compareRounds(v, best) > 0 ? v : best,
      undefined,
    );
  return latest?.name ?? templateId;
}

/** The user with their memberships and roles, as `getViewer()` builds them; null when there is no such user. */
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
              .map((r) => r.role as TeamRole),
          },
        ];
      }),
  };
}
