"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import {
  PushPreview,
  SmsPreview,
  type DeviceClock,
  type DeviceSettings,
  type PhoneFit,
  type PushScreen,
} from "@/components/device";
import type { RenderError } from "@/domain/render/types";
import { refusalNotice, type MessageOutput } from "./message-preview";
import { PHONE_INSET, PHONE_ROOM } from "./well";

// Push and SMS in the preview's well, on the phone kit (src/components/device): the text as the
// browser rendered it (message-preview.ts), on the phone the controls row chose. The phone is laid out
// at its real size and scaled to fit the well whole, in its true proportions, so it wraps and cuts every
// line as the phone does; in a well too short for the kit's smallest scale it keeps that scale and the
// well scrolls. A message the route would refuse still shows on the phone, with the route's sentence
// above it (announced once, in fixed words, when it turns refused).

/** Who the team's messages come from: the app a push is from, and the number an SMS is from. */
export interface PhoneSenders {
  appName: string;
  /** A US short code or a number; "" when the team has none (the phone then shows "No sender"). */
  smsSender: string;
}

/** What an SMS's thread shows as its time: the phone's clock. */
const SMS_TIME = "9:41 AM";

/** The phone on its mat: when the well scrolls, 40px stay under it at the end (well.ts). */
const FIT: PhoneFit = { room: PHONE_ROOM };

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
        fit={FIT}
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
      <SmsPreview settings={settings} clock={clock} fit={FIT} content={{ sender: senders.smsSender, text: output.text, time: SMS_TIME }} />
    </PhoneWell>
  );
}

/** The app's mark: its name's first letter, on the kit's brand tile. */
export function monogramOf(appName: string): string {
  return Array.from(appName.trim())[0]?.toUpperCase() ?? "";
}

/**
 * The well's mat around the phone (an even 16px, well.ts), with a refused message's sentence above it. The sentence has the
 * message's live size in it ("The SMS is 11 parts…"), so it changes with each keystroke: it is not a live
 * region. A screen reader hears a fixed sentence once, from a polite region, when the message goes from
 * sendable to refused (`refusalNotice`); a message that opens already refused says nothing until it is read.
 */
function PhoneWell({ refusal, children }: { refusal: RenderError | null; children: React.ReactNode }) {
  const notice = useRefusalNotice(refusal);
  return (
    <div className={`flex h-full flex-col ${PHONE_INSET}`}>
      <p role="status" data-slot="message-refusal-notice" className="sr-only">
        {notice}
      </p>
      {refusal ? (
        <p data-slot="message-refusal" className="mb-3 flex shrink-0 items-start gap-2 text-[13px] leading-5 text-text">
          <CircleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{refusal.message}</span>
        </p>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** What the polite region says: the fixed notice from the render that turned the message refused, until it is sendable again. */
function useRefusalNotice(refusal: RenderError | null): string {
  const refused = refusal !== null;
  const [state, setState] = useState({ refused, notice: "" });
  if (state.refused !== refused) {
    const next = { refused, notice: refusal ? refusalNotice(refusal) : "" };
    setState(next);
    return next.notice;
  }
  return state.notice;
}
