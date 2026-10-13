import "server-only";
import type { DraftPatch, DraftSaveResponse, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { saveDraft } from "./save-draft";

// A bridge, not code to copy. Autosave's save runs behind the seam (`DraftService.save`; on this app's database,
// src/server/services/local/drafts.ts). This keeps `applyDraftPatch`'s old signature for the tests plan P1 owns that
// still call it (src/server/actions/review.test.ts, versioned-name.test.ts) until P1 ports them; the integration step
// (2b-2) deletes the file. The save is dated by the backend's clock, which those tests mock to the `at` they pass,
// and runs on the database client they mock, so `db` and `at` are not read.

export interface ApplyPatchArgs {
  viewer: Viewer;
  versionId: string;
  patch: DraftPatch;
  at: Date;
}

/** Saves the patch as `viewer`, as the autosave route does (`saveDraft`). */
export function applyDraftPatch(
  _db: Db,
  { viewer, versionId, patch }: ApplyPatchArgs,
): Promise<DraftSaveResponse> {
  return saveDraft(viewer, versionId, patch);
}
