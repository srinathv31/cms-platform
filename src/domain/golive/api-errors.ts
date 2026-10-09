// The consumer API's GET routes: their query parameters and the errors only they return. The render
// route's errors (and their exact sentences) stay in domain/render/errors.ts and are reused here.
// Pure TypeScript.

import type { ApiError } from "../golive-types";

/** The fixed bad_request sentences of the GET routes. */
export const QUERY_MESSAGES = {
  searchLimit: "limit must be a number from 1 to 50.",
  noticeLimit: "limit must be a number from 1 to 200.",
  version: "version must be a version number.",
  since: "since must be a version number.",
  sinceOrder: "since must be lower than version.",
  after: "after must be the nextCursor of an earlier page of this list.",
} as const;

export const SEARCH_LIMIT = { min: 1, max: 50, fallback: 20 } as const;
export const NOTICE_LIMIT = { min: 1, max: 200, fallback: 50 } as const;

export function apiBadRequest(message: string): ApiError {
  return { code: "bad_request", message };
}

/** 404: the path names a consumer that isn't registered. "Consumer acme doesn't exist." */
export function consumerNotFound(consumerId: string): ApiError {
  return { code: "consumer_not_found", message: `Consumer ${consumerId} doesn't exist.` };
}

/** 403: X-Consumer-Id isn't the consumer in the path. "X-Consumer-Id doesn't match consumer coral." */
export function consumerMismatch(consumerId: string): ApiError {
  return { code: "consumer_mismatch", message: `X-Consumer-Id doesn't match consumer ${consumerId}.` };
}

// ── Query parameters ─────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const WHOLE = /^\d+$/;

/** `limit`: absent or blank → the default; a whole number in range → it; anything else → bad_request. */
export function parseLimit(raw: string | null, range: { min: number; max: number; fallback: number }, message: string): Parsed<number> {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: true, value: range.fallback };
  const n = WHOLE.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(n) || n < range.min || n > range.max) return { ok: false, error: apiBadRequest(message) };
  return { ok: true, value: n };
}

/** A version number (1, 2, …): absent or blank → undefined. */
export function parseVersionNumber(raw: string | null, message: string): Parsed<number | undefined> {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: true, value: undefined };
  const n = /^[1-9]\d*$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(n)) return { ok: false, error: apiBadRequest(message) };
  return { ok: true, value: n };
}
