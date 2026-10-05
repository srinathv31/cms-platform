"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/domain/review-types";

// The shell of the action dialogs (set or change a sunset, start and confirm a revoke, approve, request
// changes). One standard, so they all read and behave alike:
//   - 512px wide, 32px padding, never taller than the viewport (`100dvh`; the body scrolls, the footer stays);
//   - a title, a one-line description, then the body;
//   - a footer of an OUTLINE Cancel and the primary, with a refusal from the server beside them;
//   - no Close X: Esc and Cancel close it, and it stays open while the server works;
//   - ⌘Enter (Ctrl+Enter) presses the primary;
//   - a destructive primary is a solid red, stronger than Cancel.
//
// A refusal from the server shows in the footer; the dialog closes only on success. Nothing in the
// dialog is natively `disabled` while the server works (that would drop the focus to the page): the
// primary and Cancel are `aria-disabled` and their handlers are blocked, so focus stays where it was and
// Tab stays inside.

export const GENERIC_FAILURE = "Something went wrong. Try again.";

/** Runs a server action, turning a thrown error into the one generic message. */
export async function runAction(action: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await action();
  } catch {
    return { ok: false, reason: GENERIC_FAILURE };
  }
}

/**
 * The pending flag, the refusal reason and the submit function of one dialog. `submit` sends only
 * when `invalid` is null: a request we already know will be refused is not sent. While a request is
 * out, a second one is not started.
 */
export function useActionDialog(close: () => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  function submit(invalid: string | null, action: () => Promise<ActionResult>) {
    if (sending.current) return;
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    sending.current = true;
    start(async () => {
      try {
        const result = await runAction(action);
        if (result.ok) close();
        else setError(result.reason);
      } finally {
        sending.current = false;
      }
    });
  }

  return { pending, error, setError, submit };
}

/** What `disabled:` does for a native disabled button, for the `aria-disabled` one that stays focusable. */
const BLOCKED = "aria-disabled:opacity-50";

/**
 * The destructive variant is a pale tint, the weight of Cancel. A destructive primary is the solid
 * destructive token (white on `--destructive`), so it reads stronger than Cancel.
 */
export const DESTRUCTIVE_PRIMARY =
  "bg-destructive text-primary-foreground hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/30 dark:bg-destructive dark:hover:bg-destructive/90 aria-disabled:hover:bg-destructive";

export interface ActionPrimary {
  /** "Start revoke", "Set sunset": the verb, as the title's. */
  label: ReactNode;
  /**
   * Pressed with the button, or with ⌘Enter. While `blocked` it is the way to ask why: the caller
   * says what is missing (at the field, or through `submit(invalid, …)` in the footer).
   */
  onClick: () => void;
  /** Nothing to send yet: the button reads as disabled (`aria-disabled`), and pressing it only explains. */
  blocked?: boolean;
  /** A solid red primary (revoke): the action can't be undone from here. */
  destructive?: boolean;
}

export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  error,
  primary,
  initialFocus,
  focusCancel = false,
  finalFocus,
  onClosed,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line, under the title. */
  description: string;
  children?: ReactNode;
  error: string | null;
  primary: ActionPrimary;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Start on Cancel, the safe action (for a dialog that can't be undone). */
  focusCancel?: boolean;
  /** Where focus goes when the dialog closes. `null` is the control that opened it. */
  finalFocus?: () => HTMLElement | null;
  /** Runs once the dialog has closed (its exit finished): reset the form here. */
  onClosed?: () => void;
  /** The server is working: the dialog stays open until it answers. */
  busy: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);

  // The server answered with a refusal and focus has fallen to the page (it can, when the control that
  // had it was replaced meanwhile): put it back on the primary, so a second try is a keystroke away.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const active = document.activeElement;
    if (open && (!active || active === document.body)) primaryButton.current?.focus();
  }, [busy, open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.();
      }}
    >
      <ScrimDialogContent
        initialFocus={focusCancel ? cancel : initialFocus}
        finalFocus={finalFocus}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
          // A key pressed in a popover (the calendar) bubbles here through its portal: it isn't ours.
          if (!event.currentTarget.contains(event.target as Node)) return;
          event.preventDefault();
          if (!busy) primary.onClick();
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] flex-col rounded-3xl p-8 sm:max-w-lg"
      >
        <div className="shrink-0">
          <DialogTitle className="display-lg">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-[14px] leading-5 text-text-muted">{description}</DialogDescription>
        </div>
        {children ? (
          // The side padding (and the matching margin) leaves a focused field's ring inside the scroller's clip.
          <div className="mt-6 -mx-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-2 py-1">{children}</div>
        ) : null}
        <div className="mt-6 flex shrink-0 items-center gap-3">
          {/* Always in the row (empty until a refusal), so the reason is announced when it arrives. */}
          <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 text-danger-text">
            {error}
          </p>
          <DialogClose
            render={
              <Button
                ref={cancel}
                variant="outline"
                aria-disabled={busy || undefined}
                className={cn("bg-surface px-4", busy && "pointer-events-none opacity-50")}
              />
            }
          >
            Cancel
          </DialogClose>
          <Button
            ref={primaryButton}
            variant={primary.destructive ? "destructive" : "default"}
            aria-disabled={busy || primary.blocked || undefined}
            aria-busy={busy || undefined}
            className={cn("relative px-4", primary.destructive && DESTRUCTIVE_PRIMARY, primary.blocked && !busy && BLOCKED)}
            onClick={() => {
              if (!busy) primary.onClick();
            }}
          >
            <span className={cn("inline-flex items-center gap-1.5", busy && "invisible")}>{primary.label}</span>
            {busy ? <Spinner aria-hidden role="presentation" className="absolute size-3.5" /> : null}
          </Button>
        </div>
      </ScrimDialogContent>
    </Dialog>
  );
}

/** The consequences, in plain words, before the commitment. */
export function Consequences({ lines }: { lines: readonly string[] }) {
  return (
    <ul data-slot="consequences" className="flex flex-col gap-2 rounded-xl bg-surface-tinted px-4 py-3.5 text-[14px] leading-[1.55] text-text">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
