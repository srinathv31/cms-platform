"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/domain/review-types";
import { useActionRun } from "@/components/primitives/use-action-run";
import { Button } from "@/components/ui/button";

/**
 * The consequence strip every settings section (Team and Platform) shows before anything is committed:
 * what will happen, optional content (inputs, the Now / After cards), then Cancel and the confirm, which
 * is the only black button on screen. `consequence` is one line above the content; `lines` is a list
 * below it.
 *
 * By default focus goes to the first `data-autofocus` control or, with none, to Cancel (the safe
 * action), and Esc closes the strip and nothing else. A strip that appears while someone is typing
 * (`focusOnMount={false}`) leaves focus alone. The confirm runs the action through `useActionRun`: one
 * at a time, a refusal's sentence beside the buttons. It is `aria-disabled` while blocked or sending,
 * never natively disabled, so focus stays where it is.
 */
export function Strip({
  consequence,
  lines = [],
  children,
  confirmLabel,
  blocked = false,
  message,
  onConfirm,
  onCancel,
  onDone,
  focusOnMount = true,
  cancelLabel = "Cancel",
  className,
}: {
  consequence?: ReactNode;
  lines?: ReactNode[];
  children?: ReactNode;
  confirmLabel: string;
  /** The confirm can't run yet (a required note is empty, nothing to save). */
  blocked?: boolean;
  /** Said beside the buttons while it applies (the reason the confirm is blocked). */
  message?: string | null;
  onConfirm: () => Promise<ActionResult>;
  onCancel: () => void;
  /** Called once the server accepted the action. */
  onDone: () => void;
  focusOnMount?: boolean;
  cancelLabel?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { pending, error, run } = useActionRun();

  useEffect(() => {
    if (!focusOnMount) return;
    const el = root.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("[data-cancel]");
    target?.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, [focusOnMount]);

  const shown = error ?? (blocked ? message : null);

  return (
    <div
      ref={root}
      data-slot="consequence-strip"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !focusOnMount) return;
        e.stopPropagation();
        if (!pending) onCancel();
      }}
      className={cn("flex flex-col gap-3 rounded-lg bg-surface-sunken p-4", className)}
    >
      {consequence !== undefined ? <p className="text-[14px] leading-relaxed text-text">{consequence}</p> : null}
      {children}
      {lines.length ? (
        <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-text">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {shown ? (
          <p role={error ? "alert" : undefined} className={cn("mr-auto text-[13px]", error ? "text-danger-text" : "text-text-muted")}>
            {shown}
          </p>
        ) : null}
        <Button data-cancel variant="ghost" aria-disabled={pending} onClick={() => (pending ? undefined : onCancel())}>
          {cancelLabel}
        </Button>
        <Button
          aria-disabled={blocked || pending}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (blocked || pending) return;
            run(onConfirm, { onOk: onDone });
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
