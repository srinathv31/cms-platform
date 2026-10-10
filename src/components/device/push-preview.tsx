"use client";

import { useEffect, useRef } from "react";
import { NOT_SHOWN, measureFields, useMeasure } from "./measure";
import { PhoneFrame } from "./phone-frame";
import { Wallpaper } from "./wallpaper";
import { Banner } from "./ios/banner";
import { Expanded } from "./ios/expanded";
import { LockScreen } from "./ios/lock-screen";
import type { DeviceClock, DeviceSettings, PushContent, PushMeasure, PushScreen } from "./types";

/** The clock the phone shows when the caller doesn't set one. */
export const DEFAULT_CLOCK: DeviceClock = { time: "9:41", date: "Friday, October 9" };

const SCREEN_NAMES: Record<PushScreen, string> = {
  lock: "Lock screen",
  banner: "Banner",
  expanded: "Expanded notification",
};

const PLATFORM_NAMES: Record<DeviceSettings["platform"], string> = { ios: "iOS-style", android: "Android-style" };

export interface PushPreviewProps {
  settings: DeviceSettings;
  screen: PushScreen;
  content: PushContent;
  /**
   * Makes the notification a button: clicking it opens the expanded view, and clicking it (or the blurred
   * backdrop) there goes back to the screen it came from. Without it, the notification is static.
   */
  onScreenChange?: (screen: PushScreen) => void;
  /** Called with how each field fits whenever that changes: after a render, a resize or a font load. */
  onMeasure?: (measure: PushMeasure) => void;
  clock?: DeviceClock;
  className?: string;
}

/**
 * A push notification on a phone, in the platform's look: the lock screen, a banner over the home screen,
 * or the expanded view. It fills its container's height (give the parent one) and is its platform's exact
 * width in points, scaled down evenly when the container is narrower.
 */
export function PushPreview({ settings, screen, content, onScreenChange, onMeasure, clock = DEFAULT_CLOCK, className }: PushPreviewProps) {
  const root = useRef<HTMLElement>(null);

  // Where the expanded view goes back to: the screen it was opened from.
  const collapsed = useRef<Exclude<PushScreen, "expanded">>("lock");
  useEffect(() => {
    if (screen !== "expanded") collapsed.current = screen;
  }, [screen]);
  const onToggle = onScreenChange
    ? () => onScreenChange(screen === "expanded" ? collapsed.current : "expanded")
    : undefined;

  const hasSubtitle = Boolean(content.subtitle?.trim()) && settings.platform === "ios";
  useMeasure(
    root,
    JSON.stringify([settings, screen, content]),
    (element): PushMeasure => {
      const fits = measureFields(element);
      return {
        platform: settings.platform,
        screen,
        title: fits.title ?? NOT_SHOWN,
        subtitle: hasSubtitle ? (fits.subtitle ?? NOT_SHOWN) : null,
        body: fits.body ?? NOT_SHOWN,
      };
    },
    onMeasure,
  );

  return (
    <PhoneFrame
      ref={root}
      platform={settings.platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={`${SCREEN_NAMES[screen]}, ${PLATFORM_NAMES[settings.platform]} preview`}
      className={className}
    >
      {settings.platform === "ios" ? (
        <>
          <Wallpaper />
          {screen === "lock" ? (
            <LockScreen content={content} settings={settings} clock={clock} onToggle={onToggle} />
          ) : screen === "banner" ? (
            <Banner content={content} settings={settings} clock={clock} onToggle={onToggle} />
          ) : (
            <Expanded content={content} settings={settings} clock={clock} onToggle={onToggle} />
          )}
        </>
      ) : null /* The Android skin (android/) comes next: a blank screen until then. */}
    </PhoneFrame>
  );
}
