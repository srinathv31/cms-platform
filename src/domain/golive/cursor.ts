// Paging for the consumer API's two lists, notices and template search: the opaque `after` cursor and
// the page cut. Pure TypeScript.
//
// A cursor is opaque to consumers (api-v1.ts `ApiPage`): they pass a `nextCursor` back as `after` and
// never build one. Inside, it is base64url of a small JSON object naming the list it belongs to and
// where the last page ended. A second backend serving /api/v1 has to read these, because consumers
// keep notice cursors between polls:
//
//   notices  {"v":1,"list":"notices","consumer":"coral","template":null,"epoch":"2026-10-08T…Z","seq":42}
//            `seq` is the last consumer_notices.seq the page held (0: before the first notice).
//            `epoch` names the outbox the numbers belong to (settings.seeded_at; null when unseeded).
//            A demo reset starts the numbers again, so a cursor from before it is refused, not
//            read against new notices it would skip.
//   search   {"v":1,"list":"search","q":"rate","last":{"rank":1,"name":"Rate Change Notice","id":"UC-…"}}
//            `last` is the sort key of the page's last result (null: before the first).
//
// It isn't signed. A consumer only ever reads its own notices (X-Consumer-Id must match the path), so
// an edited cursor shows it nothing it couldn't read anyway. Anything that isn't a cursor of the same
// list (another consumer, another `templateId` or `q`, the other endpoint, garbage) is bad_request.

import type { ApiError } from "../golive-types";
import { apiBadRequest, type Parsed, QUERY_MESSAGES } from "./api-errors";

const VERSION = 1;

// ── Encoding ─────────────────────────────────────────────────────────────────

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The JSON object inside a cursor, or null when the text isn't base64url of a JSON object. */
function fromBase64Url(raw: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * `after`: absent or blank is the start of the list. Anything else must decode as this list's cursor:
 * `read` returns its value, an error of its own, or undefined for "not a cursor of this list".
 */
function readCursor<T>(
  raw: string | null,
  read: (body: Record<string, unknown>) => { value: T } | { error: ApiError } | undefined,
  start: T,
): Parsed<T> {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: true, value: start };
  const body = fromBase64Url(text);
  const outcome = body && body.v === VERSION ? read(body) : undefined;
  if (outcome === undefined) return { ok: false, error: apiBadRequest(QUERY_MESSAGES.after) };
  return "error" in outcome ? { ok: false, error: outcome.error } : { ok: true, value: outcome.value };
}

// ── Notices ──────────────────────────────────────────────────────────────────

/** Which notices a cursor pages: one consumer's, all of them or one template's, in one outbox. */
export interface NoticeList {
  consumerId: string;
  templateId: string | null;
  /** The outbox's epoch: what the seed wrote as `seeded_at`, which a demo reset changes (null when unseeded). */
  epoch: string | null;
}

/** The cursor that continues `list` after the notice numbered `seq`. */
export function noticeCursor(list: NoticeList, seq: number): string {
  return toBase64Url(
    JSON.stringify({ v: VERSION, list: "notices", consumer: list.consumerId, template: list.templateId, epoch: list.epoch, seq }),
  );
}

/**
 * `after` on the notices route: the `seq` to continue after, 0 when absent. A cursor of this list
 * from another epoch (before a demo reset) gets its own sentence: the consumer has to start again.
 */
export function readNoticeCursor(raw: string | null, list: NoticeList): Parsed<number> {
  return readCursor<number>(
    raw,
    (body) => {
      const { consumer, template, epoch, seq } = body;
      if (body.list !== "notices" || consumer !== list.consumerId || template !== list.templateId || !isCount(seq)) return undefined;
      if (epoch !== null && typeof epoch !== "string") return undefined;
      if (epoch !== list.epoch) return { error: apiBadRequest(QUERY_MESSAGES.staleAfter) };
      return { value: seq };
    },
    0,
  );
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Where a template sits in a search's order: rank (0 exact id, 1 name starts with the query, 2 the rest), then name, then id. */
export interface SearchKey {
  rank: number;
  name: string;
  id: string;
}

/**
 * Two strings in Unicode code point order: the same on every machine and in every locale. Java's
 * `String.compareTo` agrees except for characters outside the Basic Multilingual Plane, which it
 * compares as UTF-16 surrogates; a port compares `codePoints()` instead.
 */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  // Equal so far: the one with characters left is longer, so later.
  return (i < a.length ? 1 : 0) - (j < b.length ? 1 : 0);
}

/**
 * The search order: rank, then name, then id, names and ids by code point. Pages are cut on it (the
 * filter after a cursor and the sort use this one function), so every implementation must sort
 * exactly this way.
 */
export function compareSearchKeys(a: SearchKey, b: SearchKey): number {
  return a.rank - b.rank || compareCodePoints(a.name, b.name) || compareCodePoints(a.id, b.id);
}

/** A search cursor belongs to its query as the search reads it: trimmed, any case. */
const searchQuery = (q: string) => q.trim().toLowerCase();

/** The cursor that continues the search for `q` after `last` (null: from the start). */
export function searchCursor(q: string, last: SearchKey | null): string {
  return toBase64Url(JSON.stringify({ v: VERSION, list: "search", q: searchQuery(q), last }));
}

function readSearchKey(value: unknown): SearchKey | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const { rank, name, id } = value as Record<string, unknown>;
  return isCount(rank) && rank <= 2 && typeof name === "string" && typeof id === "string" ? { rank, name, id } : undefined;
}

/** `after` on the search route: the key to continue after, null when absent. */
export function readSearchCursor(raw: string | null, q: string): Parsed<SearchKey | null> {
  return readCursor<SearchKey | null>(
    raw,
    (body) => {
      if (body.list !== "search" || body.q !== searchQuery(q)) return undefined;
      const last = readSearchKey(body.last);
      return last === undefined ? undefined : { value: last };
    },
    null,
  );
}

// ── The page cut ─────────────────────────────────────────────────────────────

/**
 * The first `limit` of `rows` (already in list order, already after the cursor), and whether more
 * follow. Callers read `limit + 1` rows so `hasMore` needs no second query.
 */
export function cutPage<T>(rows: readonly T[], limit: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
