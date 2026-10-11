"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isOutputKey, type OutputKey } from "@/domain/review-outputs";

/**
 * The outputs this approver has had rendered on screen in the Preview for one round (decision 0037): a PDF
 * once pdf.js has drawn it, Web and Email once their render came back, Push on each phone and SMS once the
 * browser rendered them. A failed render never counts. Approve asks `outputsRefusal` about this set, and the
 * approval sends it for the server to check and record.
 *
 * Kept per viewer, version id and round in sessionStorage, so a reload in the same tab doesn't make the
 * approver start over; another tab, a new round, or another persona in this tab (the demo's persona switch)
 * starts empty. Storage can be off or full: every read and write is in try/catch, and the set is also held
 * in memory for the page's life, so viewing still works without it.
 * The server renders with nothing viewed (Approve blocked); the stored set arrives as the page hydrates.
 */

const PREFIX = "ucomp:viewed-outputs:";
const NONE: readonly OutputKey[] = [];

/** The set per storage key, as read or written this page load: the snapshot, the same array until it changes. */
const held = new Map<string, readonly OutputKey[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(key: string): readonly OutputKey[] {
  const known = held.get(key);
  if (known) return known;
  let stored: readonly OutputKey[] = NONE;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
    if (Array.isArray(parsed)) {
      stored = parsed.filter((value): value is OutputKey => typeof value === "string" && isOutputKey(value));
    }
  } catch {
    // Storage off, or not ours to read: start from nothing.
  }
  held.set(key, stored);
  return stored;
}

function add(key: string, output: OutputKey) {
  const now = read(key);
  if (now.includes(output)) return;
  const next = [...now, output];
  held.set(key, next);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage off or full: the set lasts as long as the page.
  }
  for (const listener of listeners) listener();
}

export function useViewedOutputs(viewerId: string, versionId: string, round: number) {
  const key = `${PREFIX}${viewerId}:${versionId}:${round}`;
  const viewed = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => NONE,
  );
  /** An output rendered on screen. */
  const onViewed = useCallback((output: OutputKey) => add(key, output), [key]);
  return { viewed, onViewed };
}
