// Autosave behind the seam. The BFF's route reads the body (capped), parses the patch and prepares each document
// (normalized, checked, block ids: src/server/documents/prepare.ts, decision 0065); the service checks the draft's
// state and `rev`, writes with a compare-and-set, and answers the save or a refusal. The rules are
// src/domain/lifecycle/autosave.ts's, so every implementation answers a save alike.

import type { DraftPatch, DraftSaveResponse } from "@/domain/types";
import type { ActionResult, RequestContext } from "./types";

export interface DraftService {
  /**
   * May the viewer save to the draft? `version_gone` for a version that isn't there or the viewer may not see
   * (the two read the same), then the permission refusal (`generic`) for someone who may see it but not edit the
   * team's drafts, as `save` answers them (`draftSaveAccess`); `ok` for an author of the template's team whatever state the version is in (`version_not_draft` is the
   * save's to answer). Asked before the body is read; an HTTP implementation may answer `ok` and leave the check
   * to `save`, saving a round trip.
   */
  saveAccess(
    ctx: RequestContext,
    input: { versionId: string },
  ): Promise<ActionResult>;

  /**
   * Saves a prepared patch to a draft: the fields it names (the channel fields laid over the stored ones, so those
   * it doesn't name are kept), the saver among the version's writers (maker-checker), and the rev up by one, dated
   * by the backend's clock (`savedAt`). Refuses, writing nothing, in this order: `version_gone`, the permission
   * refusal (`generic`), `version_not_draft`, `draft_changed` carrying the current `rev`, then the channels
   * (`no_channels`, `channel_unavailable`).
   *
   * A `rev` that isn't the current one is `draft_changed`, unless the editing session that sent it (its
   * `sessionKey`, by the same person) made the save that produced the current rev: its response was lost, and the
   * save carries on from the current rev. The backend answers that from its own record of the session's last
   * save (decision 0066: the version row's session columns once ported, never its audit log). A save that loses
   * its compare-and-set to another write is `draft_changed` too.
   */
  save(
    ctx: RequestContext,
    input: { versionId: string; patch: DraftPatch },
  ): Promise<DraftSaveResponse>;
}
