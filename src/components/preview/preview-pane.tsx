"use client";

import { m } from "motion/react";
import type { Variable } from "@/editor/model/types";
import { assertNever } from "@/domain/assert-never";
import type { Channel } from "@/domain/types";
import { duration, ease } from "@/components/motion/presets";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { ChannelTabs, DevicePicker, DownloadPdfButton } from "./controls";
import { EmailOutput } from "./email-output";
import { OutputError } from "./output-error";
import { EmailSkeleton, WebSkeleton } from "./output-skeletons";
import { PdfViewer } from "./pdf/pdf-viewer";
import type { PreviewSlot } from "./use-preview-render";
import { WELL_INSET } from "./well";
import { WebOutput } from "./web-output";

export interface PreviewPaneProps {
  /** The channels that are on for the version, live from the session. Never empty. */
  channels: readonly Channel[];
  channel: Channel;
  onChannel: (channel: Channel) => void;

  /** The version's variables as the editor has them now: an error names them by their labels. */
  variables: readonly Variable[];
  /** Opens the sample-set editor (the error state's Edit values). */
  onEditValues: () => void;

  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;

  /** What the current channel has rendered so far. */
  slot: PreviewSlot | undefined;
  rendering: boolean;
  onRetry: () => void;
  /** The email frame's sender: the team's name and a no-reply address made from it. */
  sender: { name: string; address: string };
  /** Who the current set's message is out to, for the email frame; null when the set has no name. */
  recipient: string | null;
}

/**
 * The Preview view of the widened rail, under the rail's header row (which holds the view switch and
 * the sample-set switcher): a 32px controls row, then the output on a tinted well that scrolls on its
 * own. The controls row is the same on every channel: the channel control at the left, the channel's
 * own control at the right (Download PDF, or the Desktop / Mobile control; Email has none), and its
 * height is fixed, so the well starts at the same place whatever the channel, the set or the width.
 * The last good output stays up while the next renders.
 */
export function PreviewPane({
  channels,
  channel,
  onChannel,
  variables,
  onEditValues,
  device,
  onDevice,
  slot,
  rendering,
  onRetry,
  sender,
  recipient,
}: PreviewPaneProps) {
  const output = slot?.output ?? null;
  const error = slot?.error ?? null;
  // The address the web frame shows: the team's own domain (the email's sender domain).
  const host = sender.address.split("@")[1] ?? "";

  return (
    // The view fades in when the rail switches to it (the Variables view does the same).
    <m.div
      data-slot="preview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.fast, ease: ease.outSoft }}
      className="mt-3 flex min-h-0 flex-1 flex-col"
    >
      <div
        data-slot="preview-controls"
        className="@container/controls flex h-8 shrink-0 items-center justify-between gap-3"
      >
        <ChannelTabs channels={channels} value={channel} onChange={onChannel} />
        <ChannelControl channel={channel} output={error ? null : output} device={device} onDevice={onDevice} />
      </div>

      <div
        data-slot="preview-well"
        aria-busy={rendering || undefined}
        // A scroll region takes Tab, so the keyboard can scroll it.
        tabIndex={0}
        className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-surface-tinted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <m.div
          // A new channel fades in; a new render of the same channel just replaces what's there.
          key={`${channel}:${channel === "web" ? device : ""}`}
          initial={{ opacity: 0.3, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease: ease.outSoft }}
          className="h-full"
        >
          {error ? (
            <OutputError error={error} variables={variables} onEditValues={onEditValues} onRetry={onRetry} />
          ) : (
            <Output
              channel={channel}
              output={output}
              device={device}
              host={host}
              sender={sender}
              recipient={recipient}
            />
          )}
        </m.div>
      </div>
    </m.div>
  );
}

function Output({
  channel,
  output,
  device,
  host,
  sender,
  recipient,
}: {
  channel: Channel;
  output: PreviewSlot["output"];
  device: PreviewDevice;
  host: string;
  sender: PreviewPaneProps["sender"];
  recipient: string | null;
}) {
  switch (channel) {
    case "pdf": {
      const pdf = output?.kind === "pdf" ? output : null;
      // No bytes yet: PdfViewer draws its own page-shaped skeleton.
      return (
        <PdfViewer
          data={pdf?.bytes ?? null}
          fileName={pdf?.filename ?? ""}
          className="min-h-full bg-transparent"
          contentClassName={WELL_INSET}
        />
      );
    }
    case "web":
      return output?.kind === "web" ? (
        <WebOutput html={output.html} device={device} host={host} />
      ) : (
        <WebSkeleton device={device} host={host} />
      );
    case "email":
      return output?.kind === "email" ? (
        <EmailOutput
          subject={output.subject}
          preheader={output.preheader}
          html={output.html}
          senderName={sender.name}
          senderAddress={sender.address}
          recipient={recipient}
        />
      ) : (
        <EmailSkeleton />
      );
    default:
      return assertNever(channel, "channel");
  }
}

/**
 * The right slot of the controls row: the channel's own control, or nothing. While the pane shows an
 * error `output` is null: the last good PDF is still in memory, but it isn't what is on screen, so
 * there is nothing to save.
 */
function ChannelControl({
  channel,
  output,
  device,
  onDevice,
}: {
  channel: Channel;
  output: PreviewSlot["output"];
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
}) {
  switch (channel) {
    case "pdf":
      return <DownloadPdfButton output={output} />;
    case "web":
      return <DevicePicker value={device} onChange={onDevice} />;
    case "email":
      return null;
    default:
      return assertNever(channel, "channel");
  }
}
