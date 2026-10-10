import { cn } from "@/lib/utils";
import { pt } from "./geometry";
import type { DevicePlatform } from "./types";

// The phone's system chrome: the status bar along the top and the home indicator (iOS) or gesture handle
// (Android) along the bottom. Generic glyphs drawn here (no SF Symbols, no Material assets), decoration only,
// hidden from assistive tech. `ink` picks the colour for what is behind: the wallpaper, or an app's own
// background.

/** What the chrome sits on: the wallpaper (light ink) or an app's background (the label colour). */
export type ChromeInk = "wall" | "app";

const INK: Record<DevicePlatform, Record<ChromeInk, string>> = {
  ios: { wall: "text-(--device-wall-ink)", app: "text-(--device-label)" },
  android: { wall: "text-(--device-wall-ink)", app: "text-(--device-m3-on-surface)" },
};

/** The status bar's height per platform, in points. */
export const STATUS_BAR_HEIGHT: Record<DevicePlatform, number> = { ios: 54, android: 46 };

/**
 * The status bar. iOS: the time and the icons either side of the camera pill (`cutout` points wide, centred),
 * no time on a lock screen. Android: the time at the left and the icons at the right, around the punch hole.
 */
export function StatusBar({
  platform = "ios",
  time,
  ink,
  cutout = 0,
  className,
}: {
  platform?: DevicePlatform;
  time: string | null;
  ink: ChromeInk;
  cutout?: number;
  className?: string;
}) {
  const height = STATUS_BAR_HEIGHT[platform];
  if (platform === "android") {
    return (
      <div
        aria-hidden
        data-slot="status-bar"
        style={{ height: pt(height), paddingInline: `${pt(24)} ${pt(20)}` }}
        className={cn("pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between", INK.android[ink], className)}
      >
        <span className="font-medium tabular-nums" style={{ fontSize: pt(14), lineHeight: pt(20), letterSpacing: "0.01em" }}>
          {time}
        </span>
        <span className="flex items-center" style={{ gap: pt(5) }}>
          <AndroidWifi />
          <AndroidSignal />
          <AndroidBattery />
        </span>
      </div>
    );
  }
  return (
    <div
      aria-hidden
      data-slot="status-bar"
      style={{ height: pt(height) }}
      className={cn("pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center", INK.ios[ink], className)}
    >
      <div className="flex flex-1 justify-center" style={{ paddingTop: pt(3), paddingLeft: pt(10) }}>
        {time ? (
          <span
            className="font-semibold tabular-nums"
            style={{ fontSize: pt(17), lineHeight: pt(22), letterSpacing: pt(-0.43) }}
          >
            {time}
          </span>
        ) : null}
      </div>
      <div className="shrink-0" style={{ width: pt(cutout) }} />
      <div className="flex flex-1 items-center justify-center" style={{ gap: pt(6), paddingTop: pt(3), paddingRight: pt(8) }}>
        <Signal />
        <Wifi />
        <Battery />
      </div>
    </div>
  );
}

/** Four bars, rising. */
function Signal() {
  return (
    <svg viewBox="0 0 18 12" style={{ width: pt(18), height: pt(12) }} fill="currentColor">
      <rect x="0" y="7.5" width="3.2" height="4.5" rx="1" />
      <rect x="4.9" y="5" width="3.2" height="7" rx="1" />
      <rect x="9.8" y="2.5" width="3.2" height="9.5" rx="1" />
      <rect x="14.7" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

/** A fan of three arcs over a point. */
function Wifi() {
  return (
    <svg viewBox="0 0 16 12" style={{ width: pt(16), height: pt(12) }}>
      <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M.85 4.95A10.1 10.1 0 0 1 15.15 4.95" />
        <path d="M3.4 7.6A6.5 6.5 0 0 1 12.6 7.6" />
      </g>
      <path d="M8 12.2 5.6 9.8a3.4 3.4 0 0 1 4.8 0Z" fill="currentColor" />
    </svg>
  );
}

/** A battery, mostly full. */
function Battery() {
  return (
    <svg viewBox="0 0 27 13" style={{ width: pt(27), height: pt(13) }} fill="currentColor">
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="2" y="2" width="17" height="9" rx="2.4" />
      <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fillOpacity="0.45" />
    </svg>
  );
}

/** Android's Wi-Fi: a filled wedge, pointing down. */
function AndroidWifi() {
  return (
    <svg viewBox="0 0 18 14" style={{ width: pt(17), height: pt(13) }} fill="currentColor">
      <path d="M9 13.5.4 4.2A12.6 12.6 0 0 1 9 .8a12.6 12.6 0 0 1 8.6 3.4Z" />
    </svg>
  );
}

/** Android's cell signal: a right triangle, full. */
function AndroidSignal() {
  return (
    <svg viewBox="0 0 14 14" style={{ width: pt(13), height: pt(13) }} fill="currentColor">
      <path d="M13.2.8v12.4H.8Z" />
    </svg>
  );
}

/** Android's battery: a rounded bar, mostly full. */
function AndroidBattery() {
  return (
    <svg viewBox="0 0 26 13" style={{ width: pt(25), height: pt(12.5) }} fill="currentColor">
      <rect x="0.5" y="0.5" width="22" height="12" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.45" />
      <rect x="2.2" y="2.2" width="15" height="8.6" rx="2.6" />
      <rect x="23.8" y="4.2" width="1.8" height="4.6" rx="0.9" fillOpacity="0.45" />
    </svg>
  );
}

/** The bar along the bottom edge: iOS's home indicator, or Android's gesture handle (shorter, thinner). */
export function HomeIndicator({ ink, platform = "ios" }: { ink: ChromeInk; platform?: DevicePlatform }) {
  const size = platform === "android" ? { width: 108, height: 4, bottom: 9 } : { width: 139, height: 5, bottom: 8 };
  return (
    <span
      aria-hidden
      style={{ width: pt(size.width), height: pt(size.height), bottom: pt(size.bottom) }}
      className={cn("pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-current", INK[platform][ink])}
    />
  );
}
