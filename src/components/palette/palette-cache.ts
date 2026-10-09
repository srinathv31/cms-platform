import type { PaletteResults } from "@/domain/import-types";
import { normalizePaletteQuery } from "@/domain/palette";

// The palette's answers from GET /api/palette/{space}, kept so that reopening it, or deleting what was
// typed, shows them at once. A cache belongs to one viewer: every answer is filed under the viewer,
// the space, the template being viewed and the search; asking for another viewer finds nothing, and an
// answer read for anybody else is never kept. The palette starts a new cache when the viewer changes (a
// persona switch, later a sign-in). Immutable, so it can be React state.

/** One question to the palette's route. */
export interface PaletteAsk {
  viewerId: string;
  space: string;
  /** The template whose pages the viewer is on (`templateIdFromPath`). */
  current: string | null;
  /** What was typed, normalized (`normalizePaletteQuery`). */
  query: string;
}

export interface PaletteCache {
  readonly viewerId: string;
  /** By `paletteAskKey`, oldest first. */
  readonly answers: ReadonlyMap<string, PaletteResults>;
}

/** Answers kept at most; the oldest go first. */
export const PALETTE_CACHE_SIZE = 50;

export function paletteAskKey(ask: PaletteAsk): string {
  return JSON.stringify([ask.viewerId, ask.space, ask.current, ask.query]);
}

export function emptyPaletteCache(viewerId: string): PaletteCache {
  return { viewerId, answers: new Map() };
}

/** The cache with `results` filed under `ask`; the same cache when the question or the answer is somebody else's. */
export function withAnswer(cache: PaletteCache, ask: PaletteAsk, results: PaletteResults): PaletteCache {
  if (ask.viewerId !== cache.viewerId || results.viewerId !== cache.viewerId) return cache;
  const key = paletteAskKey(ask);
  const answers = new Map(cache.answers);
  answers.delete(key);
  answers.set(key, results);
  for (const oldest of answers.keys()) {
    if (answers.size <= PALETTE_CACHE_SIZE) break;
    answers.delete(oldest);
  }
  return { viewerId: cache.viewerId, answers };
}

/**
 * What the palette can show for `ask` now: its own answer (`exact`), or else the answer to the longest
 * search that what was typed extends ("bal" while "bala" is asked), which the palette narrows to what
 * was typed. Every match of the longer search is a match of the shorter one. Null when there's neither,
 * or when `ask` is another viewer's.
 */
export function nearestAnswer(cache: PaletteCache, ask: PaletteAsk): { results: PaletteResults; exact: boolean } | null {
  if (ask.viewerId !== cache.viewerId) return null;
  const exact = cache.answers.get(paletteAskKey(ask));
  if (exact) return { results: exact, exact: true };
  for (let length = ask.query.length - 1; length >= 0; length--) {
    const shorter = ask.query.slice(0, length);
    if (normalizePaletteQuery(shorter) !== shorter) continue; // "cash " is "cash", asked one step later
    const results = cache.answers.get(paletteAskKey({ ...ask, query: shorter }));
    if (results) return { results, exact: false };
  }
  return null;
}
