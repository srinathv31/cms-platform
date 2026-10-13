import type { DraftFields } from "@/domain/lifecycle/types";

/**
 * A draft's row in `versions`: what a new template's first draft (`templates.create`), Edit (`templates.startDraft`)
 * and a send-back's new draft (`review.requestChanges`) all insert.
 */
export function draftRow(
  draft: DraftFields,
  ids: { id: string; templateId: string },
) {
  return {
    id: ids.id,
    templateId: ids.templateId,
    number: draft.number,
    round: draft.round,
    state: draft.state,
    name: draft.name,
    basedOnVersionId: draft.basedOnVersionId,
    body: draft.body,
    channelFields: draft.channelFields,
    channels: draft.channels,
    variables: draft.variables,
    sampleSets: draft.sampleSets,
    contractChanges: draft.contractChanges,
    currentStage: draft.currentStage,
    rev: draft.rev,
    createdBy: draft.createdBy,
    writers: draft.writers,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}
