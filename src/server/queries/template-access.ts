import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { currentStageOf, stageApproverIds } from "@/domain/approval-chain";
import { can, canSeeSpace } from "@/domain/permissions";
import { roundsOf } from "@/domain/rounds";
import type { Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  approvals,
  teams,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { loadChain } from "@/server/services/local/chain";
import { findRound } from "@/server/services/local/find-round";
import { currentName } from "@/server/services/local/template-name";
import { requireSpace, type SpaceContext } from "./spaces";

// Which template (and which round of it) a page may show from a space: the gates the workspace, the review screen
// and the template's tabs pass before they read anything else. Not found for what doesn't exist and, the same way,
// for what the viewer may not see (decision 0052). They still read the database and decide here; the reads that
// use them move behind the seam with their screens (plan P4a), and these go with the last of them.

export interface TemplateAccess {
  space: SpaceContext;
  /** `name` is the CMS's name for the template (`currentName`): its open draft's, otherwise its newest version's. */
  template: {
    id: string;
    name: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
    contentTypeId: string;
  };
}

/**
 * The template, as seen from a space: 404 when it doesn't exist, belongs to another team's space, or
 * sits on a team the viewer can't see (the same rule as the workspace header).
 */
export const requireTemplate = cache(
  async (spaceSlug: string, templateId: string): Promise<TemplateAccess> => {
    const space = await requireSpace(spaceSlug);
    const template = await findTemplate(templateId);
    if (!template || !seesInSpace(space, template)) notFound();
    return { space, template };
  },
);

function findTemplate(templateId: string) {
  return db
    .select({
      id: templates.id,
      name: currentName(templates.id),
      teamId: templates.teamId,
      teamSlug: teams.slug,
      teamName: teams.name,
      contentTypeId: templates.contentTypeId,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
}

/** The template belongs to the space (or the space is "All teams"), and the viewer sees its team. */
function seesInSpace(
  space: SpaceContext,
  template: { teamId: string },
): boolean {
  if (space.teamId !== null && template.teamId !== space.teamId) return false;
  return canSeeSpace(space.viewer, template.teamId);
}

export type ReviewVersionRow = typeof versions.$inferSelect;

/**
 * The review screen's template and version: the round asked for (`?round=`), or without one the number's
 * head, its released row or else its latest round (`findRound`). As `requireTemplate`, plus one way in
 * from outside the template's team (Phase 6, a stage that names a person): someone named on the stage a
 * version waits on opens it from their own space, in any team, and keeps seeing it once they decided it.
 * Any other version of that template stays a 404 for them. A round that doesn't exist is a 404.
 *
 * A bare link stored before a send-back (the notification that asked them, a comment's link) names no
 * round. Once the next round is in review at a stage that doesn't name them, the head is closed to them,
 * so for them the bare link opens the newest round of the number they may open (`roundsOf`), the one
 * they decided. The template's own team always gets the head.
 */
export const requireReviewVersion = cache(
  async (
    spaceSlug: string,
    templateId: string,
    versionNumber: number,
    round: number | null = null,
  ): Promise<TemplateAccess & { version: ReviewVersionRow }> => {
    const space = await requireSpace(spaceSlug);
    const template = await findTemplate(templateId);
    if (!template || !Number.isInteger(versionNumber) || versionNumber < 1)
      notFound();
    if (round !== null && (!Number.isInteger(round) || round < 1)) notFound();
    const version = await findRound(db, template.id, versionNumber, round);
    if (!version || version.number === null) notFound();
    if (seesInSpace(space, template)) return { space, template, version };
    if (await namedOnVersion(space.viewer, template, version))
      return { space, template, version };
    if (round === null) {
      const rows = await db
        .select()
        .from(versions)
        .where(
          and(
            eq(versions.templateId, template.id),
            eq(versions.number, versionNumber),
          ),
        );
      for (const earlier of roundsOf(rows, versionNumber)) {
        if (earlier.id === version.id) continue;
        if (await namedOnVersion(space.viewer, template, earlier))
          return { space, template, version: earlier };
      }
    }
    notFound();
  },
);

/**
 * Whether the viewer may open this round's review screen from the space, by the rule
 * `requireReviewVersion` lets them in by: the template's team in its space, or someone the round's stage
 * names or who decided it. A screen links to another round only when this holds, so it never links to a 404.
 */
export async function opensRound(
  access: TemplateAccess,
  versionId: string,
): Promise<boolean> {
  const { space, template } = access;
  if (seesInSpace(space, template)) return true;
  const version = await db.query.versions.findFirst({
    where: eq(versions.id, versionId),
  });
  return (
    version !== undefined && namedOnVersion(space.viewer, template, version)
  );
}

async function namedOnVersion(
  viewer: Viewer,
  template: { teamId: string; contentTypeId: string },
  version: ReviewVersionRow,
): Promise<boolean> {
  if (version.state === "in_review") {
    const stage = currentStageOf(
      version,
      await loadChain(db, template.contentTypeId),
    );
    if (
      can(viewer, "template.view", {
        teamId: template.teamId,
        stageApproverIds: stageApproverIds(stage),
      }).ok
    )
      return true;
  }
  const decided = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.versionId, version.id),
        eq(approvals.actorId, viewer.userId),
      ),
    )
    .limit(1);
  return decided.length > 0;
}
