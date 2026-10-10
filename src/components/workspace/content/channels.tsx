"use client";

import { Check, FileText, Globe, Mail, MessageSquareText, Smartphone, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import { CHANNELS, type Channel } from "@/domain/types";

const ICON: Readonly<Record<Channel, LucideIcon>> = { pdf: FileText, web: Globe, email: Mail, push: Smartphone, sms: MessageSquareText };

const CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium [&_svg]:size-3.5";

/**
 * Where this template renders to. Editing: a toggle per channel the content type allows, and a check
 * mark on each one that is on, so it reads as a selector. At least one stays on. Read-only: just the
 * channels that are on. `disabled` keeps the toggles where they are, greyed out, while the page is
 * held still (Submit is reading the saved draft).
 */
export function ChannelSelector({
  channels,
  allowed,
  editable,
  disabled = false,
  onChange,
}: {
  channels: Channel[];
  allowed: Channel[];
  editable: boolean;
  disabled?: boolean;
  onChange: (channels: Channel[]) => void;
}) {
  if (!editable) {
    return (
      <ul aria-label="Channels" className="flex items-center gap-1">
        {CHANNELS.filter((id) => channels.includes(id)).map((id) => {
          const label = CHANNEL_LABELS[id];
          const Icon = ICON[id];
          return (
            <li key={id} className={cn(CHIP, "border-transparent bg-selected text-text")}>
              <Icon aria-hidden strokeWidth={1.75} />
              {label}
            </li>
          );
        })}
      </ul>
    );
  }

  const on = CHANNELS.filter((id) => allowed.includes(id) && channels.includes(id));
  return (
    <ToggleGroup
      aria-label="Channels"
      multiple
      value={on}
      disabled={disabled}
      onValueChange={(next) => {
        // Keep the content type's order, and never let the last channel go.
        const ordered = CHANNELS.filter((id) => next.includes(id));
        if (ordered.length > 0) onChange(ordered);
      }}
      spacing={1}
    >
      {CHANNELS.filter((id) => allowed.includes(id)).map((id) => {
        const label = CHANNEL_LABELS[id];
        const Icon = ICON[id];
        const pressed = on.includes(id);
        return (
          <ToggleGroupItem
            key={id}
            value={id}
            title={pressed && on.length === 1 ? "At least one channel is needed" : undefined}
            className={cn(
              CHIP,
              "border-hairline bg-transparent text-text-muted hover:bg-hover hover:text-text",
              "aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-text",
            )}
          >
            {pressed ? <Check aria-hidden strokeWidth={2} /> : <Icon aria-hidden strokeWidth={1.75} />}
            {label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
