/**
 * The rules for where the canvas scrolls when the page in it changes. Pure, so they can be tested
 * without a browser; canvas-scroll.tsx applies them.
 *
 * Positions are kept per history entry, by the entry's `key` (from the Navigation API). The key is
 * the entry's slot in the history list: a push makes a new one, going back or forward returns to an
 * old one, and a replace keeps it. That is the whole distinction we need:
 *
 *  - a push to another page: a new key, nothing saved, so the page opens at the top;
 *  - back or forward: a key we have seen, so the page opens where that entry was left;
 *  - a replace to another page (a redirect, `router.replace`): the same key as the page it
 *    replaces, so it is a new page and opens at the top.
 */

/** Scroll offsets by history entry key. */
export type SavedPositions = Map<string, number>;

/**
 * Where the canvas goes when the page changes.
 *
 * @param previousKey The entry key the page we are leaving was shown for. `null` before the first
 *   page change.
 * @param key The entry key the new page is shown for. `null` when the browser has no Navigation
 *   API: nothing can be restored then, so every page opens at the top.
 */
export function scrollTargetOnPageChange(
  previousKey: string | null,
  key: string | null,
  saved: ReadonlyMap<string, number>,
): number {
  if (key === null || key === previousKey) return 0;
  return saved.get(key) ?? 0;
}

/**
 * Forgets entries that are no longer in the history list (the browser drops forward entries when you
 * push from the middle, and caps the list), so the map cannot grow without bound.
 */
export function pruneSavedPositions(saved: SavedPositions, liveKeys: Iterable<string>): void {
  const live = new Set(liveKeys);
  for (const key of saved.keys()) {
    if (!live.has(key)) saved.delete(key);
  }
}
