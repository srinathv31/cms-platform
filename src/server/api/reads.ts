import "server-only";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { refusal, type ReadResult } from "@/server/services/results";

// The reads the browser asks for on demand, when a dialog or a menu opens: the GET routes under
// src/app/api/templates/[templateId]/. They are route handlers, not server actions: an action is a public
// POST endpoint that runs one at a time with the page's mutations, so a read would wait behind Edit or
// Submit, and Submit behind a read.
//
// Each read's query takes the viewer and the raw request values, parses them with zod, and returns a
// `ReadResult` (src/server/services/results.ts): the data, or a refusal with its code, the sentence to show
// and the status its route answers. The body on the wire is the `ActionResult` the client reads (`{ ok: true, … }` or
// `{ ok: false, code, reason }`).

export {
  refusal,
  type ReadRefusal,
  type ReadResult,
} from "@/server/services/results";

/** A read route's answer when nobody is signed in: 401 `signed_out`. */
export function signedOutResponse(): Response {
  return readResponse(refusal(401, REQUEST_REFUSALS.signedOut));
}

/** A read route's answer: the result as JSON, never cached (it depends on the viewer and on the draft). */
export function readResponse<T>(result: ReadResult<T>): Response {
  const headers = { "Cache-Control": "private, no-store" };
  if (result.ok) return Response.json(result, { headers });
  const body: ActionResult = {
    ok: false,
    code: result.code,
    reason: result.reason,
  };
  return Response.json(body, { status: result.status, headers });
}
