"use client";

import { cn } from "@/lib/utils";

/*
 * Small pieces for the simulated system. They read the --s-* palette that each variant sets on its
 * root, so a variant changes colour, type and corners in one place and spends its effort on structure.
 * Raw colour values are fine here: this is Coral's look, deliberately not UCOMP's.
 */

export type PillTone = "ok" | "bad" | "warn" | "info" | "plain";

const PILL: Record<PillTone, string> = {
  ok: "bg-(--s-ok-bg) text-(--s-ok)",
  bad: "bg-(--s-bad-bg) text-(--s-bad)",
  warn: "bg-(--s-warn-bg) text-(--s-warn)",
  info: "bg-(--s-info-bg) text-(--s-info)",
  plain: "bg-(--s-panel2) text-(--s-muted)",
};

export function Pill({ tone = "plain", children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-(--s-rs) px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Btn({
  kind = "secondary",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-(--s-rb) px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        kind === "primary" && "bg-(--s-accent) text-(--s-accent-text) hover:brightness-110",
        kind === "secondary" && "border border-(--s-line) bg-(--s-panel) text-(--s-text) hover:bg-(--s-panel2)",
        kind === "ghost" && "text-(--s-muted) hover:bg-(--s-panel2) hover:text-(--s-text)",
        kind === "danger" && "border border-(--s-bad) text-(--s-bad) hover:bg-(--s-bad-bg)",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-(family-name:--s-mono) text-[12px]", className)}>{children}</span>;
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 w-fit items-center rounded-(--s-rb) border border-(--s-line) bg-(--s-panel2) p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 cursor-pointer rounded-[calc(var(--s-rb)-2px)] px-2.5 text-[12px] font-medium transition-colors",
            o.value === value ? "bg-(--s-panel) text-(--s-text) shadow-[0_0_0_1px_var(--s-line)]" : "text-(--s-muted) hover:text-(--s-text)",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border",
        on ? "border-(--s-accent) bg-(--s-accent) text-(--s-accent-text)" : "border-(--s-line) bg-(--s-panel)",
      )}
    >
      {on ? (
        <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5 5 9l4.5-5.5" />
        </svg>
      ) : null}
    </button>
  );
}

export function FieldSelect({
  value,
  onChange,
  options,
  invalid,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  invalid?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full max-w-[16rem] cursor-pointer rounded-(--s-rb) border bg-(--s-panel) px-2 font-(family-name:--s-mono) text-[12px] text-(--s-text)",
        invalid ? "border-(--s-bad)" : "border-(--s-line)",
      )}
    >
      <option value="">Choose a field…</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function Dot({ tone }: { tone: "ok" | "bad" | "warn" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 rounded-full", tone === "ok" && "bg-(--s-ok)", tone === "bad" && "bg-(--s-bad)", tone === "warn" && "bg-(--s-warn)")}
    />
  );
}
