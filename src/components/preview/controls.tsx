"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Channel } from "@/domain/types";
import { cn } from "@/lib/utils";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { downloadPdf } from "./pdf/download";
import type { PreviewOutput } from "./render-preview";

// The controls row under the rail's header: the channel at the left, the channel's own control at the
// right. Every control in the rail is 32px tall with 8px corners (`h-8 rounded-lg`), so the row, and
// the well under it, never move between channels.
//
// The rail's one segmented style, for the channel and for Desktop / Mobile: a white 32px track with a
// hairline border, a 24px segment inside (6px corners) that is muted until it is chosen, and a tan
// `bg-selected` fill under the chosen one: the same fill the pressed Preview button has in the tab bar.

const TRACK = "h-8 rounded-lg border border-hairline bg-surface p-0.5";
const SEGMENT =
  "h-6 min-w-0 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text aria-pressed:hover:bg-selected";

const CHANNEL_LABEL: Record<Channel, string> = { pdf: "PDF", web: "Web", email: "Email" };
const DEVICES: readonly { value: PreviewDevice; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** The group's accessible name. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        // A pressed segment can't be pressed off: there is always one chosen.
        if (picked) onChange(picked);
      }}
      spacing={0.5}
      className={cn(TRACK, className)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className={SEGMENT}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Which channel's output is on screen. Only the channels that are on for the version are offered. */
export function ChannelTabs({
  channels,
  value,
  onChange,
  className,
}: {
  channels: readonly Channel[];
  value: Channel;
  onChange: (channel: Channel) => void;
  className?: string;
}) {
  return (
    <Segmented
      label="Channel"
      value={value}
      options={channels.map((id) => ({ value: id, label: CHANNEL_LABEL[id] }))}
      onChange={onChange}
      className={className}
    />
  );
}

/** The Web channel's width: the pane's own, or a 390px phone. */
export function DevicePicker({
  value,
  onChange,
  className,
}: {
  value: PreviewDevice;
  onChange: (device: PreviewDevice) => void;
  className?: string;
}) {
  return <Segmented label="Device" value={value} options={DEVICES} onChange={onChange} className={className} />;
}

/**
 * Saves the exact bytes the preview is showing, under the name the route gave them. It keeps its label
 * until the row is under 20rem wide (a narrow overlay), then closes up to the icon. Outline: the
 * page's one black button is Submit for review. It waits until there is a good PDF on screen, so the
 * caller passes `null` while the pane shows an error (the last good render is still in memory, but it
 * isn't what the author is looking at) as well as before the first render.
 */
export function DownloadPdfButton({ output, className }: { output: PreviewOutput | null; className?: string }) {
  const pdf = output?.kind === "pdf" ? output : null;
  return (
    <Button
      variant="outline"
      aria-label="Download PDF"
      title="Download PDF"
      disabled={pdf === null}
      onClick={() => pdf && downloadPdf(pdf.bytes, pdf.filename)}
      className={cn(
        "gap-1.5 bg-surface px-3 text-[13px] @max-[20rem]/controls:w-8 @max-[20rem]/controls:px-0",
        className,
      )}
    >
      <Download data-icon="inline-start" strokeWidth={1.75} />
      <span className="@max-[20rem]/controls:sr-only">Download PDF</span>
    </Button>
  );
}
