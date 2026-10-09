// How a save answer becomes an HTTP status. Pure TypeScript so the table is testable on its own.

import type { DraftSaveError, DraftSaveResponse } from "@/domain/types";
import { TOO_LARGE_MESSAGE } from "./parse-patch";

export const DRAFT_SAVE_STATUS: Record<DraftSaveError, number> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  not_draft: 409,
  conflict: 409,
};

export function statusOf(response: DraftSaveResponse): number {
  return response.ok ? 200 : DRAFT_SAVE_STATUS[response.error];
}

/**
 * A body over MAX_BODY_SIZE, declared or counted as it's read: 413, the status HTTP has for it. The
 * body is an ordinary `invalid`, so the client shows the sentence and keeps the edits, as for any
 * other refused patch.
 */
export const TOO_LARGE: DraftSaveResponse = { ok: false, error: "invalid", message: TOO_LARGE_MESSAGE };
export const TOO_LARGE_STATUS = 413;
