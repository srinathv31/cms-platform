// The autosave state machine. Plain TypeScript: no React, no fetch, no DOM. The hook wires it to
// React and the transport wires it to the network; the tests drive it with fake timers.
//
// Rules:
//   - Changes merge into one pending patch; a later value for a field replaces an earlier one.
//   - A save goes out 800 ms after the last change, or 5 s after the first unsaved change if the
//     author keeps typing (the max wait).
//   - One request at a time. Changes made while one is out wait for the next.
//   - The rev is the one the server last returned.
//   - A network or server failure retries with backoff, a few times, then shows an error. The next
//     change starts over.
//   - A new editing session starts (a new session key, so a new audit row) when the last saved
//     change is more than 30 minutes old.
//   - `conflict`, `forbidden`, `not_draft` and `not_found` stop saving for good: retrying cannot
//     fix them, and a conflict must never be overwritten silently. `invalid` waits for the next change.

import type { DraftPatch, DraftSaveError, DraftSaveResponse } from "@/domain/types";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

/** The fields of a draft that changed. Whatever is missing is left as it is on the server. */
export type SaveFields = Omit<DraftPatch, "rev" | "sessionKey">;

export interface AutosaveState {
  status: SaveStatus;
  /** A short message for the author, set when `status` is "error". */
  error?: string;
}

export interface SendOptions {
  /** The page may be going away: send in a way that survives it, if the request is small enough. */
  keepalive: boolean;
}

/**
 * Sends one patch. Resolves with the server's answer, whatever it is. Rejects when there is no
 * usable answer (network down, a 5xx, a reply that isn't JSON); the scheduler retries those.
 */
export type Send = (patch: DraftPatch, options: SendOptions) => Promise<DraftSaveResponse>;

export interface AutosaveOptions {
  initialRev: number;
  /** The key of the first editing session. */
  sessionKey: string;
  /**
   * Makes the key for the next session. When it is given, a save made more than `sessionGapMs`
   * after the last saved one starts a new session, because the audit log merges saves into one row
   * only while the gaps between them stay under 30 minutes.
   */
  newSessionKey?: () => string;
  send: Send;
  /** Start disabled (read-only). Change it later with `setDisabled`. */
  disabled?: boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  /** The wait before each retry after a transient failure. Its length is the number of retries. */
  retryDelaysMs?: readonly number[];
  /** Longest gap between saves inside one editing session. Default 30 minutes. */
  sessionGapMs?: number;
  /** A request with no answer by then counts as a transient failure, so a hung one can't block saving. */
  requestTimeoutMs?: number;
}

export interface Autosave {
  getState(): AutosaveState;
  subscribe(listener: () => void): () => void;
  /** Records changed fields. Later values win per field. */
  save(fields: SaveFields): void;
  /** Sends everything pending now and resolves once it is saved or has failed. */
  flush(options?: { keepalive?: boolean }): Promise<void>;
  /** A disabled autosave ignores changes and drops what it holds (read-only mode). */
  setDisabled(disabled: boolean): void;
}

export const DEFAULT_DEBOUNCE_MS = 800;
export const DEFAULT_MAX_WAIT_MS = 5_000;
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000];
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_SESSION_GAP_MS = 30 * 60_000;

export const RETRYING = "Not saved. Retrying…";
export const OFFLINE = "Not saved. Check your connection.";

/** What the author reads for each refusal that cannot be retried. */
export function failureMessage(error: DraftSaveError, serverMessage: string): string {
  switch (error) {
    case "conflict":
      return "Not saved — this draft changed elsewhere. Reload to continue.";
    case "forbidden":
      return "Not saved — you can no longer edit this draft.";
    case "not_draft":
      return "Not saved — this version is no longer a draft. Reload to continue.";
    case "not_found":
      return "Not saved — this draft no longer exists.";
    case "invalid":
      return `Not saved. ${serverMessage}`;
  }
}

/** `base` with every defined field of `next` laid over it. */
export function mergeFields(base: SaveFields | null, next: SaveFields): SaveFields {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as SaveFields;
}

function hasFields(fields: SaveFields): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const sessionGapMs = options.sessionGapMs ?? DEFAULT_SESSION_GAP_MS;

  let rev = options.initialRev;
  let sessionKey = options.sessionKey;
  // When the session last saved. null before its first save, and after a request whose outcome we
  // don't know: that save may have landed, and the server only accepts a resend (see the lost
  // response rule in apply-patch.ts) under the same key.
  let lastSavedAt: number | null = null;
  let pending: SaveFields | null = null;
  let firstChangeAt = 0; // when the oldest unsaved change was made
  let lastChangeAt = 0;
  let inflight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerKind: "debounce" | "retry" | null = null;
  let failures = 0; // consecutive transient failures
  let stopped = false; // the server refused in a way retrying can't fix
  let disabled = options.disabled ?? false;
  let error: string | null = null;

  let state: AutosaveState = { status: "saved" };
  const listeners = new Set<() => void>();

  function emit() {
    const status: SaveStatus = error ? "error" : inflight ? "saving" : pending ? "unsaved" : "saved";
    const message = error ?? undefined;
    if (status === state.status && message === state.error) return;
    state = message === undefined ? { status } : { status, error: message };
    for (const listener of [...listeners]) listener();
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    timerKind = null;
  }

  function startTimer(kind: "debounce" | "retry", delay: number) {
    clearTimer();
    timerKind = kind;
    timer = setTimeout(() => {
      clearTimer();
      void send(false);
    }, delay);
  }

  /** Arms the debounce timer for whatever is pending. A retry wait in progress is left alone. */
  function schedule() {
    if (disabled || stopped || inflight || !pending || timerKind === "retry") return;
    const due = Math.min(lastChangeAt + debounceMs, firstChangeAt + maxWaitMs);
    startTimer("debounce", Math.max(0, due - Date.now()));
  }

  /** Puts fields that didn't get saved back under anything newer. */
  function restore(fields: SaveFields, since: number) {
    firstChangeAt = pending ? Math.min(since, firstChangeAt) : since;
    pending = { ...fields, ...pending };
  }

  function settle(response: DraftSaveResponse | null, fields: SaveFields, since: number) {
    if (response === null) {
      restore(fields, since);
      lastSavedAt = null;
      failures += 1;
      if (failures <= retryDelaysMs.length) {
        error = RETRYING;
        startTimer("retry", retryDelaysMs[failures - 1]!);
      } else {
        error = OFFLINE;
      }
    } else if (response.ok) {
      rev = response.rev;
      lastSavedAt = Date.now();
      failures = 0;
      error = null;
      schedule();
    } else {
      // The answer is final for these fields: keep them, but don't resend until the author changes something.
      restore(fields, since);
      failures = 0;
      error = failureMessage(response.error, response.message);
      if (response.error !== "invalid") {
        stopped = true;
        clearTimer();
      }
    }
    emit();
  }

  function send(keepalive: boolean): Promise<void> {
    if (inflight) return inflight;
    if (!pending || disabled || stopped) return Promise.resolve();

    clearTimer();
    const fields = pending;
    const since = firstChangeAt;
    pending = null;
    // While retrying, keep showing the error rather than flickering to "Saving…".
    if (failures === 0) error = null;

    const sentAt = Date.now();
    if (options.newSessionKey && lastSavedAt !== null && sentAt - lastSavedAt > sessionGapMs) {
      sessionKey = options.newSessionKey();
      lastSavedAt = sentAt;
    }

    const patch: DraftPatch = { ...fields, rev, sessionKey };
    // `async` turns a synchronous throw from `send` into a rejection like any other.
    const request = (async () => options.send(patch, { keepalive }))();
    inflight = new Promise<DraftSaveResponse | null>((resolve) => {
      const giveUp = setTimeout(() => resolve(null), requestTimeoutMs);
      request
        .then(
          (response) => response,
          () => null,
        )
        .then((response) => {
          clearTimeout(giveUp);
          resolve(response);
        });
    }).then((response) => {
      inflight = null;
      settle(response, fields, since);
    });
    emit();
    return inflight;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    save(fields) {
      if (disabled || stopped || !hasFields(fields)) return;
      const now = Date.now();
      if (!pending) firstChangeAt = now;
      lastChangeAt = now;
      pending = mergeFields(pending, fields);

      if (timerKind !== "retry") {
        // Typing after a failure starts a fresh round of attempts.
        if (error) {
          error = null;
          failures = 0;
        }
        schedule();
      }
      emit();
    },

    async flush({ keepalive = false } = {}) {
      if (disabled || stopped) return;
      clearTimer();
      failures = 0;
      for (;;) {
        if (inflight) await inflight;
        else if (pending) await send(keepalive);
        else return;
        if (error || disabled || stopped) return;
      }
    },

    setDisabled(next) {
      if (disabled === next) return;
      disabled = next;
      if (next) {
        clearTimer();
        pending = null;
        error = null;
        failures = 0;
      }
      emit();
    },
  };
}
