import "server-only";
import { API_ERROR_STATUS, type ApiError, type ApiErrorBody } from "@/domain/golive-types";
import { newId } from "@/server/ids";

// What every /api/v1 response shares: the correlation id (echoed, or generated), no-store, nosniff,
// and the `{ error: { code, message, details? } }` body with the status the contract gives its code.
// The render route and the consumer GET routes all answer through these.

/** Visible ASCII, up to 128 characters; anything else gets a fresh id instead of being echoed. */
const CORRELATION_ID = /^[\x21-\x7e]{1,128}$/;

/** The request's X-Correlation-Id when it's usable, else a fresh `req_…` id. */
export function correlationIdOf(request: Request): string {
  const given = request.headers.get("x-correlation-id")?.trim();
  return given && CORRELATION_ID.test(given) ? given : newId("req", 12);
}

/** Headers every /api/v1 response carries. */
export function baseHeaders(correlationId: string): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Correlation-Id": correlationId,
    "X-Content-Type-Options": "nosniff",
  });
}

/** An error as JSON, with the status the contract gives its code. */
export function errorResponse(error: ApiError, correlationId: string): Response {
  const body: ApiErrorBody = { error };
  return Response.json(body, { status: API_ERROR_STATUS[error.code], headers: baseHeaders(correlationId) });
}

/** A 200 JSON body with the base headers. */
export function jsonResponse(body: unknown, correlationId: string): Response {
  return Response.json(body, { headers: baseHeaders(correlationId) });
}
