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
  /** The server refused in a way retrying can't fix: nothing more is saved, and what is pending is lost. */
  stopped: boolean;
  /** Records changed fields. Call it from the editor's `onChange`, `onVariablesChange` and the name field. */
  save: (fields: SaveFields) => void;
  /** Sends whatever is pending now. Resolves once it is saved or has failed. */
  flush: () => Promise<void>;
}

/**
 * Autosave for the draft on screen: debounced `PUT /api/drafts/[versionId]`, one request at a time,
 * flushed when the tab is hidden, the page is closing or the component is hidden or unmounted.
 * While anything typed isn't saved, closing or reloading the page asks first (`beforeunload`).
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
  const unsaved = state.status !== "saved";

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

  // Closing or reloading the page while something typed isn't saved asks first: waiting to save,
  // saving, retrying, or refused for good (the page is still there to copy from). A browser may cancel
  // a request the page doesn't outlive, and a large draft's can't go out with `keepalive`
  // (save-transport.ts), so the prompt is what keeps those last edits. It sends them as it asks, so
  // staying is enough. Registered only while unsaved: a saved page leaves without a word.
  useEffect(() => {
    if (!unsaved) return;
    const guard = (event: BeforeUnloadEvent) => {
      void autosave.flush({ keepalive: true });
      event.preventDefault();
      // Older browsers (Chrome before 119) prompt only when this is set.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [autosave, unsaved]);

  return {
    status: state.status,
    error: state.error,
    stopped: state.stopped ?? false,
    save: autosave.save,
    flush: autosave.flush,
  };
}
