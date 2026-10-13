import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import {
  DRAFT_EDITED,
  changedFields,
  draftChanged,
  draftSaveChanges,
  draftSaveRefusal,
  mergeDraftEdit,
  recordedRev,
  type DraftSaveRefused,
} from "@/domain/lifecycle/autosave";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  auditEvents,
  contentTypes,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import type { DraftService } from "../drafts";
import { answerFor } from "../refuse";
import { check, refuse, runCommand, type LocalDeps } from "./command";
import type { Tx } from "./transaction";

// Autosave on this app's own database (src/server/services/drafts.ts says what each method promises). A save runs
// on the command kit (./command.ts): `authorize` reads the version only to learn its team and checks the
// permission; the one transaction re-reads it, finds the session's last save, asks the domain
// (src/domain/lifecycle/autosave.ts) whether the save lands and what it writes, writes with a compare-and-set on
// rev and state, and merges the save into its editing session's audit row, all dated by the backend's clock.
//
// The patch arrives prepared (the BFF's route ran every document through src/server/documents/prepare.ts), so the
// save stores what it is handed: it runs in the process that prepared it.

/** What a save that lands answers besides `ok`. */
type Saved = { rev: number; savedAt: string };

/** A refusal raised inside the save's transaction, carrying its whole answer (`draft_changed` has the current rev). */
class SaveRefused extends Error {
  constructor(readonly answer: DraftSaveRefused) {
    super(answer.reason);
    this.name = "SaveRefused";
  }
}

/** The version's team, read only to check the permission: `version_gone` when there is no such version. */
async function authorizeEdit(viewer: Viewer, versionId: string) {
  const found = await db
    .select({ teamId: templates.teamId })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(eq(versions.id, versionId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!found) refuse(REQUEST_REFUSALS.versionGone);
  check(viewer, "draft.edit", { teamId: found.teamId });
  return found;
}

/**
 * The last save an editing session (its key, by one person) made to a draft: the rev it produced (null when its
 * row never recorded one) and the session's `draft.edited` audit row, which this save merges into. Null when the
 * session hasn't saved to the draft.
 *
 * The only read of `draft.edited` rows, and the one place autosave reads the audit log (B5). The Java API answers it
 * from the version row instead: `last_save_session` and `last_save_by` beside `rev`, written in the same transaction
 * as every save, so when they name this session its last save produced the current rev (docs/reference/data-model.md).
 * Never from its audit log, which stays append-only (decision 0066).
 */
export async function lastSaveOf(
  tx: Tx,
  versionId: string,
  session: { sessionKey: string; actorId: string },
) {
  const row = await tx
    .select({
      id: auditEvents.id,
      at: auditEvents.at,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, DRAFT_EDITED),
        eq(auditEvents.versionId, versionId),
        eq(auditEvents.sessionKey, session.sessionKey),
        eq(auditEvents.actorId, session.actorId),
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(1)
    .then((rows) => rows[0]);
  return row ? { rev: recordedRev(row.details), row } : null;
}

export function localDrafts(deps: LocalDeps): DraftService {
  return {
    async saveAccess(ctx, { versionId }) {
      try {
        await authorizeEdit(ctx.viewer, versionId);
        return { ok: true };
      } catch (error) {
        return answerFor(error);
      }
    },

    async save(ctx, input) {
      try {
        return await runCommand(deps, ctx, input, {
          authorize: ({ ctx, input }) =>
            authorizeEdit(ctx.viewer, input.versionId),
          transaction: async (
            tx,
            { ctx, input: { versionId, patch }, now },
          ): Promise<ActionResult<Saved>> => {
            // libSQL opens write transactions as BEGIN IMMEDIATE, so these reads see the rev the update will.
            const draft = await tx
              .select({
                rev: versions.rev,
                state: versions.state,
                writers: versions.writers,
                channelFields: versions.channelFields,
                templateId: versions.templateId,
                teamId: templates.teamId,
                allowedChannels: contentTypes.allowedChannels,
              })
              .from(versions)
              .innerJoin(templates, eq(templates.id, versions.templateId))
              .innerJoin(
                contentTypes,
                eq(contentTypes.id, templates.contentTypeId),
              )
              .where(eq(versions.id, versionId))
              .limit(1)
              .then((rows) => rows[0]);
            if (!draft) refuse(REQUEST_REFUSALS.versionGone);

            const actorId = ctx.viewer.userId;
            const last = await lastSaveOf(tx, versionId, {
              sessionKey: patch.sessionKey,
              actorId,
            });
            const refused = draftSaveRefusal(draft, patch, last?.rev ?? null);
            if (refused) throw new SaveRefused(refused);

            const set: SQLiteUpdateSetSource<typeof versions> = {
              ...draftSaveChanges(draft, patch, actorId),
              rev: sql`${versions.rev} + 1`,
              updatedAt: now,
            };
            if (
              deps.hooks.beforeCompareAndSet?.({
                table: "versions",
                id: versionId,
              }) === "competing_write"
            )
              await tx
                .update(versions)
                .set({ rev: sql`${versions.rev} + 1` })
                .where(eq(versions.id, versionId));
            // The rev and state in the WHERE make this a compare-and-set, whatever the transaction mode. `draft.rev`
            // is `patch.rev` except when the session's response was lost.
            const [saved] = await tx
              .update(versions)
              .set(set)
              .where(
                and(
                  eq(versions.id, versionId),
                  eq(versions.rev, draft.rev),
                  eq(versions.state, "draft"),
                ),
              )
              .returning({ rev: versions.rev });
            if (!saved) {
              // Another write landed between the read and this one: refused with the rev it left, written nothing.
              const [current] = await tx
                .select({ rev: versions.rev })
                .from(versions)
                .where(eq(versions.id, versionId));
              throw new SaveRefused(draftChanged(current?.rev ?? draft.rev));
            }

            const merged = mergeDraftEdit(
              last?.row ?? null,
              changedFields(patch),
              now,
              saved.rev,
            );
            if (last)
              await tx
                .update(auditEvents)
                .set(merged)
                .where(eq(auditEvents.id, last.row.id));
            else
              await tx.insert(auditEvents).values({
                id: newId("ae"),
                ...merged,
                actorId,
                teamId: draft.teamId,
                templateId: draft.templateId,
                versionId,
                action: DRAFT_EDITED,
                sessionKey: patch.sessionKey,
              });

            return {
              ok: true,
              rev: saved.rev,
              savedAt: now.toISOString(),
            };
          },
        });
      } catch (error) {
        // A refusal inside the transaction rolled it back (a competing write a test's hook made included).
        if (error instanceof SaveRefused) return error.answer;
        throw error;
      }
    },
  };
}
