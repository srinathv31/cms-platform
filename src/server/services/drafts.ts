// Autosave behind the seam. The BFF's route reads the body (capped), parses the patch and prepares each
// document (normalized, checked, block ids: src/server/documents/prepare.ts, decision 0065); the service
// checks the draft's state and `rev`, writes with a compare-and-set, and answers the save or a refusal.
//
// Typed for step 2b: the route still calls src/server/drafts/save-draft.ts.

import type { Refused } from "@/domain/refusals";
import type { DraftPatch, DraftSaveResponse } from "@/domain/types";
import type { RequestContext } from "./types";

export interface DraftService {
  /** `version_gone` or the permission refusal, or null when the viewer may save to the draft. Asked before the body is read. */
  saveAccess(
    ctx: RequestContext,
    input: { versionId: string },
  ): Promise<Refused | null>;

  /**
   * Saves a prepared patch. A stale `rev` is `draft_changed` with the current one, unless the save session
   * that wrote it is the caller's (a lost response): the backend answers that from its own record of the
   * session (decision 0066), never from the audit log once ported.
   */
  save(
    ctx: RequestContext,
    input: { versionId: string; patch: DraftPatch },
  ): Promise<DraftSaveResponse>;
}
