"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ChannelId, DeviceId, ModeId, VariantId } from "./types";

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
  mode,
  onMode,
  channel,
  onChannel,
  device,
  onDevice,
  setId,
  onSet,
}: {
  variant: VariantId;
  onVariant: (v: VariantId) => void;
  mode: ModeId;
  onMode: (v: ModeId) => void;
  channel: ChannelId;
  onChannel: (v: ChannelId) => void;
  device: DeviceId;
  onDevice: (v: DeviceId) => void;
  setId: string;
  onSet: (id: string) => void;
}) {
  return (
    <div
      data-pv-dev
      className="flex h-(--wm-dev-h) items-center gap-x-6 overflow-x-auto border-b border-dashed border-hairline-strong bg-surface-tinted px-4"
    >
      <span className="shrink-0 rounded-md bg-text px-1.5 py-0.5 text-[11px] font-medium tracking-wider text-surface">DEV</span>
      <Choice
        label="Variant"
        value={variant}
        onChange={onVariant}
        options={[
          { value: "a", label: "A · Controls in the rail" },
          { value: "b", label: "B · Preview replaces rail" },
          { value: "c", label: "C · Rail widens" },
        ]}
      />
      <Choice
        label="Mode"
        value={mode}
        onChange={onMode}
        options={[
          { value: "edit", label: "Edit" },
          { value: "preview", label: "Preview" },
        ]}
      />
      <Choice
        label="Channel"
        value={channel}
        onChange={onChannel}
        options={[
          { value: "pdf", label: "PDF" },
          { value: "web", label: "Web" },
          { value: "email", label: "Email" },
        ]}
      />
      <Choice
        label="Device"
        value={device}
        onChange={onDevice}
        options={[
          { value: "desktop", label: "Desktop" },
          { value: "mobile", label: "Mobile" },
        ]}
      />
      <Choice
        label="Set"
        value={setId}
        onChange={onSet}
        options={[
          { value: "typical", label: "Typical" },
          { value: "long", label: "Long" },
          { value: "minimum", label: "Minimum" },
        ]}
      />
    </div>
  );
}
