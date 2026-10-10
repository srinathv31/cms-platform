"use client";

import { m } from "motion/react";
import type { DeviceClock } from "@/components/device";
import type { Variable } from "@/editor/model/types";
import { assertNever } from "@/domain/assert-never";
import type { Channel } from "@/domain/types";
import { duration, ease } from "@/components/motion/presets";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { ChannelTabs, DevicePicker, DownloadPdfButton } from "./controls";
import { EmailOutput } from "./email-output";
import type { MessagePreview } from "./message-preview";
import { OutputError } from "./output-error";
import { EmailSkeleton, WebSkeleton } from "./output-skeletons";
import { PdfViewer } from "./pdf/pdf-viewer";
import { PhoneControls, type PhoneView } from "./phone-controls";
import { PushOutput, SmsOutput, type PhoneSenders } from "./phone-output";
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

  /** Web's width. */
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;

  /** What the current document channel (PDF, Web, Email) has rendered so far, from the route. */
  slot: PreviewSlot | undefined;
  rendering: boolean;
  onRetry: () => void;
  /** The email frame's sender: the team's name and a no-reply address made from it. */
  sender: { name: string; address: string };
  /** Who the current set's message is out to, for the email frame; null when the set has no name. */
  recipient: string | null;

  /** The phone Push and SMS are on (iPhone or Android, and the Device options), and Push's screen. */
  phone: PhoneView;
  onPhone: (next: Partial<PhoneView>) => void;
  /** The current message channel's output, rendered in the browser (message-preview.ts); null on a document channel. */
  message: MessagePreview | null;
  /** Who the team's messages come from on the phone. */
  senders: PhoneSenders;
  /** The phone's clock: the lock screen's date is the demo clock's day. */
  clock: DeviceClock;
}

/**
 * The Preview view of the widened rail, under the rail's header row (which holds the view switch and
 * the sample-set switcher): a 32px controls row, then the output on a tinted well that scrolls on its
 * own. The controls row is the same on every channel: the channel control at the left, the channel's
 * own controls at the right (Download PDF; Desktop / Mobile; iPhone / Android and the Device options;
 * Email has none), and its height is fixed, so the well starts at the same place whatever the
 * channel, the set or the width.
 *
 * A document channel comes from the render route, and its last good output stays up while the next
 * renders. A message channel (Push, SMS) is rendered in the browser on every keystroke, so it has no
 * loading state: the phone is drawn with the text at once.
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
  phone,
  onPhone,
  message,
  senders,
  clock,
}: PreviewPaneProps) {
  const messageChannel = channel === "push" || channel === "sms";
  const output = messageChannel ? null : (slot?.output ?? null);
  const error = messageChannel ? (message && !message.ok ? message.error : null) : (slot?.error ?? null);
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
        <ChannelControl
          channel={channel}
          output={error ? null : output}
          device={device}
          onDevice={onDevice}
          phone={phone}
          onPhone={onPhone}
        />
      </div>

      <div
        data-slot="preview-well"
        aria-busy={(!messageChannel && rendering) || undefined}
        // A scroll region takes Tab, so the keyboard can scroll it.
        tabIndex={0}
        className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-surface-tinted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <m.div
          // A new channel (or Web's width, or another phone) fades in; a new render of the same one just replaces what's there.
          key={`${channel}:${channel === "web" ? device : messageChannel ? phone.settings.platform : ""}`}
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
              message={message}
              phone={phone}
              onPhone={onPhone}
              senders={senders}
              clock={clock}
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
  message,
  phone,
  onPhone,
  senders,
  clock,
}: {
  channel: Channel;
  output: PreviewSlot["output"];
  device: PreviewDevice;
  host: string;
  sender: PreviewPaneProps["sender"];
  recipient: string | null;
  message: MessagePreview | null;
  phone: PhoneView;
  onPhone: PreviewPaneProps["onPhone"];
  senders: PhoneSenders;
  clock: DeviceClock;
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
    // Rendered in the browser, so there is always something to draw (an error is the pane's).
    case "push":
      return message?.ok && message.output.kind === "push" ? (
        <PushOutput
          output={message.output}
          settings={phone.settings}
          screen={phone.screen}
          onScreen={(screen) => onPhone({ screen })}
          senders={senders}
          clock={clock}
        />
      ) : null;
    case "sms":
      return message?.ok && message.output.kind === "sms" ? (
        <SmsOutput output={message.output} settings={phone.settings} senders={senders} clock={clock} />
      ) : null;
    default:
      return assertNever(channel, "channel");
  }
}

/**
 * The right slot of the controls row: the channel's own controls, or nothing. While the pane shows an
 * error `output` is null: the last good PDF is still in memory, but it isn't what is on screen, so
 * there is nothing to save.
 */
function ChannelControl({
  channel,
  output,
  device,
  onDevice,
  phone,
  onPhone,
}: {
  channel: Channel;
  output: PreviewSlot["output"];
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  phone: PhoneView;
  onPhone: PreviewPaneProps["onPhone"];
}) {
  switch (channel) {
    case "pdf":
      return <DownloadPdfButton output={output} />;
    case "web":
      return <DevicePicker value={device} onChange={onDevice} />;
    case "email":
      return null;
    case "push":
    case "sms":
      return <PhoneControls channel={channel} view={phone} onChange={onPhone} />;
    default:
      return assertNever(channel, "channel");
  }
}
