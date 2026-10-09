// The network half of autosave: PUT one patch to /api/drafts/[versionId] and read the answer.

import type { DraftPatch, DraftSaveError, DraftSaveResponse } from "@/domain/types";
import { DOCUMENT_MESSAGES, normalizeAndCheckBody, normalizeAndCheckField } from "@/editor/model/document-check";
import type { Send } from "./autosave-scheduler";

/**
 * Browsers cap the bodies of in-flight `keepalive` requests at 64 KB in total. Stay well under it,
 * because the cap is shared with any other keepalive request and some browsers count headers too.
 * A larger patch (a long document: every block carries an id) goes out as an ordinary request when
 * the page is closing, and the browser may cancel it. That is why closing or reloading the page asks
 * first while anything isn't saved (`beforeunload` in use-draft-autosave.ts): the request goes out as
 * it asks, and staying lets it land.
 */
export const KEEPALIVE_LIMIT_BYTES = 60_000;

const ERRORS: readonly DraftSaveError[] = ["conflict", "forbidden", "not_draft", "not_found", "invalid"];

function isSaveResponse(value: unknown): value is DraftSaveResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) return typeof v.rev === "number" && typeof v.savedAt === "string";
  return (
    v.ok === false &&
    typeof v.message === "string" &&
    typeof v.error === "string" &&
    (ERRORS as readonly string[]).includes(v.error)
  );
}

/**
 * The server's document check (src/server/documents/prepare.ts starts with the same two calls), run
 * before sending. A patch it would refuse is refused here with the same sentence and no request: the
 * route's 400 would also put a "Failed to load resource" error in the browser console. The editor
 * keeps its documents inside the limits, so this only catches what paste can still bring in (a list
 * ten deep). Only the schema parse is left to the server.
 */
function refusal(patch: DraftPatch): DraftSaveResponse | null {
  const problem =
    (patch.body ? normalizeAndCheckBody(patch.body).problem : null) ??
    (patch.emailSubject ? normalizeAndCheckField(patch.emailSubject).problem : null) ??
    (patch.emailPreheader ? normalizeAndCheckField(patch.emailPreheader).problem : null);
  return problem ? { ok: false, error: "invalid", message: DOCUMENT_MESSAGES[problem] } : null;
}

/**
 * A `Send` that talks to the route. Rejects when there is no usable answer (offline, a 5xx, a body
 * that isn't one of the route's answers), which the scheduler treats as worth retrying.
 */
export function createFetchSend(versionId: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): Send {
  const url = `/api/drafts/${encodeURIComponent(versionId)}`;

  return async (patch, { keepalive }) => {
    const refused = refusal(patch);
    if (refused) return refused;

    const body = JSON.stringify(patch);
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      keepalive: keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_LIMIT_BYTES,
    });
    if (response.status >= 500) throw new Error(`Save failed with status ${response.status}`);

    const json: unknown = await response.json();
    if (!isSaveResponse(json)) throw new Error("Save returned an unexpected response");
    return json;
  };
}
