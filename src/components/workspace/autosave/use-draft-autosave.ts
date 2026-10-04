"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createAutosave, type SaveFields, type SaveStatus } from "./autosave-scheduler";
import { newSessionKey } from "./session-key";
import { createFetchSend } from "./save-transport";

export interface UseDraftAutosaveOptions {
  /** Read once, with `initialRev`. To autosave a different version, remount with a new `key`. */
  versionId: string;
  /** The version's `rev` when the page loaded. */
  initialRev: number;
  /** Read-only mode: changes are ignored and nothing is sent. */
  disabled?: boolean;
}

export interface DraftAutosave {
  status: SaveStatus;
  /** A short message for the author when `status` is "error". */
  error?: string;
  /** Records changed fields. Call it from the editor's `onChange`, `onVariablesChange` and the name field. */
  save: (fields: SaveFields) => void;
  /** Sends whatever is pending now. Resolves once it is saved or has failed. */
  flush: () => Promise<void>;
}

/**
 * Autosave for the draft on screen: debounced `PUT /api/drafts/[versionId]`, one request at a time,
 * flushed when the tab is hidden, the page is closing or the component is hidden or unmounted.
 * The scheduling lives in `autosave-scheduler.ts`; this is the React and browser wiring.
 */
export function useDraftAutosave({ versionId, initialRev, disabled = false }: UseDraftAutosaveOptions): DraftAutosave {
  const [autosave] = useState(() =>
    createAutosave({
      initialRev,
      disabled,
      sessionKey: newSessionKey(), // one per mount; the scheduler starts another after a 30 minute gap
      newSessionKey,
      send: createFetchSend(versionId),
    }),
  );

  const state = useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);

  useEffect(() => {
    autosave.setDisabled(disabled);
  }, [autosave, disabled]);

  // Leaving: a hidden tab, a closing page, going offline and back, and the effect cleanup. Next keeps
  // the previous route mounted but hidden (<Activity>) and runs cleanups when it hides, so the cleanup
  // is the "navigated away" flush. `keepalive` lets the request outlive the page.
  useEffect(() => {
    const flushLeaving = () => void autosave.flush({ keepalive: true });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushLeaving();
    };
    const onOnline = () => void autosave.flush();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushLeaving);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushLeaving);
      window.removeEventListener("online", onOnline);
      flushLeaving();
    };
  }, [autosave]);

  return { status: state.status, error: state.error, save: autosave.save, flush: autosave.flush };
}
