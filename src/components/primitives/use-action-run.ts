"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import type { Refused } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";

// Running a server action from the browser, the one way: in a transition, one request at a time, with
// the refusal's sentence to show. Every action answers an `ActionResult` (src/server/actions/kit.ts), so
// a refusal arrives as a value with its `code` and `reason`. A call that throws (the server couldn't be
// reached, or a bug) becomes a refusal with the code `failed` and the screen's own sentence. An action
// that redirects on success (Edit, New template) throws Next's redirect, which is handed back to Next.

/** The failure sentence a screen without its own uses. */
export const GENERIC_FAILURE = "Something went wrong. Try again.";

/**
 * Runs a server action (or an on-demand read) and answers its result. A thrown error becomes
 * `{ ok: false, code: "failed", reason: failure }`; Next's own control flow (`redirect()`) is rethrown.
 */
export async function runAction<T = Record<never, never>>(
  action: () => Promise<ActionResult<T>>,
  failure: string = GENERIC_FAILURE,
): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, code: "failed", reason: failure };
  }
}

export interface RunHandlers<T> {
  /** The server accepted it. */
  onOk?: (result: { ok: true } & T) => void;
  /** The server refused it, or the call failed. `error` already holds the reason. */
  onRefused?: (refused: Refused) => void;
}

/**
 * One server action at a time: `pending` while it runs (a transition, so the page keeps responding),
 * `error`, the last refusal's sentence (cleared when the next run starts), and a guarded `run` that
 * ignores a second call while one is out. `failure` is the screen's sentence for a call that throws.
 */
export function useActionRun(failure: string = GENERIC_FAILURE) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  /** Starts the action unless one is already out; says whether it started. */
  function run<T = Record<never, never>>(action: () => Promise<ActionResult<T>>, handlers: RunHandlers<T> = {}): boolean {
    if (sending.current) return false;
    sending.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await runAction(action, failure);
        if (result.ok) {
          handlers.onOk?.(result);
        } else {
          setError(result.reason);
          handlers.onRefused?.(result);
        }
      } finally {
        sending.current = false;
      }
    });
    return true;
  }

  return { pending, error, setError, run };
}
