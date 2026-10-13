// How a save answer becomes an HTTP status. Pure TypeScript so the table is testable on its own.

import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS, type RefusalCode } from "@/domain/refusals";
import type { DraftSaveResponse } from "@/domain/types";

/**
 * The status of each refusal an autosave gives. A refusal not named here is the patch itself being
 * wrong (it doesn't parse, a document or the channels fail their check): 400.
 */
export const DRAFT_SAVE_STATUS: Partial<Record<RefusalCode, number>> = {
  [REQUEST_REFUSALS.signedOut.code]: 401,
  [REASONS.generic.code]: 403,
  [REQUEST_REFUSALS.versionGone.code]: 404,
  [REQUEST_REFUSALS.versionNotDraft.code]: 409,
  [REQUEST_REFUSALS.draftChanged.code]: 409,
  // A body over MAX_BODY_SIZE, declared or counted as it's read: 413, the status HTTP has for it.
  [REQUEST_REFUSALS.draftTooLarge.code]: 413,
};

export function statusOf(response: DraftSaveResponse): number {
  return response.ok ? 200 : (DRAFT_SAVE_STATUS[response.code] ?? 400);
}
