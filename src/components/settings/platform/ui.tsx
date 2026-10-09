"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Person } from "@/domain/review-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/app-shell/user-avatar";

// The machinery the four Platform sections share (settings variant A): a dense table whose rows carry
// their actions inline, and a consequence strip (`Strip`, settings/strip.tsx) before anything is
// committed. The strip's confirm is the only black button on screen; everything that opens a strip is
// outline.


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

// ── Controls ─────────────────────────────────────────────────

/** A 32px native select in the house control style. `invalid` marks it like an invalid Input; `describedBy` names the reason. */
export function Pick({
  value,
  onChange,
  label,
  className,
  children,
  autoFocus,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  children: ReactNode;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-autofocus={autoFocus ? "" : undefined}
        className="h-8 w-full appearance-none rounded-lg border border-hairline bg-surface pr-7 pl-2.5 text-[14px] text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
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
