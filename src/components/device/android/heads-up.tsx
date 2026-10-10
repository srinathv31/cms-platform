"use client";

import type { CSSProperties } from "react";
import { Mic, Search } from "lucide-react";
import { spring } from "@/components/motion/presets";
import { pt } from "../geometry";
import { HomeIndicator, STATUS_BAR_HEIGHT, StatusBar } from "../status-bar";
import type { DeviceClock, DeviceSettings, PushContent } from "../types";
import { shortDate } from "./dates";
import { AndroidNotification } from "./notification-card";
import { androidFixed } from "./type";

// A heads-up notification on an unlocked Pixel-style phone: it drops in over an abstract home screen (the
// date where the at-a-glance line sits, rows of round themed tiles, the dock and a plain search bar; no real
// apps, no logo), collapsed to one line of title and one of text. It drops once, when the view opens, and
// stays still under reduced motion. The phone is unlocked, so previews hidden doesn't change it.

const TILE = 52;
/** Tile tones, in a fixed irregular order: themed icons tinted from the wallpaper, with nothing on them. */
const TONES = [
  "--device-m3-primary-container",
  "--device-m3-secondary-container",
  "--device-m3-surface-container-high",
  "--device-m3-primary-container",
] as const;
const PATTERN = [0, 1, 2, 3, 1, 2, 0, 1, 2, 0, 3, 1, 3, 2, 1, 0];
const ROW: CSSProperties = { gridTemplateColumns: `repeat(4, ${pt(TILE)})` };

function Tile({ tone, label = true }: { tone: (typeof TONES)[number]; label?: boolean }) {
  return (
    <span className="flex flex-col items-center" style={{ gap: pt(8) }}>
      <span className="grid place-items-center rounded-full opacity-90" style={{ width: pt(TILE), height: pt(TILE), background: `var(${tone})` }}>
        {/* Where the icon's glyph would be: a soft shape, nothing an app could be told by. */}
        <span className="bg-(--device-m3-on-primary-container) opacity-20" style={{ width: pt(20), height: pt(20), borderRadius: pt(7) }} />
      </span>
      {label ? <span className="rounded-full bg-(--device-tile-label)" style={{ width: pt(34), height: pt(6) }} /> : null}
    </span>
  );
}

/** The home screen. It appears at once: the heads-up's drop is the motion here. */
function AndroidHomeScreen({ clock }: { clock: DeviceClock }) {
  return (
    <div aria-hidden className="absolute inset-0 flex flex-col">
      <StatusBar platform="android" time={clock.time} ink="wall" />
      <div className="shrink-0 text-(--device-wall-ink)" style={{ padding: `${pt(STATUS_BAR_HEIGHT.android + 28)} ${pt(28)} 0` }}>
        <div style={androidFixed(24, 30)}>{shortDate(clock.date)}</div>
      </div>
      {/* Whole rows only: a row that doesn't fit wraps into a second, clipped column. */}
      <div
        className="flex min-h-0 flex-1 flex-col flex-wrap overflow-hidden"
        style={{ paddingTop: pt(32), paddingInline: pt(30), rowGap: pt(20), columnGap: pt(60) }}
      >
        {[0, 4, 8].map((start) => (
          <div key={start} className="grid w-full shrink-0 justify-between" style={ROW}>
            {PATTERN.slice(start, start + 4).map((tone, i) => (
              <Tile key={i} tone={TONES[tone]!} />
            ))}
          </div>
        ))}
      </div>
      <div className="grid shrink-0 justify-between" style={{ ...ROW, paddingInline: pt(30), paddingBlock: pt(16) }}>
        {PATTERN.slice(12, 16).map((tone, i) => (
          <Tile key={i} tone={TONES[tone]!} label={false} />
        ))}
      </div>
      <div className="shrink-0" style={{ padding: `0 ${pt(20)} ${pt(30)}` }}>
        <div
          className="flex items-center justify-between rounded-full bg-(--device-m3-surface-container-high) text-(--device-m3-on-surface-variant)"
          style={{ height: pt(52), paddingInline: pt(18) }}
        >
          <Search strokeWidth={2} style={{ width: pt(22), height: pt(22) }} />
          <Mic strokeWidth={2} style={{ width: pt(22), height: pt(22) }} />
        </div>
      </div>
      <HomeIndicator platform="android" ink="wall" />
    </div>
  );
}

const DROP = { initial: { y: "-150%" }, animate: { y: 0 }, transition: spring.soft };

export function HeadsUp({
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
      <AndroidHomeScreen clock={clock} />
      <div className="absolute inset-x-0 z-10" style={{ top: pt(STATUS_BAR_HEIGHT.android + 2), paddingInline: pt(10) }}>
        <AndroidNotification
          content={content}
          screen="banner"
          textSize={settings.textSize}
          onToggle={onToggle}
          motion={DROP}
          background="var(--device-m3-surface-container-high)"
          corners={[24, 24, 24, 24]}
          shadow
        />
      </div>
    </>
  );
}
