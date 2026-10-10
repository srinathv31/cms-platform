"use client";

import { CircleAlert } from "lucide-react";
import {
  PushPreview,
  SmsPreview,
  type DeviceClock,
  type DeviceSettings,
  type PushScreen,
} from "@/components/device";
import type { RenderError } from "@/domain/render/types";
import type { MessageOutput } from "./message-preview";
import { WELL_INSET } from "./well";

// Push and SMS in the preview's well, on the phone kit (src/components/device): the text as the
// browser rendered it (message-preview.ts), on the phone the controls row chose. The phone fills the
// well's height and is its platform's exact width, scaled down evenly when the well is narrower, so it
// wraps every line as the phone does. A message the route would refuse still shows on the phone, with
// the route's sentence above it.

/** Who the team's messages come from: the app a push is from, and the number an SMS is from. */
export interface PhoneSenders {
  appName: string;
  /** A US short code or a number; "" when the team has none. */
  smsSender: string;
}

/** What an SMS's thread shows as its time: the phone's clock. */
const SMS_TIME = "9:41 AM";

export function PushOutput({
  output,
  settings,
  screen,
  onScreen,
  senders,
  clock,
}: {
  output: Extract<MessageOutput, { kind: "push" }>;
  settings: DeviceSettings;
  screen: PushScreen;
  /** Clicking the notification opens and closes the expanded view, as on a phone. */
  onScreen: (screen: PushScreen) => void;
  senders: PhoneSenders;
  clock: DeviceClock;
}) {
  const { appName } = senders;
  return (
    <PhoneWell refusal={output.refusal}>
      <PushPreview
        settings={settings}
        screen={screen}
        onScreenChange={onScreen}
        clock={clock}
        content={{ appName, appMark: { monogram: monogramOf(appName) }, ...output.push, time: "now" }}
      />
    </PhoneWell>
  );
}

export function SmsOutput({
  output,
  settings,
  senders,
  clock,
}: {
  output: Extract<MessageOutput, { kind: "sms" }>;
  settings: DeviceSettings;
  senders: PhoneSenders;
  clock: DeviceClock;
}) {
  return (
    <PhoneWell refusal={output.refusal}>
      <SmsPreview settings={settings} clock={clock} content={{ sender: senders.smsSender, text: output.text, time: SMS_TIME }} />
    </PhoneWell>
  );
}

/** The app's mark: its name's first letter, on the kit's brand tile. */
export function monogramOf(appName: string): string {
  return Array.from(appName.trim())[0]?.toUpperCase() ?? "";
}

/** The well's mat around the phone, with a refused message's sentence above it. */
function PhoneWell({ refusal, children }: { refusal: RenderError | null; children: React.ReactNode }) {
  return (
    <div className={`flex h-full flex-col ${WELL_INSET}`}>
      {refusal ? (
        <p role="alert" data-slot="message-refusal" className="mb-3 flex shrink-0 items-start gap-2 text-[13px] leading-5 text-text">
          <CircleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{refusal.message}</span>
        </p>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
