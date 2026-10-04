"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { HeadsId, LayoutId, ViewId } from "./types";

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
    <div className="flex items-center gap-2">
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
  layout,
  onLayout,
  heads,
  onHeads,
  view,
  onView,
}: {
  layout: LayoutId;
  onLayout: (v: LayoutId) => void;
  heads: HeadsId;
  onHeads: (v: HeadsId) => void;
  view: ViewId;
  onView: (v: ViewId) => void;
}) {
  return (
    <div
      data-wm-dev
      className="flex h-(--wm-dev-h) items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4"
    >
      <span className="rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">
        DEV
      </span>
      <Choice
        label="Layout"
        value={layout}
        onChange={onLayout}
        options={[
          { value: "grid", label: "A · Grid" },
          { value: "column", label: "B · Column" },
          { value: "rail", label: "C · Rail" },
        ]}
      />
      <Choice
        label="Section heads"
        value={heads}
        onChange={onHeads}
        options={[
          { value: "serif", label: "Serif" },
          { value: "sans", label: "Sans" },
        ]}
      />
      <Choice
        label="State"
        value={view}
        onChange={onView}
        options={[
          { value: "draft", label: "Draft · Maya" },
          { value: "active", label: "Active · Maya" },
          { value: "view", label: "View only · Priya, Deposits" },
        ]}
      />
    </div>
  );
}
