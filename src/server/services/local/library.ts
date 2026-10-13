import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { libraryOf } from "@/domain/library";
import {
  paletteSearch,
  PALETTE_RECENT_SCAN,
  recentTemplateIds,
} from "@/domain/palette-search";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { db } from "@/server/db/client";
import {
  auditEvents,
  contentTypes,
  teams,
  templates,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { refusal } from "../results";
import type { TemplateService } from "../templates";
import { readBusinessZone } from "./business-zone";
import type { LocalDeps } from "./command";

// The Library and the ⌘K palette on this app's own database (src/server/services/templates.ts says what each
// read promises): the light rows of a space's templates and their versions (never a body), decided by the
// domain (`libraryOf`, `paletteSearch`) on the backend's clock.

/** A space's templates (a team by id; null, every team) with the team and, for the Library, the owner. */
function spaceTemplates(teamId: string | null) {
  return db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      teamSlug: teams.slug,
      teamName: teams.name,
      allowedChannels: contentTypes.allowedChannels,
      ownerId: users.id,
      ownerName: users.name,
      ownerInitials: users.initials,
      ownerHue: users.avatarHue,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
    .innerJoin(users, eq(users.id, templates.createdBy))
    .where(teamId === null ? undefined : eq(templates.teamId, teamId));
}

/** The light columns of the versions of a space's templates. */
function spaceVersions(teamId: string | null) {
  return db
    .select({
      templateId: versions.templateId,
      number: versions.number,
      round: versions.round,
      state: versions.state,
      name: versions.name,
      sunsetAt: versions.sunsetAt,
      updatedAt: versions.updatedAt,
    })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(teamId === null ? undefined : eq(templates.teamId, teamId));
}

export function localLibrary(
  deps: LocalDeps,
): Pick<TemplateService, "library" | "palette"> {
  return {
    async library(ctx, { teamId }) {
      const now = await deps.clock();
      const [templateRows, versionRows, zone] = await Promise.all([
        spaceTemplates(teamId),
        spaceVersions(teamId),
        readBusinessZone(db),
      ]);
      const library = libraryOf({
        viewer: ctx.viewer,
        teamId,
        templates: templateRows.map((t) => ({
          id: t.id,
          teamId: t.teamId,
          teamSlug: t.teamSlug,
          teamName: t.teamName,
          allowedChannels: t.allowedChannels,
          owner: {
            id: t.ownerId,
            name: t.ownerName,
            initials: t.ownerInitials,
            hue: t.ownerHue,
          },
        })),
        versions: versionRows,
        zone,
        now,
      });
      if (!library) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      return { ok: true, asOf: now.toISOString(), ...library };
    },

    async palette(ctx, { teamId, q, templateId }) {
      const [templateRows, versionRows, events] = await Promise.all([
        spaceTemplates(teamId),
        spaceVersions(teamId),
        // The viewer's newest audit rows that name a template; rows at one instant, the later write first.
        db
          .select({ templateId: auditEvents.templateId })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorId, ctx.viewer.userId),
              isNotNull(auditEvents.templateId),
            ),
          )
          .orderBy(desc(auditEvents.at), desc(sql`${auditEvents}.rowid`))
          .limit(PALETTE_RECENT_SCAN),
      ]);
      const palette = paletteSearch({
        viewer: ctx.viewer,
        teamId,
        templates: templateRows,
        versions: versionRows,
        recentIds: recentTemplateIds(events),
        q,
        currentId: templateId,
      });
      if (!palette) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      return { ok: true, ...palette };
    },
  };
}
