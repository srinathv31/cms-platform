"use client";

import type { CSSProperties, ReactNode } from "react";
import { m } from "motion/react";
import { Camera, Flashlight } from "lucide-react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { cutoutWidth } from "../phone-frame";
import { HomeIndicator, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { glass } from "./glass";
import { NotificationCard } from "./notification-card";
import { fixedText } from "./type";

// The iPhone lock screen: the date and the large clock, the notification as the front card of a stack
// with two quiet cards behind it, and the flashlight and camera buttons at the bottom. Everything but the
// notification is decoration. The wallpaper is drawn under it by the caller (it is shared with the banner
// and expanded views, so it doesn't flash between them).

/** The date and the large clock. Also the blurred backdrop of the expanded view. */
export function LockClock({ clock }: { clock: DeviceClock }) {
  return (
    <m.div {...fadeRise} aria-hidden className="relative text-center text-(--device-wall-ink)" style={{ paddingTop: pt(62) }}>
      <div className="font-semibold" style={fixedText(21, 26)}>
        {clock.date}
      </div>
      <div
        className="font-semibold tabular-nums"
        style={{ ...fixedText(104, 104), letterSpacing: pt(-1.5), marginTop: pt(-2), fontOpticalSizing: "auto" }}
      >
        {clock.time}
      </div>
    </m.div>
  );
}

/** A card behind the front one: only its lower edge shows. `inset` from each side, `drop` below the front. */
function StackedCard({ inset, drop }: { inset: number; drop: number }) {
  return (
    <m.span
      {...fadeRise}
      aria-hidden
      style={{ ...glass("quiet"), left: pt(inset), right: pt(inset), bottom: pt(drop), height: pt(48), borderRadius: pt(20) }}
      className="absolute"
    />
  );
}

/** A round glass button at the bottom of the lock screen. */
function LockButton({ children }: { children: ReactNode }) {
  return (
    <m.span
      {...fadeRise}
      style={{ ...glass("quiet", { blur: 20 }), width: pt(50), height: pt(50), background: "var(--device-tile-deep)" }}
      className="grid place-items-center rounded-full text-(--device-wall-ink) [&_svg]:size-(--icon)"
    >
      {children}
    </m.span>
  );
}

export function LockScreen({
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
    <div className="absolute inset-0 flex flex-col">
      <StatusBar time={null} ink="wall" cutout={cutoutWidth("ios")} />
      <LockClock clock={clock} />
      <div className="relative shrink-0" style={{ margin: `${pt(30)} ${pt(12)} 0`, paddingBottom: pt(16) }}>
        <StackedCard inset={16} drop={0} />
        <StackedCard inset={8} drop={8} />
        <NotificationCard
          content={content}
          screen="lock"
          textSize={settings.textSize}
          previewsHidden={settings.previewsHidden}
          onToggle={onToggle}
          motion={fadeRise}
          className="relative"
        />
      </div>
      <div className="min-h-0 flex-1" />
      <div
        aria-hidden
        className="flex shrink-0 justify-between"
        style={{ padding: `${pt(16)} ${pt(46)} ${pt(46)}`, "--icon": pt(22) } as CSSProperties}
      >
        <LockButton>
          <Flashlight strokeWidth={1.75} />
        </LockButton>
        <LockButton>
          <Camera strokeWidth={1.75} />
        </LockButton>
      </div>
      <HomeIndicator ink="wall" />
    </div>
  );
}
