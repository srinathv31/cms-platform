import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { canActOnStage, currentStageOf } from "@/domain/approval-chain";
import { REQUEST_REFUSALS, type Refusal } from "@/domain/refusals";
import type { ApprovalStage } from "@/domain/review-types";
import type { ReviewVersion } from "@/domain/lifecycle/types";
import type { PermissionResource, Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import { templates, versions } from "@/server/db/schema/ucomp";
import type { EffectContext } from "@/domain/review-types";
import type { Tx } from "@/server/services/local/transaction";
import { findRound } from "@/server/services/local/find-round";
import { loadChain } from "@/server/services/local/chain";
import { stageApproverIds } from "@/domain/approval-chain";
import { refuse } from "@/server/services/refuse";
import type { TestHooks } from "@/server/services/options";

// The version rows the review commands read and write: found outside the transaction to learn whom to check,
// read again inside it, and updated with a compare-and-set. Shared by the local implementation's review
// commands (src/server/services/local/review.ts) and the ones still in src/server/actions/review.ts; it moves
// into the local implementation with the last of those (plan P1).

/** The template, read only to learn its team (and the version's people) for the permission check. */
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

/**
 * The decide check's resource: the team, who submitted and wrote the version (maker-checker), and the
 * users the stage the version waits on names (they decide it on any team). The stage is read again in the
 * transaction.
 */
export async function decideResource(
  found: FoundVersion | undefined,
): Promise<PermissionResource> {
  if (!found) return { teamId: null };
  const named =
    found.state === "in_review"
      ? stageApproverIds(
          currentStageOf(found, await loadChain(db, found.contentTypeId)),
        )
      : [];
  return {
    teamId: found.teamId,
    submittedBy: found.submittedBy,
    writers: found.writers,
    stageApproverIds: named,
  };
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

/** The template's Active version: its number and the contract changes it brought. */
export async function activeVersion(tx: Tx, templateId: string) {
  return tx.query.versions.findFirst({
    columns: { id: true, number: true, contractChanges: true },
    where: and(
      eq(versions.templateId, templateId),
      eq(versions.state, "active"),
    ),
  });
}

/** The stage's own rule (who it names now), asked of the stage of its own the version waits on. */
export function assertStage(
  viewer: Viewer,
  chain: readonly ApprovalStage[],
  version: ReviewVersion,
  teamId: string,
) {
  if (version.state !== "in_review") return; // the transition refuses with its own sentence
  const stage = currentStageOf(version, chain);
  if (!stage) return;
  const result = canActOnStage(viewer, stage, teamId);
  if (!result.ok) refuse(result);
}

/**
 * Compare-and-set: the update lands only if the row still has the state, rev and stage it was read with, and
 * a miss is refused (`whenMissed`) rather than written over. SQLite serializes writes, so here a miss needs a
 * test's `hooks.beforeCompareAndSet` to change the row in between; a database that doesn't serialize writes
 * (the Java API's) reaches it when two people act at once, and answers `version_changed`.
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
  whenMissed: Refusal,
  hooks: TestHooks = {},
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
  if (!saved) refuse(whenMissed);
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
