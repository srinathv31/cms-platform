import "server-only";
import type { DraftPatch, DraftSaveResponse, Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { applyDraftPatch } from "./apply-patch";

/**
 * Saves an autosave patch to a draft: permission check, state and rev check, the write, and the
 * merged audit row, in one transaction. `patch` must come from `parseDraftPatch`.
 * Returns the contract's response; the route maps `error` to an HTTP status.
 */
export async function saveDraft(viewer: Viewer, versionId: string, patch: DraftPatch): Promise<DraftSaveResponse> {
  // Read the demo clock before the transaction opens: it queries the database on its own connection.
  const at = await now();
  return applyDraftPatch(db, { viewer, versionId, patch, at });
}
