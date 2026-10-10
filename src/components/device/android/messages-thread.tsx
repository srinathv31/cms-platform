"use client";

import { useRef } from "react";
import { m } from "motion/react";
import { ArrowLeft, EllipsisVertical, ImagePlus, Mic, Phone, Plus, Smile, Video } from "lucide-react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { linkRuns } from "../links";
import { Silhouette } from "../silhouette";
import { HomeIndicator, STATUS_BAR_HEIGHT, StatusBar } from "../status-bar";
import { showsStamp, threadMessages, useOpenOnNewest } from "../thread";
import type { DeviceClock, DeviceSettings, SmsContent } from "../types";
import { androidText } from "./type";

// A text in the current Google Messages style, drawn generically (no app icon, no logo): the sender as a
// number in the top bar on a solid tinted background, the thread in a container with rounded top corners,
// "Text message" and the time above a grey incoming bubble with tighter corners than iOS, and a composer
// that is only drawn. Earlier texts sit above, each under its own time when that changes, and the thread
// opens on the newest. Links show as plain underlined text. The text is never cut; a long one scrolls.

export function AndroidMessagesThread({
  content,
  settings,
  clock,
}: {
  content: SmsContent;
  settings: DeviceSettings;
  clock: DeviceClock;
}) {
  const message = androidText("message", settings.textSize);
  const label = androidText("label", settings.textSize);
  const icon = { width: pt(24), height: pt(24) };
  const messages = threadMessages(content);
  const scroller = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);
  useOpenOnNewest(scroller, newest, messages.length);
  return (
    <div className="absolute inset-0 flex flex-col bg-(--device-m3-surface-container) text-(--device-m3-on-surface)">
      <StatusBar platform="android" time={clock.time} ink="app" />
      <header className="flex shrink-0 items-center" style={{ marginTop: pt(STATUS_BAR_HEIGHT.android), height: pt(64), paddingInline: pt(4) }}>
        <span aria-hidden className="grid place-items-center" style={{ width: pt(48), height: pt(48) }}>
          <ArrowLeft strokeWidth={2} style={icon} />
        </span>
        <span
          aria-hidden
          className="shrink-0 overflow-hidden rounded-full bg-(--device-m3-primary-container) text-(--device-m3-on-primary-container)"
          style={{ width: pt(40), height: pt(40), padding: pt(5), paddingBottom: 0 }}
        >
          <Silhouette />
        </span>
        <span className="min-w-0 flex-1 truncate tabular-nums" style={{ fontSize: pt(20), lineHeight: pt(28), marginLeft: pt(12) }}>
          {content.sender}
        </span>
        <span aria-hidden className="flex shrink-0 items-center text-(--device-m3-on-surface-variant)" style={{ gap: pt(20), paddingRight: pt(12) }}>
          <Phone strokeWidth={2} style={icon} />
          <Video strokeWidth={2} style={icon} />
          <EllipsisVertical strokeWidth={2} style={icon} />
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col bg-(--device-m3-surface)" style={{ borderRadius: `${pt(28)} ${pt(28)} 0 0` }}>
        <m.div
          {...fadeRise}
          ref={scroller}
          tabIndex={0}
          data-slot="messages-thread"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none]"
          style={{ padding: `${pt(18)} ${pt(16)} ${pt(12)}` }}
        >
          {messages.map((sms, i) => (
            <div key={i} ref={i === messages.length - 1 ? newest : undefined} data-slot="sms-message" style={{ marginTop: i === 0 ? 0 : pt(showsStamp(messages, i) ? 18 : 4) }}>
              {showsStamp(messages, i) ? (
                <p className="text-center text-(--device-m3-on-surface-variant)" style={{ ...label, marginBottom: pt(14) }}>
                  {i === 0 ? <span className="block font-medium">Text message</span> : null}
                  <span className="block tabular-nums">
                    {sms.day ?? "Today"} • {sms.time}
                  </span>
                </p>
              ) : null}
              <div
                data-slot="sms-bubble"
                className="w-fit max-w-[80%] bg-(--device-m3-bubble-in) whitespace-pre-wrap [overflow-wrap:anywhere]"
                style={{ ...message, borderRadius: `${pt(18)} ${pt(18)} ${pt(18)} ${pt(4)}`, padding: `${pt(10)} ${pt(14)}` }}
              >
                {linkRuns(sms.text).map((run, j) =>
                  run.link ? (
                    <span key={j} className="underline decoration-from-font underline-offset-2">
                      {run.text}
                    </span>
                  ) : (
                    run.text
                  ),
                )}
              </div>
            </div>
          ))}
        </m.div>

        <div aria-hidden className="flex shrink-0 items-center" style={{ gap: pt(8), padding: `${pt(8)} ${pt(12)} ${pt(30)}` }}>
          <span
            className="grid shrink-0 place-items-center rounded-full bg-(--device-m3-surface-container-high) text-(--device-m3-primary)"
            style={{ width: pt(40), height: pt(40) }}
          >
            <Plus strokeWidth={2.2} style={icon} />
          </span>
          <span
            className="flex min-w-0 flex-1 items-center justify-between rounded-full bg-(--device-m3-surface-container-high) text-(--device-m3-on-surface-variant)"
            style={{ ...androidText("body", settings.textSize), height: pt(48), padding: `0 ${pt(14)} 0 ${pt(18)}`, gap: pt(12) }}
          >
            <span className="truncate">Text message</span>
            <span className="flex shrink-0 items-center" style={{ gap: pt(14) }}>
              <Smile strokeWidth={2} style={{ width: pt(22), height: pt(22) }} />
              <ImagePlus strokeWidth={2} style={{ width: pt(22), height: pt(22) }} />
            </span>
          </span>
          <span
            className="grid shrink-0 place-items-center rounded-full bg-(--device-m3-primary-container) text-(--device-m3-on-primary-container)"
            style={{ width: pt(48), height: pt(48) }}
          >
            <Mic strokeWidth={2} style={icon} />
          </span>
        </div>
      </div>
      <HomeIndicator platform="android" ink="app" />
    </div>
  );
}
