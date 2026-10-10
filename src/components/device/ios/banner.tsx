"use client";

import { spring } from "@/components/motion/presets";
import { pt } from "../geometry";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { HomeScreen } from "./home-screen";
import { NotificationCard } from "./notification-card";

// A banner on an unlocked iPhone: it drops in over the home screen, under the camera pill. It drops once,
// when the view opens (a keystroke doesn't replay it), and stays still under reduced motion (MotionConfig
// skips transforms). The phone is unlocked here, so previews hidden doesn't change it.

const DROP = { initial: { y: "-140%" }, animate: { y: 0 }, transition: spring.soft };

export function Banner({
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
  return (
    <>
      <HomeScreen time={clock.time} />
      {/* Over the status bar (z-20) as it drops past it, under the camera pill (z-30). */}
      <div className="absolute inset-x-0 z-[25]" style={{ top: pt(52), paddingInline: pt(10) }}>
        <NotificationCard content={content} screen="banner" textSize={settings.textSize} onToggle={onToggle} motion={DROP} />
      </div>
    </>
  );
}
