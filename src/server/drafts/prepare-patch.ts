import "server-only";
import { ALL_CHANNEL_FIELDS } from "@/domain/channel-fields";
import { REQUEST_REFUSALS, refuse, type Refused } from "@/domain/refusals";
import type { DraftPatch } from "@/domain/types";
import { prepareBody, prepareField } from "@/server/documents/prepare";

// The BFF's half of an autosave, between the parse (parse-patch.ts) and the save (`DraftService.save`): every
// document the patch carries is made ready for storage, the body by `prepareBody` and each channel field it names
// (by id, "email.subject"; null clears one) by `prepareField` for its shape (src/server/documents/prepare.ts):
// normalized, checked, with block ids (decision 0065). The backend stores what it is handed and validates it; it
// never normalizes. A document the check refuses is `invalid_input` with the check's sentence, and nothing is saved.

export type PreparedPatch = { ok: true; patch: DraftPatch } | Refused;

/** The patch with its documents prepared, or the check's refusal of the first one that fails it. */
export function prepareDraftPatch(patch: DraftPatch): PreparedPatch {
  const prepared: DraftPatch = { ...patch };
  if (patch.body !== undefined) {
    const body = prepareBody(patch.body);
    if (!body.ok) return refuse(REQUEST_REFUSALS.invalidInput(body.message));
    prepared.body = body.doc;
  }
  for (const field of ALL_CHANNEL_FIELDS) {
    const value = patch[field.id];
    if (value === undefined || value === null) continue;
    const doc = prepareField(value, field);
    if (!doc.ok) return refuse(REQUEST_REFUSALS.invalidInput(doc.message));
    prepared[field.id] = doc.doc;
  }
  return { ok: true, patch: prepared };
}
