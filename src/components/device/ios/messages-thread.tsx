"use client";

import type { CSSProperties } from "react";
import { m } from "motion/react";
import { ChevronLeft, ChevronRight, Mic, Plus } from "lucide-react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { linkRuns } from "../links";
import { cutoutWidth } from "../phone-frame";
import { HomeIndicator, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, SmsContent } from "../types";
import { fixedText, textStyle } from "./type";

// The Messages thread a text arrives in: the sender's short code in the header (a US text can't show a
// brand there), "Text Message • SMS" and the time above a grey incoming bubble, and a composer that is
// only drawn. Links show as plain underlined text: iOS turns them off for unknown senders. The text is
// never cut; a long one scrolls inside the phone.

/** The header's controls: light glass on the app's own background. */
const CHROME: CSSProperties = {
  background: "var(--device-chrome)",
  boxShadow: `inset 0 0 0 ${pt(0.5)} var(--device-chrome-rim)`,
};

/** The generic contact silhouette: a head and shoulders. */
function Silhouette() {
  return (
    <svg viewBox="0 0 48 48" className="size-full" fill="currentColor">
      <circle cx="24" cy="19" r="8.6" />
      <path d="M8.6 41.5C11 33.6 17 29.6 24 29.6s13 4 15.4 11.9A20.4 20.4 0 0 1 24 48a20.4 20.4 0 0 1-15.4-6.5Z" />
    </svg>
  );
}

/** The incoming bubble's tail at its bottom left, in the bubble's colour, under the bubble's text. */
function Tail() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 26 22"
      className="absolute bottom-0 -z-10 fill-(--device-bubble-in)"
      style={{ width: pt(26), height: pt(22), left: pt(-6) }}
    >
      <path d="M6 0V13C6 18 3.4 20.6 0 21.8 4.6 22.4 9.2 21.7 12.6 19.6 15.6 21.3 19.6 22 26 22V0Z" />
    </svg>
  );
}

export function MessagesThread({
  content,
  settings,
  clock,
}: {
  content: SmsContent;
  settings: DeviceSettings;
  clock: DeviceClock;
}) {
  const body = textStyle("body", settings.textSize);
  const meta = textStyle("caption", settings.textSize);
  return (
    <div className="absolute inset-0 flex flex-col bg-(--device-bg)">
      <StatusBar time={clock.time} ink="app" cutout={cutoutWidth("ios")} />
      <header className="relative flex shrink-0 flex-col items-center" style={{ paddingTop: pt(58), paddingBottom: pt(6) }}>
        <span
          aria-hidden
          className="absolute grid place-items-center rounded-full"
          style={{ ...CHROME, left: pt(16), top: pt(62), width: pt(44), height: pt(44) }}
        >
          <ChevronLeft strokeWidth={2.4} style={{ width: pt(24), height: pt(24), marginLeft: pt(-2) }} />
        </span>
        <span
          aria-hidden
          className="overflow-hidden rounded-full bg-linear-to-b from-(--device-avatar-from) to-(--device-avatar-to) text-(--device-avatar-ink)"
          style={{ width: pt(50), height: pt(50) }}
        >
          <Silhouette />
        </span>
        <span
          className="flex items-center rounded-full font-medium"
          style={{
            ...fixedText(13, 18),
            ...CHROME,
            marginTop: pt(6),
            padding: `${pt(3)} ${pt(6)} ${pt(3)} ${pt(10)}`,
            gap: pt(1),
          }}
        >
          <span className="tabular-nums">{content.sender}</span>
          <ChevronRight aria-hidden strokeWidth={2.4} className="text-(--device-label-3)" style={{ width: pt(13), height: pt(13) }} />
        </span>
      </header>

      <m.div
        {...fadeRise}
        tabIndex={0}
        data-slot="messages-thread"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none]"
        style={{ padding: `${pt(10)} ${pt(16)} ${pt(16)}` }}
      >
        <p className="text-center text-(--device-label-2)" style={meta}>
          <span className="block font-semibold">Text Message • SMS</span>
          <span className="block">
            <span className="font-semibold">{content.day ?? "Today"}</span> <span className="tabular-nums">{content.time}</span>
          </span>
        </p>
        <div
          data-slot="sms-bubble"
          className="relative isolate w-fit max-w-[75%] bg-(--device-bubble-in) whitespace-pre-wrap text-(--device-label) [overflow-wrap:anywhere]"
          style={{ ...body, marginTop: pt(10), marginLeft: pt(2), borderRadius: pt(19), padding: `${pt(7)} ${pt(13)} ${pt(8)}` }}
        >
          {linkRuns(content.text).map((run, i) =>
            run.link ? (
              <span key={i} className="underline decoration-from-font underline-offset-2">
                {run.text}
              </span>
            ) : (
              run.text
            ),
          )}
          <Tail />
        </div>
      </m.div>

      <div aria-hidden className="flex shrink-0 items-end" style={{ gap: pt(8), padding: `${pt(8)} ${pt(12)} ${pt(38)}` }}>
        <span
          className="grid shrink-0 place-items-center rounded-full text-(--device-label-2)"
          style={{ background: "var(--device-fill)", width: pt(36), height: pt(36) }}
        >
          <Plus strokeWidth={2.2} style={{ width: pt(20), height: pt(20) }} />
        </span>
        <span
          className="flex min-w-0 flex-1 items-center justify-between rounded-full text-(--device-label-3)"
          style={{ ...body, height: pt(36), padding: `0 ${pt(6)} 0 ${pt(14)}`, boxShadow: `inset 0 0 0 ${pt(0.75)} var(--device-separator)` }}
        >
          <span className="truncate">Text Message • SMS</span>
          <Mic strokeWidth={2} className="shrink-0" style={{ width: pt(20), height: pt(20), marginRight: pt(4) }} />
        </span>
      </div>
      <HomeIndicator ink="app" />
    </div>
  );
}
