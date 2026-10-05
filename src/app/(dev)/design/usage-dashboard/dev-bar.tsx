"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ScopeId, VariantId } from "./data";

/* Dev chrome only. Dashed, tinted, tagged "DEV": nothing here is part of the design. */

function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-[12px] text-text-muted">{label}</span>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={(next) => {
          const picked = next[0] as T | undefined;
          if (picked) onChange(picked);
        }}
        variant="outline"
        size="sm"
        spacing={0}
        className="bg-surface"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="h-6 min-w-0 px-2.5 text-[12px] aria-pressed:bg-text aria-pressed:text-surface">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function DevBar({ scope, onScope, variant, onVariant, onReset }: { scope: ScopeId; onScope: (v: ScopeId) => void; variant: VariantId; onVariant: (v: VariantId) => void; onReset: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4">
      <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
      <Choice label="Scope" value={scope} onChange={onScope} options={[{ value: "team", label: "Team dashboard" }, { value: "template", label: "Template tab" }]} />
      {scope === "team" ? (
        <Choice label="Variant" value={variant} onChange={onVariant} options={[{ value: "a", label: "A · Insights" }, { value: "b", label: "B · Table first" }, { value: "c", label: "C · Over time" }]} />
      ) : null}
      <Button variant="outline" size="sm" className="shrink-0 bg-surface text-[12px]" onClick={onReset}>Reset</Button>
    </div>
  );
}
