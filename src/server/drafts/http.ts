// How a save answer becomes an HTTP status. Pure TypeScript so the table is testable on its own.

import type { DraftSaveError, DraftSaveResponse } from "@/domain/types";

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
