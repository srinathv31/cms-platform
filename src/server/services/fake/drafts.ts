import {
  DRAFT_EDITED,
  changedFields,
  draftChanged,
  draftSaveAccess,
  draftSaveChanges,
  draftSaveRefusal,
  mergeDraftEdit,
  recordedRev,
  type DraftSaveRefused,
} from "@/domain/lifecycle/autosave";
import type { Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import type { DraftService } from "../drafts";
import { answerFor, permit } from "../refuse";
import type { FakeDeps } from "./index";
import type { AuditEventRow, FakeState } from "./state";
import { templateById } from "./version-rows";

// Autosave in memory: the same steps as the local implementation (services/local/drafts.ts) in the same order, the
// same domain rules (src/domain/lifecycle/autosave.ts), and the writes into the fake's state. The clock is read
// before the save, which then runs synchronously (`FakeStore.command`); a refusal undoes what it wrote.

/** A refusal raised inside the save, carrying its whole answer (`draft_changed` has the current rev). */
class SaveRefused extends Error {
  constructor(readonly answer: DraftSaveRefused) {
    super(answer.reason);
    this.name = "SaveRefused";
  }
}

/** The version and its template, after the check of who may save (`draftSaveAccess`). */
function authorizeEdit(state: FakeState, viewer: Viewer, versionId: string) {
  const version = state.versions.find((v) => v.id === versionId);
  const template = version && templateById(state, version.templateId);
  permit(draftSaveAccess(viewer, template?.teamId ?? null));
  return { version: version!, template: template! };
}

/** The last save an editing session made to a draft (`lastSaveOf` in the local implementation): its audit row. */
function lastSaveOf(
  state: FakeState,
  versionId: string,
  session: { sessionKey: string; actorId: string },
): { rev: number | null; row: AuditEventRow } | null {
  const row = state.auditEvents
    .filter(
      (e) =>
        e.action === DRAFT_EDITED &&
        e.versionId === versionId &&
        e.sessionKey === session.sessionKey &&
        e.actorId === session.actorId,
    )
    .reduce<AuditEventRow | undefined>(
      (latest, e) => (latest && latest.at >= e.at ? latest : e),
      undefined,
    );
  return row ? { rev: recordedRev(row.details), row } : null;
}

export function fakeDrafts(deps: FakeDeps): DraftService {
  const { store, clock, hooks } = deps;
  return {
    async saveAccess(ctx, { versionId }) {
      try {
        authorizeEdit(store.state, ctx.viewer, versionId);
        return { ok: true };
      } catch (error) {
        return answerFor(error);
      }
    },

    async save(ctx, { versionId, patch }) {
      const now = await clock();
      try {
        return store.command((tx) => {
          const { state } = tx;
          const { version, template } = authorizeEdit(
            state,
            ctx.viewer,
            versionId,
          );
          const contentType = state.contentTypes.find(
            (c) => c.id === template.contentTypeId,
          );
          if (!contentType)
            throw new Error(`No content type ${template.contentTypeId}.`);

          const actorId = ctx.viewer.userId;
          const last = lastSaveOf(state, versionId, {
            sessionKey: patch.sessionKey,
            actorId,
          });
          const refused = draftSaveRefusal(
            {
              state: version.state,
              rev: version.rev,
              allowedChannels: contentType.allowedChannels,
            },
            patch,
            last?.rev ?? null,
          );
          if (refused) throw new SaveRefused(refused);

          // The compare-and-set: the row must still have the rev and state it was read with.
          const read = { rev: version.rev, state: version.state };
          if (
            hooks.beforeCompareAndSet?.({
              table: "versions",
              id: version.id,
            }) === "competing_write"
          )
            tx.update("versions", version, { rev: version.rev + 1 });
          if (version.rev !== read.rev || version.state !== "draft")
            throw new SaveRefused(draftChanged(version.rev));
          const rev = version.rev + 1;
          // A copy, as a database stores one: nothing the caller holds reaches the state.
          tx.update("versions", version, {
            ...structuredClone(draftSaveChanges(version, patch, actorId)),
            rev,
            updatedAt: now,
          });

          const merged = mergeDraftEdit(
            last?.row ?? null,
            changedFields(patch),
            now,
            rev,
          );
          if (last) tx.update("auditEvents", last.row, merged);
          else
            tx.insert("auditEvents", {
              id: newId("ae"),
              ...merged,
              actorId,
              teamId: template.teamId,
              templateId: template.id,
              versionId,
              action: DRAFT_EDITED,
              sessionKey: patch.sessionKey,
            });
          return { ok: true, rev, savedAt: now.toISOString() };
        });
      } catch (error) {
        if (error instanceof SaveRefused) return error.answer;
        return answerFor(error);
      }
    },
  };
}
