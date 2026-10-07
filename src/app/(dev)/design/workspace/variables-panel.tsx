"use client";

import { useState } from "react";
import { Calendar, Check, DollarSign, Hash, MapPin, Percent, Plus, Type, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Variable, VariableType } from "@/editor/model/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/*
 * A static mock of the Variables panel: the real one is built elsewhere. It only has to be the
 * right size and weight so the page frame can be judged. Rows: type icon, label, mono key and
 * usage, required switch (a check mark when read-only). One muted unused row, a "New variable" row.
 */

const ICONS: Record<VariableType, LucideIcon> = {
  text: Type,
  currency: DollarSign,
  percent: Percent,
  date: Calendar,
  number: Hash,
  us_state: MapPin,
};

function Row({
  variable,
  uses,
  editable,
  required,
  onRequired,
}: {
  variable: Variable;
  uses: number;
  editable: boolean;
  required: boolean;
  onRequired: (next: boolean) => void;
}) {
  const Icon = ICONS[variable.type];
  const unused = uses === 0;
  return (
    <li
      className={cn(
        "-mx-2 grid grid-cols-[1.75rem_minmax(0,1fr)_2.5rem] items-center gap-x-2.5 rounded-lg px-2 py-2 hover:bg-hover",
        unused && "text-text-subtle",
      )}
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-md border border-chip-border bg-chip text-chip-icon",
          unused && "opacity-60",
        )}
      >
        <Icon aria-hidden strokeWidth={1.75} className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-[14px] leading-5", unused ? "text-text-muted" : "text-text")}>
          {variable.label}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] leading-4 text-text-subtle">
          <span className="truncate font-mono">{variable.key}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{unused ? "Unused" : `${uses} ${uses === 1 ? "use" : "uses"}`}</span>
        </span>
      </span>
      <span className="flex justify-end">
        {editable ? (
          <Switch
            size="sm"
            checked={required}
            onCheckedChange={onRequired}
            aria-label={`${variable.label} is required`}
          />
        ) : required ? (
          <Check aria-label="Required" strokeWidth={1.75} className="size-4 text-text" />
        ) : null}
      </span>
    </li>
  );
}

/**
 * `surface`:
 *  - "card"  tinted card on the canvas (rounded-2xl, hairline, no shadow)
 *  - "rail"  flush column, no box of its own (the layout draws the divider)
 *  - "float" white popover-weight card for the collapsed, overlaid state
 */
export function VariablesPanel({
  variables,
  uses,
  editable,
  surface = "card",
  className,
}: {
  variables: Variable[];
  uses: Record<string, number>;
  editable: boolean;
  surface?: "card" | "rail" | "float";
  className?: string;
}) {
  const [required, setRequired] = useState<Record<string, boolean>>({});
  const ordered = [...variables].sort((a, b) => Number((uses[a.key] ?? 0) === 0) - Number((uses[b.key] ?? 0) === 0));

  return (
    <section
      aria-label="Variables"
      className={cn(
        surface === "card" && "rounded-2xl border border-hairline bg-surface-tinted p-4",
        surface === "float" && "rounded-2xl border border-hairline bg-surface p-4 shadow-pop",
        className,
      )}
    >
      <header className="flex items-end justify-between pb-2">
        <h2 className="text-[15px] leading-6 font-medium text-text">
          Variables <span className="ml-1 font-normal text-text-muted">{variables.length}</span>
        </h2>
        <span className="caps-label pb-0.5">Required</span>
      </header>
      <ul className="flex flex-col">
        {ordered.map((variable) => (
          <Row
            key={variable.key}
            variable={variable}
            uses={uses[variable.key] ?? 0}
            editable={editable}
            required={required[variable.key] ?? variable.required}
            onRequired={(next) => setRequired((r) => ({ ...r, [variable.key]: next }))}
          />
        ))}
      </ul>
      {editable ? (
        <Button
          variant="ghost"
          size="lg"
          className="-mx-2 mt-1 w-[calc(100%+1rem)] justify-start gap-2.5 px-2 text-text-muted hover:text-text"
        >
          <span className="grid size-7 place-items-center rounded-md border border-dashed border-hairline-strong">
            <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
          </span>
          New variable
        </Button>
      ) : null}
    </section>
  );
}
