"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { INACTIVE_FLAG_DAYS, INACTIVE_SUSPEND_DAYS, PEOPLE, type Stage } from "./data";

/** A 32px native select in the house control style. */
export function Pick<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 w-full appearance-none rounded-lg border border-hairline bg-surface pr-7 pl-2.5 text-[14px] text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-text-muted" />
    </span>
  );
}

/** Days idle against the 120-day line, with the 90-day flag marked. */
export function IdleTrack({ days }: { days: number }) {
  const pct = Math.min(100, (days / INACTIVE_SUSPEND_DAYS) * 100);
  const flag = (INACTIVE_FLAG_DAYS / INACTIVE_SUSPEND_DAYS) * 100;
  return (
    <div className="min-w-28">
      <div className="text-[14px] text-text">{days} days</div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-selected" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        <span className="absolute top-[-3px] h-3 w-px bg-text-muted" style={{ left: `${flag}%` }} />
      </div>
    </div>
  );
}

export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-selected", className)} aria-hidden>
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Reviewers({ ids }: { ids: string[] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex -space-x-1.5">
        {ids.map((id) => (
          <UserAvatar key={id} initials={PEOPLE[id]!.initials} hue={PEOPLE[id]!.hue} size="sm" className="ring-2 ring-surface" />
        ))}
      </span>
      <span>{ids.map((id) => PEOPLE[id]!.name).join(", ")}</span>
    </span>
  );
}

/** Submitted, each stage, then Active. `ghost` marks the stage being proposed. */
export function ChainFlow({ stages, ghost }: { stages: Pick<Stage, "id" | "name">[]; ghost?: string }) {
  const nodes = [
    { id: "draft", name: "Submitted", edge: true },
    ...stages.map((s) => ({ ...s, edge: false })),
    { id: "active", name: "Active", edge: true },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {nodes.map((n, i) => (
        <li key={n.id} className="flex items-center gap-1.5">
          {i > 0 ? <ArrowRight aria-hidden strokeWidth={1.75} className="size-3.5 text-text-muted" /> : null}
          <span
            className={cn(
              "rounded-md border px-2 py-1",
              n.edge ? "border-transparent text-text-muted" : "border-chip-border bg-chip text-chip-text",
              n.id === ghost && "border-dashed border-brand bg-brand-soft text-brand",
            )}
          >
            {n.name}
          </span>
        </li>
      ))}
    </ol>
  );
}
