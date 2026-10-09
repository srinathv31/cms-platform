import { useCallback, useEffect, useRef, useState } from "react";

// Copying text: one way to put it on the clipboard, and one way to confirm it got there. Browser only.

/**
 * Puts `text` on the clipboard and says whether it got there. The async Clipboard API first; where that
 * is unavailable (an insecure context, a denied permission), a hidden textarea and `execCommand("copy")`.
 * Focus goes back where it was, so a copy from a dialog leaves focus on the button that made it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyThroughTextarea(text);
  }
}

function copyThroughTextarea(text: string): boolean {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  try {
    el.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    el.remove();
    focused?.focus({ preventScroll: true });
  }
}

/** How long a copy's confirmation (a check mark, "Copied") shows. */
const CONFIRM_MS = 1600;

/**
 * `copy(text)` copies and resolves to whether it got there; `copied` is then true for `confirmMs`, the
 * time the confirmation shows. A failed copy confirms nothing (the Copilot prompt then says so and
 * selects the text). `reset()` takes the confirmation down early.
 */
export function useCopy(confirmMs: number = CONFIRM_MS) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setCopied(false);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      clearTimeout(timer.current);
      setCopied(ok);
      if (ok) timer.current = setTimeout(() => setCopied(false), confirmMs);
      return ok;
    },
    [confirmMs],
  );

  return { copied, copy, reset };
}
