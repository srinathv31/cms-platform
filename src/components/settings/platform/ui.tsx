"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { runAction } from "@/components/versions/action-dialog";

// The machinery the four Platform sections share (settings variant A): a dense table whose rows carry
// their actions inline, and a consequence strip before anything is committed. The strip's confirm is
// the only black button on screen; everything that opens a strip is outline.

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Running an action ────────────────────────────────────────

/** One server action at a time: the pending flag, the refusal sentence and a guarded `run`. */
export function useActionRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await runAction(action);
        if (result.ok) onOk?.();
        else setError(result.reason);
      } finally {
        sending.current = false;
      }
    });
  }

  return { pending, error, setError, run };
}

// ── Returning focus ──────────────────────────────────────────

/**
 * Focus an element as soon as the next commit lands (before paint). Closing a strip removes the focused
 * control; the dialog's focus manager then pulls focus to the dialog a frame later, so a
 * requestAnimationFrame refocus loses that race. Focusing in the commit means focus is never lost.
 */
export function useFocusAfterCommit() {
  const pending = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useLayoutEffect(() => {
    const get = pending.current;
    if (!get) return;
    pending.current = null;
    get()?.focus();
  });
  return (get: () => HTMLElement | null | undefined) => {
    pending.current = get;
  };
}

// ── The consequence strip ────────────────────────────────────

/**
 * What will happen, optional content (the Now / After cards, inputs), then Cancel and the confirm.
 * By default focus goes to the first `data-autofocus` control or, with none, to Cancel (the safe
 * action), and Esc closes the strip and nothing else. A strip that appears while someone is typing
 * (`focusOnMount={false}`) leaves focus alone. The confirm is `aria-disabled` while blocked or sending,
 * never natively disabled, so focus stays where it is.
 */
export function Strip({
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
  lines?: ReactNode[];
  children?: ReactNode;
  confirmLabel: string;
  /** The confirm can't run yet. */
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
            run(onConfirm, onDone);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────

/** A 32px native select in the house control style. */
export function Pick({
  value,
  onChange,
  label,
  className,
  children,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  children: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-autofocus={autoFocus ? "" : undefined}
        className="h-8 w-full appearance-none rounded-lg border border-hairline bg-surface pr-7 pl-2.5 text-[14px] text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </select>
      <ChevronDown aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-text-muted" />
    </span>
  );
}

/** An explanation at a control that can't be used right now (a few words, on hover and focus). */
export function Blocked({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function PersonLine({ person, className }: { person: Person; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <UserAvatar initials={person.initials} hue={person.hue} size="sm" />
      <span className="truncate">{person.name}</span>
    </span>
  );
}

/**
 * A row's strip or editor, inside the table's rowgroup: one row with one cell spanning every column, so
 * the table's structure stays valid for assistive tech.
 */
export function FullRow({ span, className, children }: { span: number; className?: string; children: ReactNode }) {
  return (
    <div role="row" className={className}>
      <div role="cell" aria-colspan={span}>
        {children}
      </div>
    </div>
  );
}

/** The caps-label header row of a section's table. */
export function HeaderRow({ columns, cols }: { columns: (string | null)[]; cols: string }) {
  return (
    <div role="row" className="grid items-end gap-x-4 border-b border-hairline pb-2" style={{ gridTemplateColumns: cols }}>
      {columns.map((label, i) =>
        label ? (
          <span role="columnheader" key={label} className="caps-label">
            {label}
          </span>
        ) : (
          <span role="columnheader" key={i}>
            <span className="sr-only">Actions</span>
          </span>
        ),
      )}
    </div>
  );
}
