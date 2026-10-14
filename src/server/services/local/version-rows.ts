import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  decideResource as decideResourceOf,
  stageRefusal,
} from "@/domain/lifecycle/decide-check";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ReviewVersion } from "@/domain/lifecycle/types";
import type { EffectContext } from "@/domain/review-types";
import type { PermissionResource, Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import type { TestHooks } from "../options";
import { refuse } from "../refuse";
import { loadChain } from "./chain";
import { findRound } from "./find-round";
import type { Tx } from "./transaction";

// The version rows the review commands read and write (./review.ts): found outside the transaction to learn
// whom to check, read again inside it, and updated with a compare-and-set. The fake's twins are in
// ../fake/version-rows.ts.

/** The template, read only to learn its team and content type for the permission check. */
export async function findTemplate(templateId: string) {
  return db
    .select({
      id: templates.id,
      teamId: templates.teamId,
      contentTypeId: templates.contentTypeId,
    })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * The version's template and people, read only for the permission check: the round given, or without
 * one the number's head (`findRound`). The transaction reads it again (`loadVersion`).
 */
export async function findVersion(
  templateId: string,
  number: number,
  round?: number,
) {
  const [template, version] = await Promise.all([
    findTemplate(templateId),
    findRound(db, templateId, number, round),
  ]);
  if (!template || !version) return undefined;
  return {
    templateId: template.id,
    teamId: template.teamId,
    contentTypeId: template.contentTypeId,
    submittedBy: version.submittedBy,
    writers: version.writers,
    revoke: version.revoke,
    state: version.state,
    stages: version.stages,
    currentStage: version.currentStage,
  };
}

export type FoundVersion = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

/** The decide check's resource (`decideResource` in the domain), with the chain it reads the stage from. */
export async function decideResource(
  found: FoundVersion | undefined,
): Promise<PermissionResource> {
  if (!found) return { teamId: null };
  return decideResourceOf(
    found.teamId,
    found,
    await loadChain(db, found.contentTypeId),
  );
}

/** The version as the transitions read it (a whole row), fresh inside the transaction: as `findVersion` found it. */
export async function loadVersion(
  tx: Tx,
  found: FoundVersion,
  number: number,
  round?: number,
) {
  const row = await findRound(tx, found.templateId, number, round);
  if (!row) refuse(REQUEST_REFUSALS.versionGone);
  return row satisfies ReviewVersion;
}

/** The template's Active version: the whole row (its step down is a compare-and-set like any other write). */
export async function activeVersion(tx: Tx, templateId: string) {
  return tx.query.versions.findFirst({
    where: and(
      eq(versions.templateId, templateId),
      eq(versions.state, "active"),
    ),
  });
}

/** Refuses a viewer the stage the version waits on doesn't name now (`stageRefusal` in the domain). */
export function assertStage(
  viewer: Viewer,
  chain: Parameters<typeof stageRefusal>[1],
  version: ReviewVersion,
  teamId: string,
) {
  const refused = stageRefusal(viewer, chain, version, teamId);
  if (refused) refuse(refused);
}

/**
 * Compare-and-set: the update lands only if the row still has the state, rev and stage it was read with, and
 * a miss is refused `version_changed` rather than written over. SQLite serializes writes, so here a miss needs
 * a test's `hooks.beforeCompareAndSet` to change the row in between; a database that doesn't serialize writes
 * (the Java API's) reaches it when two people act at once.
 */
export async function updateVersion(
  tx: Tx,
  version: {
    id: string;
    state: ReviewVersion["state"];
    rev: number;
    currentStage: number;
  },
  set: Partial<typeof versions.$inferInsert>,
  at: Date,
  hooks: TestHooks,
) {
  if (
    hooks.beforeCompareAndSet?.({ table: "versions", id: version.id }) ===
    "competing_write"
  )
    await tx
      .update(versions)
      .set({ rev: sql`${versions.rev} + 1` })
      .where(eq(versions.id, version.id));
  const [saved] = await tx
    .update(versions)
    .set({ ...set, rev: sql`${versions.rev} + 1`, updatedAt: at })
    .where(
      and(
        eq(versions.id, version.id),
        eq(versions.state, version.state),
        eq(versions.rev, version.rev),
        eq(versions.currentStage, version.currentStage),
      ),
    )
    .returning({ id: versions.id });
  if (!saved) refuse(REQUEST_REFUSALS.versionChanged);
}

/** Who acted, on which template and version, and when: what `writeEffects` dates and addresses the effects with. */
export function effectContext(
  viewer: Viewer,
  found: { teamId: string; templateId: string },
  versionId: string,
  at: Date,
): EffectContext {
  return {
    at,
    actorId: viewer.userId,
    teamId: found.teamId,
    templateId: found.templateId,
    versionId,
  };
}
