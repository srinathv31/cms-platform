// What a service method answers, beside `ActionResult` (src/domain/review-types.ts): a read's result. The
// shapes are the seam's own, so the interfaces, the implementations and the BFF all import them from here;
// src/server/api/reads.ts turns one into a route's response.

import type { Refusal, RefusalCode } from "@/domain/refusals";

/** Why a read refused, and the HTTP status a route answers with. */
export interface ReadRefusal {
  ok: false;
  /**
   * 400 the request doesn't parse · 401 nobody is signed in · 403 the viewer may not · 404 no such template or
   * version (or not one the viewer may see) · 409 not in a state to read.
   */
  status: 400 | 401 | 403 | 404 | 409;
  code: RefusalCode;
  reason: string;
}

/** A read's answer: the data, or a refusal with its status. */
export type ReadResult<T> = ({ ok: true } & T) | ReadRefusal;

/** A read's refusal: the domain table's entry with the status its route answers. */
export const refusal = (
  status: ReadRefusal["status"],
  { code, reason }: Refusal,
): ReadRefusal => ({ ok: false, status, code, reason });
