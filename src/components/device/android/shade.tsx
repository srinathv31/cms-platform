"use client";

import { m } from "motion/react";
import { Bluetooth, Flashlight, Moon, Sun, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { HomeIndicator, STATUS_BAR_HEIGHT, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { AndroidLockClock } from "./lock-screen";
import { AndroidNotification } from "./notification-card";

// The notification shade, pulled down, with the notification expanded in the long-text style: the screen
// behind blurred under the shade's tint, a row of quick-settings tiles and the brightness slider (glyphs
// only, nothing to read), then the card. No subtitle, ever: Android doesn't have one. Expanding it from the
// lock screen needs the phone unlocked, so previews hidden doesn't change it. Clicking the shade collapses
// the card, like a tap outside it; the card's own button does the same from the keyboard.

function QuickTile({ on = false, children }: { on?: boolean; children: ReactNode }) {
  return (
    <m.span
      {...fadeRise}
      className={
        on
          ? "grid place-items-center rounded-full bg-(--device-m3-primary) text-(--device-m3-on-primary)"
          : "grid place-items-center rounded-full bg-(--device-m3-surface-container-highest) text-(--device-m3-on-surface-variant)"
      }
      style={{ width: pt(58), height: pt(58) }}
    >
      {children}
    </m.span>
  );
}

export function Shade({
  content,
  settings,
  clock,
  onToggle,
}: {
  content: PushContent;
  settings: DeviceSettings;
  clock: DeviceClock;
  onToggle?: () => void;
}) {
  const blur = `blur(${pt(18)}) saturate(1.3)`;
  const glyph = { width: pt(24), height: pt(24) };
  return (
    <>
      <div className="absolute inset-0">
        <AndroidLockClock clock={clock} />
      </div>
      <m.div
        {...fadeRise}
        aria-hidden
        onClick={onToggle}
        className="absolute inset-0"
        style={{ backdropFilter: blur, WebkitBackdropFilter: blur, background: "var(--device-m3-shade)" }}
      />
      <StatusBar platform="android" time={clock.time} ink="app" />
      <div className="absolute inset-x-0 flex flex-col" style={{ top: pt(STATUS_BAR_HEIGHT.android + 6), paddingInline: pt(16), gap: pt(14) }}>
        <div aria-hidden className="flex justify-between">
          <QuickTile on>
            <Wifi strokeWidth={2.2} style={glyph} />
          </QuickTile>
          <QuickTile on>
            <Bluetooth strokeWidth={2.2} style={glyph} />
          </QuickTile>
          <QuickTile>
            <Flashlight strokeWidth={2.2} style={glyph} />
          </QuickTile>
          <QuickTile>
            <Moon strokeWidth={2.2} style={glyph} />
          </QuickTile>
        </div>
        <m.div
          {...fadeRise}
          aria-hidden
          className="relative overflow-hidden rounded-full bg-(--device-m3-surface-container-highest)"
          style={{ height: pt(44) }}
        >
          <span className="absolute inset-y-0 left-0 flex items-center rounded-full bg-(--device-m3-primary) text-(--device-m3-on-primary)" style={{ width: "62%", paddingLeft: pt(14) }}>
            <Sun strokeWidth={2.2} style={{ width: pt(20), height: pt(20) }} />
          </span>
        </m.div>
        <AndroidNotification
          content={content}
          screen="expanded"
          textSize={settings.textSize}
          onToggle={onToggle}
          motion={fadeRise}
          background="var(--device-m3-shade-card)"
          corners={[28, 28, 28, 28]}
          className="mt-1"
        />
      </div>
      <HomeIndicator platform="android" ink="app" />
    </>
  );
}
