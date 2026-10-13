import "server-only";
import type { DraftPatch, DraftSaveResponse, Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import { services } from "@/server/services";
import { prepareDraftPatch } from "./prepare-patch";

// A bridge, not code to copy. Autosave's save runs behind the seam (`DraftService.save`), and the route prepares the
// patch and calls it with the request's context. This keeps the old signature for the tests plan P1 owns that still
// save a draft through it (src/server/actions/review.test.ts) until P1 ports them; the integration step (2b-2)
// deletes the file. It saves as the route does, as `viewer`.

/** Prepares the patch and saves it as `viewer`, through `services().drafts.save`. */
export async function saveDraft(
  viewer: Viewer,
  versionId: string,
  patch: DraftPatch,
): Promise<DraftSaveResponse> {
  const prepared = prepareDraftPatch(patch);
  if (!prepared.ok) return prepared;
  return services().drafts.save(
    {
      viewer,
      correlationId: newId("req", 12),
      credential: { kind: "in_process", userId: viewer.userId },
    },
    { versionId, patch: prepared.patch },
  );
}
