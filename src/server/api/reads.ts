import "server-only";
import type { ActionResult } from "@/domain/review-types";

// The reads the browser asks for on demand, when a dialog or a menu opens: the GET routes under
// src/app/api/templates/[templateId]/. They are route handlers, not server actions: an action is a public
// POST endpoint that runs one at a time with the page's mutations, so a read would wait behind Edit or
// Submit, and Submit behind a read.
//
// Each read's query takes the viewer and the raw request values, parses them with zod, and returns a
// `ReadResult`: the data, or a refusal with the sentence to show and the status its route answers.
// The body on the wire is the `ActionResult` the client reads (`{ ok: true, … }` or `{ ok: false, reason }`).

/** Why a read refused, and the HTTP status its route answers with. */
export interface ReadRefusal {
  ok: false;
  /** 400 the request doesn't parse · 403 the viewer may not · 404 no such template or version · 409 not in a state to read. */
  status: 400 | 403 | 404 | 409;
  reason: string;
}

export type ReadResult<T> = ({ ok: true } & T) | ReadRefusal;

export const refusal = (status: ReadRefusal["status"], reason: string): ReadRefusal => ({ ok: false, status, reason });

/** A read route's answer: the result as JSON, never cached (it depends on the viewer and on the draft). */
export function readResponse<T>(result: ReadResult<T>): Response {
  const headers = { "Cache-Control": "private, no-store" };
  if (result.ok) return Response.json(result, { headers });
  const body: ActionResult = { ok: false, reason: result.reason };
  return Response.json(body, { status: result.status, headers });
}
