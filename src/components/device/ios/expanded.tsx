"use client";

import { m } from "motion/react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { cutoutWidth } from "../phone-frame";
import { HomeIndicator, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { LockClock } from "./lock-screen";
import { NotificationCard } from "./notification-card";

// The long-press view: the lock screen blurred and dimmed behind the notification, which shows its full
// text up to the expanded clamps. Opening it takes Face ID on a real phone, so previews hidden doesn't
// change it. Clicking the blurred backdrop collapses it, like a tap outside does on the phone; the card's
// own button does the same from the keyboard.

export function Expanded({
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
  const blur = `blur(${pt(14)}) saturate(1.4)`;
  return (
    <>
      <div className="absolute inset-0">
        <LockClock clock={clock} />
      </div>
      <m.div
        {...fadeRise}
        aria-hidden
        onClick={onToggle}
        className="absolute inset-0"
        style={{ backdropFilter: blur, WebkitBackdropFilter: blur, background: "var(--device-dim)" }}
      />
      <StatusBar time={null} ink="wall" cutout={cutoutWidth("ios")} />
      <div className="absolute inset-x-0" style={{ top: pt(84), paddingInline: pt(12) }}>
        <NotificationCard content={content} screen="expanded" textSize={settings.textSize} onToggle={onToggle} motion={fadeRise} />
      </div>
      <HomeIndicator ink="wall" />
    </>
  );
}
