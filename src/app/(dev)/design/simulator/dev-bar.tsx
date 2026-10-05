"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SCENARIOS, SCREENS, type Scenario, type ScreenId, type VariantId, type ViewMode } from "./data";

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

export function DevBar({
  variant, onVariant, screen, onScreen, scenario, onScenario, view, onView, onReset,
}: {
  variant: VariantId; onVariant: (v: VariantId) => void;
  screen: ScreenId; onScreen: (v: ScreenId) => void;
  scenario: Scenario; onScenario: (v: Scenario) => void;
  view: ViewMode; onView: (v: ViewMode) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4">
      <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
      <Choice label="Variant" value={variant} onChange={onVariant} options={[{ value: "a", label: "A · Console" }, { value: "b", label: "B · Wizard" }, { value: "c", label: "C · Split" }]} />
      <Choice label="Screen" value={screen} onChange={onScreen} options={SCREENS.map((s) => ({ value: s.id, label: s.label }))} />
      <Choice label="Spring Travel" value={scenario} onChange={onScenario} options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))} />
      <Choice label="Customer" value={view} onChange={onView} options={[{ value: "phone", label: "Phone" }, { value: "inbox", label: "Inbox" }, { value: "pdf", label: "PDF" }]} />
      <Button variant="outline" size="sm" className="shrink-0 bg-surface text-[12px]" onClick={onReset}>Reset</Button>
    </div>
  );
}
