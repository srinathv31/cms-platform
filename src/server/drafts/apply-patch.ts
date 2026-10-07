import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { PermissionError, assertCan } from "@/domain/permissions";
import type { DraftPatch, DraftSaveError, DraftSaveResponse, JSONContent, Viewer } from "@/domain/types";
import { ensureBlockIds } from "@/editor/schema";
import type { Db } from "@/server/db/client";
import { auditEvents, contentTypes, templates, versions } from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { DRAFT_EDITED, changedFields, mergeDraftEdit, sessionOwnsRev } from "./audit-merge";
import { NAME_MESSAGE, normalizeName } from "./parse-patch";

// The database half of an autosave. `saveDraft` (save-draft.ts) supplies the real database and the
// demo clock; this takes both as arguments so the tests can run it against a temporary database.

function fail(error: DraftSaveError, message: string, rev?: number): DraftSaveResponse {
  return rev === undefined ? { ok: false, error, message } : { ok: false, error, rev, message };
}

/**
 * Gives every block that lacks one an `attrs.id` (comment anchors, redline, margin threads), and
 * keeps the ones it has.
 *
 * The editor already emits ids on every block, so for its documents this changes nothing. It runs on
 * every save because the platform's rule is that stored bodies always have ids, whoever wrote them,
 * and because it checks the document against the shared schema: an unknown node or mark type is
 * refused here, at save, rather than failing the render pipeline weeks later. It costs about a
 * millisecond for a short document and about 10 ms for 400 paragraphs.
 * Returns null when the document does not fit the schema.
 */
function withBlockIds(doc: JSONContent): JSONContent | null {
  try {
    return ensureBlockIds(doc);
  } catch {
    return null;
  }
}

function isBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === "SQLITE_BUSY" || (cause !== undefined && isBusy(cause));
}

/**
 * Two saves in flight at once (two tabs, or a save during another write) make the second
 * `BEGIN IMMEDIATE` fail with SQLITE_BUSY, because the local file has no busy timeout. Nothing has
 * run when that happens, so waiting a few milliseconds and trying again is safe. The retry then
 * sees the first save's rev and answers `conflict`. Against Turso this never triggers.
 */
async function retryWhenBusy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 5 || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}

export interface ApplyPatchArgs {
  viewer: Viewer;
  versionId: string;
  patch: DraftPatch;
  /** The demo clock, read once by the caller before the transaction opens. */
  at: Date;
}

/**
 * Saves a patch to a draft in one transaction.
 * Order of answers: not_found, forbidden, not_draft, conflict, then invalid (the checks that need
 * the database). A stale rev is a conflict unless the same session wrote the current rev (lost response). Shape problems are the route's 400 and never reach here.
 */
export async function applyDraftPatch(db: Db, { viewer, versionId, patch, at }: ApplyPatchArgs): Promise<DraftSaveResponse> {
  // Pure work first, so the write lock is held only for the reads and writes.
  let name: string | undefined;
  if (patch.name !== undefined) {
    const normalized = normalizeName(patch.name);
    if (normalized === null) return fail("invalid", NAME_MESSAGE);
    name = normalized;
  }

  let body: JSONContent | undefined;
  if (patch.body !== undefined) {
    const withIds = withBlockIds(patch.body);
    if (!withIds) return fail("invalid", "The document has content the editor doesn't support.");
    body = withIds;
  }

  const changed = changedFields({ ...patch, name });

  const transaction = () => db.transaction(async (tx) => {
    // libSQL starts write transactions as BEGIN IMMEDIATE, so the reads below see the same rev the update will.
    const row = await tx
      .select({
        rev: versions.rev,
        state: versions.state,
        templateId: versions.templateId,
        teamId: templates.teamId,
        allowedChannels: contentTypes.allowedChannels,
      })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
      .where(eq(versions.id, versionId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!row) return fail("not_found", "This draft no longer exists.");

    try {
      assertCan(viewer, "draft.edit", { teamId: row.teamId });
    } catch (error) {
      if (error instanceof PermissionError) return fail("forbidden", error.reason);
      throw error;
    }

    if (row.state !== "draft") return fail("not_draft", "This version is no longer a draft.");

    // One audit row per editing session: the same actor, draft and session key.
    const existing = await tx
      .select({ id: auditEvents.id, at: auditEvents.at, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, DRAFT_EDITED),
          eq(auditEvents.versionId, versionId),
          eq(auditEvents.sessionKey, patch.sessionKey),
          eq(auditEvents.actorId, viewer.userId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    // A request that is behind is a conflict, unless this session wrote the current rev itself:
    // then it is only missing its own saves (a lost response) and it is safe to carry on from the
    // current rev. A request that is ahead is always a conflict.
    if (patch.rev !== row.rev && !sessionOwnsRev(existing ?? null, row.rev, patch.rev)) {
      return fail("conflict", "This draft changed elsewhere.", row.rev);
    }

    if (patch.channels && !patch.channels.every((channel) => row.allowedChannels.includes(channel))) {
      return fail("invalid", "That channel isn't available for this content type.");
    }

    const set: SQLiteUpdateSetSource<typeof versions> = { rev: sql`${versions.rev} + 1`, updatedAt: at };
    if (body !== undefined) set.body = body;
    if (patch.variables !== undefined) set.variables = patch.variables;
    if (patch.channels !== undefined) set.channels = patch.channels;
    if (patch.emailSubject !== undefined) set.emailSubject = patch.emailSubject;
    if (patch.emailPreheader !== undefined) set.emailPreheader = patch.emailPreheader;
    if (patch.sampleSets !== undefined) set.sampleSets = patch.sampleSets;

    // The rev and state in the WHERE make this a compare-and-set, whatever the transaction mode.
    // `row.rev` is `patch.rev` except in the lost-response case above.
    const updated = await tx
      .update(versions)
      .set(set)
      .where(and(eq(versions.id, versionId), eq(versions.rev, row.rev), eq(versions.state, "draft")))
      .returning({ rev: versions.rev });
    const saved = updated[0];
    if (!saved) return fail("conflict", "This draft changed elsewhere.", row.rev);

    if (name !== undefined) await tx.update(templates).set({ name }).where(eq(templates.id, row.templateId));

    const merged = mergeDraftEdit(existing ?? null, changed, at, saved.rev);
    if (existing) {
      await tx.update(auditEvents).set(merged).where(eq(auditEvents.id, existing.id));
    } else {
      await tx.insert(auditEvents).values({
        id: newId("ae"),
        ...merged,
        actorId: viewer.userId,
        teamId: row.teamId,
        templateId: row.templateId,
        versionId,
        action: DRAFT_EDITED,
        sessionKey: patch.sessionKey,
      });
    }

    return { ok: true, rev: saved.rev, savedAt: at.toISOString() } satisfies DraftSaveResponse;
  });

  return retryWhenBusy(transaction);
}
