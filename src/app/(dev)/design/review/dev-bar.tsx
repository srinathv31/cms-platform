"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ActionsAt, DialogId, PersonaId, StageCount, VariantId, ViewId } from "./types";

/* Dev chrome only. Dashed, tinted, tagged "DEV": nothing here is part of the design. */

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
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
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="h-6 min-w-0 px-2.5 text-[12px] aria-pressed:bg-text aria-pressed:text-surface"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function DevBar({
  variant,
  onVariant,
  persona,
  onPersona,
  stages,
  onStages,
  actions,
  onActions,
  view,
  onView,
  dialog,
  onDialog,
  onReplay,
  onReset,
}: {
  variant: VariantId;
  onVariant: (v: VariantId) => void;
  persona: PersonaId;
  onPersona: (v: PersonaId) => void;
  stages: StageCount;
  onStages: (v: StageCount) => void;
  actions: ActionsAt;
  onActions: (v: ActionsAt) => void;
  view: ViewId;
  onView: (v: ViewId) => void;
  dialog: DialogId;
  onDialog: (v: DialogId) => void;
  onReplay: () => void;
  onReset: () => void;
}) {
  return (
    <div
      data-rv-dev
      className="flex h-(--rv-dev-h) items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4"
    >
      <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
      <Choice
        label="Variant"
        value={variant}
        onChange={onVariant}
        options={[
          { value: "a", label: "A · Document first" },
          { value: "b", label: "B · Output first" },
        ]}
      />
      <Choice
        label="Persona"
        value={persona}
        onChange={onPersona}
        options={[
          { value: "jordan", label: "Jordan" },
          { value: "maya", label: "Maya" },
        ]}
      />
      <Choice
        label="Stages"
        value={String(stages) as "1" | "2"}
        onChange={(v) => onStages(v === "2" ? 2 : 1)}
        options={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
      />
      <Choice
        label="Actions"
        value={actions}
        onChange={onActions}
        options={[
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
        ]}
      />
      <Choice
        label="View"
        value={view}
        onChange={onView}
        options={[
          { value: "document", label: "Document" },
          { value: "redline", label: "Redline" },
          { value: "preview", label: "Preview" },
        ]}
      />
      <Choice
        label="Dialog"
        value={dialog}
        onChange={onDialog}
        options={[
          { value: "none", label: "None" },
          { value: "approve", label: "Approve" },
          { value: "request", label: "Request" },
        ]}
      />
      <Button variant="outline" size="sm" className="shrink-0 bg-surface text-[12px]" onClick={onReplay}>
        Replay go-live
      </Button>
      <Button variant="outline" size="sm" className="shrink-0 bg-surface text-[12px]" onClick={onReset}>
        Reset
      </Button>
    </div>
  );
}
