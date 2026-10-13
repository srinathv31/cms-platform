import type { DraftFields } from "@/domain/lifecycle/types";
import type { VersionRow } from "./state";

/**
 * A new draft's row, as the database fills it (services/local/draft-row.ts): the columns a draft doesn't set are
 * null. Edit and a new template insert it.
 */
export function fakeDraftRow(
  draft: DraftFields,
  ids: { id: string; templateId: string; importUploadId?: string | null },
): VersionRow {
  return {
    ...draft,
    id: ids.id,
    templateId: ids.templateId,
    smsFooter: null,
    stages: null,
    submittedBy: null,
    submittedAt: null,
    submitNote: null,
    activatedAt: null,
    supersededAt: null,
    sunsetAt: null,
    sunsetSetBy: null,
    revoke: null,
    importUploadId: ids.importUploadId ?? null,
  };
}
