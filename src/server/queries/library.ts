import "server-only";
import { cache } from "react";
import { desc, eq } from "drizzle-orm";
import { sunsetDay } from "@/domain/business-zone";
import { getBusinessZone } from "@/server/business-zone";
import { db } from "@/server/db/client";
import { teams, templates, users, versions } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import { ALL_SPACE } from "@/domain/permissions";
import type { VersionState } from "@/domain/types";
import { formatAgo } from "@/domain/dates";

export interface LibraryRow {
  id: string;
  /** The latest version's name (`pickLatest`): the open draft's, otherwise the newest version's. */
  name: string;
  teamSlug: string;
  teamName: string;
  /** State of the template's latest version (a draft counts as latest). */
  status: VersionState;
  /** YYYY-MM-DD: the latest version's sunset day in the business time zone, for the badge. */
  sunsetDay: string | null;
  /** Number of the Active version, if any. */
  activeNumber: number | null;
  lastEdited: string;
  owner: { name: string; initials: string; hue: number };
}

/**
 * Latest = the open draft if there is one, otherwise the highest version number. The CMS shows a
 * template by this version's name (`currentName` in template-name.ts is the same pick in SQL).
 */
export function pickLatest<T extends { number: number | null; state: VersionState }>(
  list: T[],
): T | undefined {
  const draft = list.find((v) => v.state === "draft");
  if (draft) return draft;
  return list.reduce<T | undefined>(
    (best, v) => (best === undefined || (v.number ?? 0) > (best.number ?? 0) ? v : best),
    undefined,
  );
}

/** Templates in a space ("all" = every team), newest edit first. Caller has already passed requireSpace. */
export const getLibraryRows = cache(async (spaceSlug: string): Promise<LibraryRow[]> => {
  const nowDate = await demoNow();
  const zone = await getBusinessZone();

  const templateRows = await db
    .select({
      id: templates.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      ownerName: users.name,
      ownerInitials: users.initials,
      ownerHue: users.avatarHue,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(users, eq(users.id, templates.createdBy))
    .where(spaceSlug === ALL_SPACE ? undefined : eq(teams.slug, spaceSlug));

  if (templateRows.length === 0) return [];

  // Light columns only: never load `body` for a list.
  const versionRows = await db
    .select({
      templateId: versions.templateId,
      number: versions.number,
      state: versions.state,
      name: versions.name,
      sunsetAt: versions.sunsetAt,
      updatedAt: versions.updatedAt,
    })
    .from(versions)
    .orderBy(desc(versions.updatedAt));

  const byTemplate = new Map<string, typeof versionRows>();
  for (const v of versionRows) {
    const list = byTemplate.get(v.templateId);
    if (list) list.push(v);
    else byTemplate.set(v.templateId, [v]);
  }

  const rows = templateRows.map((t) => {
    const list = byTemplate.get(t.id) ?? [];
    const latest = pickLatest(list);
    const active = list.find((v) => v.state === "active");
    const edited = list.reduce<Date | null>(
      (max, v) => (max === null || v.updatedAt > max ? v.updatedAt : max),
      null,
    );
    return {
      row: {
        id: t.id,
        name: latest?.name ?? t.id,
        teamSlug: t.teamSlug,
        teamName: t.teamName,
        status: latest?.state ?? ("draft" as VersionState),
        sunsetDay: latest?.sunsetAt ? sunsetDay(latest.sunsetAt, zone) : null,
        activeNumber: active?.number ?? null,
        lastEdited: edited ? formatAgo(edited, nowDate) : "—",
        owner: { name: t.ownerName, initials: t.ownerInitials, hue: t.ownerHue },
      } satisfies LibraryRow,
      editedAt: edited?.getTime() ?? 0,
    };
  });

  return rows.sort((a, b) => b.editedAt - a.editedAt).map((r) => r.row);
});
