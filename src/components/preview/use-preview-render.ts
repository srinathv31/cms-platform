"use client";

// Keeps the preview's output current. One request in flight at a time: a newer one aborts the older
// (AbortController), and the last good output of each channel stays on screen until the next arrives.
//
// What re-renders it, while `enabled`:
//   - it turns on (the preview opens, or the rail comes back to its Preview view),
//   - the channel, the version or the values change (values are debounced: they arrive on every
//     keystroke in a sample set's editor, and they go in the request, so nothing waits for a save),
//   - a save lands (`saveTick`): the route renders the SAVED draft, so the body and the email fields
//     only reach the output through a save.
//
// A normal flow never sends a request the route will refuse (Chrome logs every 4xx as a console error):
//   - Before sending, the values are checked with the route's own `validateValues` against the live
//     variable list. A refusal is shown in the output as the route would word it, and nothing is sent.
//   - Every request waits for `session.flush()`. The route renders the SAVED draft, so a channel turned
//     on a moment ago, a new variable or an edited body must be saved before it can be asked for.
//     (`flush` resolves at once when nothing is pending.)
// The route can still disagree with the browser (a real 4xx or 5xx); that is shown as it comes.

import { useCallback, useEffect, useRef, useState } from "react";
import { assertNever } from "@/domain/assert-never";
import type { RenderError } from "@/domain/render/types";
import { validateValues } from "@/domain/render/validate";
import type { Channel, Variable, VariableValues } from "@/domain/types";
import type { WorkspaceSession } from "@/components/workspace/session/session-store";
import { renderPreview, type PreviewOutput } from "./render-preview";

/** Debounce for a values-only change (typing in a sample set). */
export const VALUES_DEBOUNCE_MS = 250;

export interface PreviewSlot {
  /** The last output that rendered. Kept while the next renders, and under an error. */
  output: PreviewOutput | null;
  /** The route's refusal of the latest render, until one succeeds. */
  error: RenderError | null;
}

export interface UsePreviewRenderOptions {
  templateId: string;
  version: "draft" | number;
  channel: Channel;
  values: VariableValues;
  /**
   * The version's variables as the editor has them now (live, ahead of the save). The values are
   * checked against them before anything is sent; only key, type and required are read.
   */
  variables: readonly Pick<Variable, "key" | "type" | "required">[];
  enabled: boolean;
  /** Changes whenever a save has landed. */
  saveTick: number;
  /** The workspace session: `flush` before every request. */
  session: Pick<WorkspaceSession, "flush">;
}

export interface UsePreviewRender {
  /** The latest state per channel. */
  slots: Readonly<Partial<Record<Channel, PreviewSlot>>>;
  /** A render is on its way (the output on screen is about to change). */
  rendering: boolean;
  /** Renders again now. */
  retry: () => void;
}

export function usePreviewRender({
  templateId,
  version,
  channel,
  values,
  variables,
  enabled,
  saveTick,
  session,
}: UsePreviewRenderOptions): UsePreviewRender {
  const [slots, setSlots] = useState<Partial<Record<Channel, PreviewSlot>>>({});
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The values as one string: a stable dependency, and what "the values changed" compares. The
  // variables the same way, cut down to what validation reads.
  const valuesKey = JSON.stringify(values);
  const variablesKey = JSON.stringify(variables.map(({ key, type, required }) => ({ key, type, required })));

  const last = useRef<{ key: string; rest: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      last.current = null;
      return;
    }

    // Is it only the values that changed since the last render? Those wait a moment for more typing.
    const rest = JSON.stringify([templateId, version, channel, saveTick, attempt]);
    const valuesOnly = last.current !== null && last.current.rest === rest && last.current.key !== valuesKey;
    last.current = { key: valuesKey, rest };

    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      const sending = JSON.parse(valuesKey) as VariableValues;

      // The route would refuse these values: say so here, in its words, and send nothing.
      const checked = validateValues(JSON.parse(variablesKey) as Variable[], sending);
      if (!checked.ok) {
        setSlots((all) => ({ ...all, [channel]: { output: all[channel]?.output ?? null, error: checked.error } }));
        setPending(false);
        return;
      }

      setPending(true);
      try {
        // The route renders the saved draft: let anything pending (a channel just turned on, a new
        // variable) be saved first, so the request never asks for what isn't there yet.
        await session.flush();
        if (signal.aborted) return;

        const result = await renderPreview({ templateId, version, channel, values: sending, signal });

        if (result.kind === "error") {
          setSlots((all) => ({ ...all, [channel]: { output: all[channel]?.output ?? null, error: result.error } }));
        } else {
          setSlots((all) => {
            const before = all[channel];
            // The same output again keeps the object, so nothing downstream reloads for nothing.
            const output = before?.output && sameOutput(before.output, result) ? before.output : result;
            return { ...all, [channel]: { output, error: null } };
          });
        }
        setPending(false);
      } catch (error) {
        // An abort is a newer render replacing this one: it owns `pending` now.
        if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setPending(false);
      }
    }

    const timer = setTimeout(() => void run(), valuesOnly ? VALUES_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, templateId, version, channel, valuesKey, variablesKey, saveTick, attempt, session]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { slots, rendering: enabled && pending, retry };
}

/** Two renders of the same thing: equal text, or equal bytes. */
export function sameOutput(a: PreviewOutput, b: PreviewOutput): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "pdf": {
      const other = b as typeof a;
      return a.filename === other.filename && sameBytes(a.bytes, other.bytes);
    }
    case "web":
      return a.html === (b as typeof a).html;
    case "email": {
      const other = b as typeof a;
      return a.subject === other.subject && a.preheader === other.preheader && a.html === other.html;
    }
    case "push":
    case "sms":
      return JSON.stringify(a) === JSON.stringify(b);
    default:
      return assertNever(a, "preview output");
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
