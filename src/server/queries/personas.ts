import "server-only";
import { cache } from "react";
import { ROLE_LABEL } from "@/domain/access/roles";
import type { PlatformRole } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { PersonaFacts } from "@/server/services/demo";

// The persona switcher's rows: the demo service's personas (`demo.personas`, facts), each with its one-line role
// summary worded here. The profile menu reads the viewer's own row too, outside the demo.

export interface PersonaSummary {
  id: string;
  name: string;
  initials: string;
  hue: number;
  /** One line: "Coral Offers · Author", "Platform Admin", "No team yet". */
  summary: string;
}

const PLATFORM_LABEL: Record<PlatformRole, string> = {
  platform_admin: "Platform Admin",
  auditor: "Auditor",
};

/**
 * Each persona with its one-line summary: their platform role, then each team they're active on with its roles
 * from least to most authority ("Coral Offers · Approver & Team Admin"), or "No team yet". In the given order.
 */
export function personaSummaries(
  personas: readonly PersonaFacts[],
): PersonaSummary[] {
  return personas.map((p) => {
    const parts: string[] = [];
    if (p.platformRole) parts.push(PLATFORM_LABEL[p.platformRole]);
    for (const team of p.teams)
      parts.push(
        `${team.teamName} · ${team.roles.map((r) => ROLE_LABEL[r]).join(" & ")}`,
      );
    return {
      id: p.id,
      name: p.name,
      initials: p.initials,
      hue: p.hue,
      summary: parts.length ? parts.join(", ") : "No team yet",
    };
  });
}

/** All switchable personas with their one-line role summary. Order = the switcher's order. */
export const getPersonaSummaries = cache(
  async (): Promise<PersonaSummary[]> => {
    const ctx = await requireRequestContext();
    const result = await services().demo.personas(ctx);
    // A backend without the demo tools has no personas: the profile menu shows the viewer alone.
    return result.ok ? personaSummaries(result.personas) : [];
  },
);
