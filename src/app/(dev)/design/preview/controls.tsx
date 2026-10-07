"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  Globe,
  Mail,
  Monitor,
  Pencil,
  Plus,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import type { Variable } from "@/editor/model/types";
import { validateValue } from "@/editor/model/variables";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VARIABLES } from "./fixtures";
import type { ChannelId, DeviceId, PreviewControls, PreviewSet } from "./types";

/*
 * The preview controls, as pieces. A variant decides where they sit: in the rail (A), in one slim
 * toolbar on top of the output (B, and every variant below the rail's breakpoint), or in a controls
 * row under the Preview | Variables switch (C). What each piece looks like is the same everywhere.
 */

const CHANNEL_META: Record<ChannelId, { label: string; Icon: LucideIcon }> = {
  pdf: { label: "PDF", Icon: FileText },
  web: { label: "Web", Icon: Globe },
  email: { label: "Email", Icon: Mail },
};

const SEG_ITEM =
  "h-7 min-w-0 gap-1.5 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text [&_svg]:size-3.5";

// ── Channel ──────────────────────────────────────────────────────

/** Which channel's output is on screen. Only the channels that are on are offered. */
export function ChannelPicker({
  channels,
  value,
  onChange,
  fill = false,
  className,
}: {
  channels: ChannelId[];
  value: ChannelId;
  onChange: (channel: ChannelId) => void;
  /** Equal-width items across the whole width (the rail). */
  fill?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label="Channel"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as ChannelId | undefined;
        if (picked) onChange(picked);
      }}
      spacing={1}
      className={cn(fill && "w-full", className)}
    >
      {channels.map((id) => {
        const { label, Icon } = CHANNEL_META[id];
        return (
          <ToggleGroupItem key={id} value={id} className={cn(SEG_ITEM, fill && "flex-1")}>
            <Icon aria-hidden strokeWidth={1.75} className="@max-[44rem]/controls:hidden" />
            {label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

// ── Device and download ──────────────────────────────────────────

export function DevicePicker({
  value,
  onChange,
  className,
}: {
  value: DeviceId;
  onChange: (device: DeviceId) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label="Device"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as DeviceId | undefined;
        if (picked) onChange(picked);
      }}
      spacing={0}
      className={cn("rounded-lg border border-hairline bg-surface p-0.5", className)}
    >
      <ToggleGroupItem value="desktop" className={cn(SEG_ITEM, "rounded-md")}>
        <Monitor aria-hidden strokeWidth={1.75} className="@max-[44rem]/controls:hidden" />
        Desktop
      </ToggleGroupItem>
      <ToggleGroupItem value="mobile" className={cn(SEG_ITEM, "rounded-md")}>
        <Smartphone aria-hidden strokeWidth={1.75} className="@max-[44rem]/controls:hidden" />
        Mobile
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** Outline, never black: the page's one black button is Submit for review. */
export function DownloadButton({ className }: { className?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Download PDF"
      title="Download PDF"
      className={cn("h-8 gap-1.5 bg-surface px-3 text-[13px] @max-[30rem]/controls:w-8 @max-[30rem]/controls:px-0", className)}
    >
      <Download data-icon="inline-start" strokeWidth={1.75} />
      <span className="@max-[30rem]/controls:sr-only">Download PDF</span>
    </Button>
  );
}

/** What sits beside the sample set, per channel: Download for PDF, the device switch for Web, nothing for Email. */
export function ChannelExtra({ ctl, className }: { ctl: PreviewControls; className?: string }) {
  if (ctl.channel === "pdf") return <DownloadButton className={className} />;
  if (ctl.channel === "web") return <DevicePicker value={ctl.device} onChange={ctl.onDevice} className={className} />;
  return null;
}

// ── Sample sets ──────────────────────────────────────────────────

/** Typed values for one set. Invalid input shows the field's own error ring and is kept as typed. */
export function ValuesForm({
  set,
  variables = VARIABLES,
  onEdit,
  className,
}: {
  set: PreviewSet;
  variables?: Variable[];
  onEdit: ControlsEdit;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {set.custom ? (
        <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3">
          <span className="text-[13px] leading-5 text-text-muted">Name</span>
          <Input
            value={set.name}
            onChange={(e) => onEdit(set.id, { name: e.target.value })}
            aria-label="Set name"
            className="h-8 text-[13px]"
          />
        </label>
      ) : null}
      {variables.map((variable) => {
        const value = set.values[variable.key] ?? "";
        const invalid = value !== "" && !validateValue(variable.type, value).ok;
        return (
          <label key={variable.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3">
            <span className="truncate text-[13px] leading-5 text-text-muted">{variable.label}</span>
            <Input
              value={value}
              onChange={(e) => onEdit(set.id, { values: { ...set.values, [variable.key]: e.target.value } })}
              aria-label={variable.label}
              aria-invalid={invalid || undefined}
              spellCheck={false}
              className="h-8 text-[13px]"
            />
          </label>
        );
      })}
    </div>
  );
}

type ControlsEdit = PreviewControls["onEditSet"];

/** One control for the set in use: a menu of the sets, plus "New set". */
export function SetMenu({ ctl, className }: { ctl: PreviewControls; className?: string }) {
  const current = ctl.sets.find((s) => s.id === ctl.setId) ?? ctl.sets[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sample set"
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 max-w-52 min-w-0 justify-between gap-2 bg-surface px-2.5 text-[13px] font-normal", className)}
          />
        }
      >
        <span className="truncate">{current.name}</span>
        <ChevronDown data-icon="inline-end" strokeWidth={1.75} className="text-text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => ctl.onSet(String(id))}>
          {ctl.sets.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id} closeOnClick>
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={ctl.onAddSet}>
          <Plus strokeWidth={1.75} />
          New set
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Edit values…" opens the current set's values in a popover. */
export function EditValues({
  ctl,
  open,
  onOpenChange,
  className,
}: {
  ctl: PreviewControls;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const current = ctl.sets.find((s) => s.id === ctl.setId) ?? ctl.sets[0];
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Edit values"
        title="Edit values"
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 gap-1.5 px-2.5 text-[13px] text-text-muted hover:text-text", className)}
          />
        }
      >
        <Pencil data-icon="inline-start" strokeWidth={1.75} />
        <span className="@max-[38rem]/controls:sr-only">Edit values…</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] gap-3 rounded-xl p-4 shadow-pop">
        <ValuesForm set={current} onEdit={ctl.onEditSet} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Set menu, Edit values… and the channel's extra, as one row. Used by the slim toolbar (B and the
 * narrow layouts) and by C's controls row. A new set opens its values straight away.
 */
export function SetControls({ ctl, className }: { ctl: PreviewControls; className?: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <SetMenu
        ctl={{
          ...ctl,
          onAddSet: () => {
            ctl.onAddSet();
            setEditing(true);
          },
        }}
      />
      <EditValues ctl={ctl} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

// ── The slim toolbar ─────────────────────────────────────────────

/** Channel, sample set, and the channel's extra, on one line. Wraps rather than clips when it must. */
export function PreviewToolbar({ ctl, className }: { ctl: PreviewControls; className?: string }) {
  return (
    <div className={cn("@container/controls flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <ChannelPicker channels={ctl.channels} value={ctl.channel} onChange={ctl.onChannel} />
      <SetControls ctl={ctl} />
      <ChannelExtra ctl={ctl} className="ml-auto" />
    </div>
  );
}

// ── A: the controls as the rail's content ────────────────────────

/** The rail in Preview (variant A): channel, the channel's extra, the sets, and the chosen set's values. */
export function RailControls({ ctl }: { ctl: PreviewControls }) {
  return (
    <div className="px-2">
      <div className="flex h-6 items-center">
        <div className="caps-label">Preview</div>
      </div>
      <ChannelPicker channels={ctl.channels} value={ctl.channel} onChange={ctl.onChannel} fill className="mt-3" />
      {ctl.channel === "pdf" ? <DownloadButton className="mt-3 w-full" /> : null}
      {ctl.channel === "web" ? (
        <DevicePicker value={ctl.device} onChange={ctl.onDevice} className="mt-3 w-full [&>*]:flex-1" />
      ) : null}

      <div className="caps-label mt-8">Sample set</div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {ctl.sets.map((s) => {
          const on = s.id === ctl.setId;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => ctl.onSet(s.id)}
                className={cn(
                  "-mx-2 flex min-h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] leading-5 transition-colors duration-(--dur-fast)",
                  on ? "bg-selected font-medium text-text" : "text-text-muted hover:bg-hover hover:text-text",
                )}
              >
                <span className="min-w-0 flex-1">{s.name}</span>
                {on ? <Check aria-hidden strokeWidth={1.75} className="size-4 shrink-0" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="lg"
        className="-mx-2 mt-0.5 w-[calc(100%+1rem)] justify-start gap-2.5 px-2 text-text-muted hover:text-text"
        onClick={ctl.onAddSet}
      >
        <span className="grid size-7 place-items-center rounded-md border border-dashed border-hairline-strong">
          <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
        </span>
        New set
      </Button>

      <div className="caps-label mt-8">Values</div>
      <ValuesForm
        key={ctl.setId}
        set={ctl.sets.find((s) => s.id === ctl.setId) ?? ctl.sets[0]}
        onEdit={ctl.onEditSet}
        className="mt-3"
      />
    </div>
  );
}
