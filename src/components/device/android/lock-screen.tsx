"use client";

import type { CSSProperties, ReactNode } from "react";
import { m } from "motion/react";
import { Fingerprint, Flashlight, QrCode } from "lucide-react";
import { fadeRise } from "@/components/motion/presets";
import { pt } from "../geometry";
import { HomeIndicator, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { shortDate } from "./dates";
import { AndroidNotification } from "./notification-card";
import { androidFixed } from "./type";

// The Pixel-style lock screen with a notification: the clock moves to the top left, tinted from the
// wallpaper, with the date under it; the notifications form a grouped list (tight inner corners, 2dp apart)
// with ours on top and two quiet ones under it; shortcuts and the fingerprint mark sit at the bottom. The
// wallpaper is drawn under it by the caller. Everything but the notification is decoration.

/** Rounded digits, the Expressive clock: Google Sans Flex's roundness axis, all the way. */
export const ROUND: CSSProperties = { fontVariationSettings: '"ROND" 100' };

/** The clock and date, top left. Also the blurred backdrop of the shade. */
export function AndroidLockClock({ clock }: { clock: DeviceClock }) {
  return (
    <m.div
      {...fadeRise}
      aria-hidden
      className="relative text-(--device-m3-lock-ink)"
      style={{ paddingTop: pt(58), paddingInline: pt(26) }}
    >
      <div className="tabular-nums" style={{ ...androidFixed(86, 92, -0.01), ...ROUND, fontWeight: 430 }}>
        {clock.time}
      </div>
      <div className="font-medium" style={{ ...androidFixed(17, 24), marginTop: pt(2) }}>
        {shortDate(clock.date)}
      </div>
    </m.div>
  );
}

/** A quiet notification under ours: an icon and two bars, nothing to read. */
function QuietCard({ corners }: { corners: readonly [number, number, number, number] }) {
  return (
    <m.span
      {...fadeRise}
      aria-hidden
      className="flex items-center bg-(--device-m3-lock-card)"
      style={{ borderRadius: corners.map(pt).join(" "), height: pt(60), padding: `0 ${pt(16)}`, gap: pt(12) }}
    >
      <span className="shrink-0 rounded-full bg-(--device-m3-surface-container-highest)" style={{ width: pt(32), height: pt(32) }} />
      <span className="flex flex-col" style={{ gap: pt(7) }}>
        <span className="rounded-full bg-(--device-m3-surface-container-highest)" style={{ width: pt(108), height: pt(8) }} />
        <span className="rounded-full bg-(--device-m3-surface-container-highest)" style={{ width: pt(170), height: pt(7), opacity: 0.7 }} />
      </span>
    </m.span>
  );
}

function Shortcut({ children }: { children: ReactNode }) {
  return (
    <m.span
      {...fadeRise}
      className="grid place-items-center rounded-full bg-(--device-m3-secondary-container) text-(--device-m3-on-secondary-container)"
      style={{ width: pt(56), height: pt(56) }}
    >
      {children}
    </m.span>
  );
}

export function AndroidLockScreen({
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
  const glyph = { width: pt(24), height: pt(24) };
  return (
    <div className="absolute inset-0 flex flex-col">
      <StatusBar platform="android" time={null} ink="wall" />
      <AndroidLockClock clock={clock} />
      <div className="flex shrink-0 flex-col" style={{ margin: `${pt(26)} ${pt(12)} 0`, gap: pt(2) }}>
        <AndroidNotification
          content={content}
          screen="lock"
          textSize={settings.textSize}
          previewsHidden={settings.previewsHidden}
          onToggle={onToggle}
          motion={fadeRise}
          background="var(--device-m3-lock-card)"
          corners={[24, 24, 6, 6]}
        />
        <QuietCard corners={[6, 6, 6, 6]} />
        <QuietCard corners={[6, 6, 24, 24]} />
      </div>
      <div className="min-h-0 flex-1" />
      <div aria-hidden className="flex shrink-0 items-end justify-between" style={{ padding: `${pt(16)} ${pt(28)} ${pt(36)}` }}>
        <Shortcut>
          <Flashlight strokeWidth={2} style={glyph} />
        </Shortcut>
        <m.span {...fadeRise} className="text-(--device-m3-lock-ink)" style={{ marginBottom: pt(20) }}>
          <Fingerprint strokeWidth={1.6} style={{ width: pt(40), height: pt(40) }} />
        </m.span>
        <Shortcut>
          <QrCode strokeWidth={2} style={glyph} />
        </Shortcut>
      </div>
      <HomeIndicator platform="android" ink="wall" />
    </div>
  );
}
