// "Open New template when the Library arrives": the ⌘K palette's New template and Import actions
// navigate to the space's Library and leave an intent here; the Library's New template dialog takes it
// when it mounts (or at once, if it is already on screen). Module state shared by client components
// in one tab, so nothing goes in the URL (as with just-created.ts). One-shot, and stale after 10 s
// so an intent never fires on some later, unrelated visit.

import type { LibraryIntent } from "@/domain/import-types";

const STALE_MS = 10_000;

let pending: { intent: LibraryIntent; space: string; at: number } | null = null;
const listeners = new Set<() => void>();

/** Asks the Library of `space` to open New template (`import`: and focus its Import row). */
export function requestLibraryIntent(intent: LibraryIntent, space: string): void {
  pending = { intent, space, at: Date.now() };
  for (const listener of listeners) listener();
}

/** The waiting intent for this space, taken (cleared) as it is read; null when there is none. */
export function takeLibraryIntent(space: string): LibraryIntent | null {
  const found = pending;
  if (!found || found.space !== space) return null;
  pending = null;
  return Date.now() - found.at <= STALE_MS ? found.intent : null;
}

/** Called when an intent is requested while the Library is already mounted. Returns the unsubscribe. */
export function subscribeLibraryIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
