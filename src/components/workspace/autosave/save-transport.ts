// The network half of autosave: PUT one patch to /api/drafts/[versionId] and read the answer.

import type { DraftSaveError, DraftSaveResponse } from "@/domain/types";
import type { Send } from "./autosave-scheduler";

/**
 * Browsers cap the bodies of in-flight `keepalive` requests at 64 KB in total. Stay well under it,
 * because the cap is shared with any other keepalive request and some browsers count headers too.
 * A larger patch goes out as an ordinary request when the page is closing, and the browser may
 * cancel it: edits since the last debounced save can be lost. A long document edited continuously
 * saves at least every 5 s, so the exposure is that window.
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
 * A `Send` that talks to the route. Rejects when there is no usable answer (offline, a 5xx, a body
 * that isn't one of the route's answers), which the scheduler treats as worth retrying.
 */
export function createFetchSend(versionId: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): Send {
  const url = `/api/drafts/${encodeURIComponent(versionId)}`;

  return async (patch, { keepalive }) => {
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
