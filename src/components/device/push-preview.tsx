"use client";

import { useEffect, useRef } from "react";
import { PLATFORM_STYLE, pushScreenLabel } from "./labels";
import { NOT_SHOWN, measureFields, useMeasure } from "./measure";
import { PhoneFrame } from "./phone-frame";
import { Wallpaper } from "./wallpaper";
import { HeadsUp } from "./android/heads-up";
import { AndroidLockScreen } from "./android/lock-screen";
import { Shade } from "./android/shade";
import { Banner } from "./ios/banner";
import { Expanded } from "./ios/expanded";
import { LockScreen } from "./ios/lock-screen";
import type { DeviceClock, DeviceSettings, PhoneFit, PushContent, PushMeasure, PushScreen } from "./types";

/** The clock the phone shows when the caller doesn't set one. */
export const DEFAULT_CLOCK: DeviceClock = { time: "9:41", date: "Friday, October 9" };

export interface PushPreviewProps {
  settings: DeviceSettings;
  screen: PushScreen;
  content: PushContent;
  /**
   * Makes the notification a button: clicking it opens the expanded view, and clicking it (or the backdrop)
   * there goes back to the screen it came from. Without it, the notification is static.
   */
  onScreenChange?: (screen: PushScreen) => void;
  /** Called with how each field fits whenever that changes: after a render, a resize or a font load. */
  onMeasure?: (measure: PushMeasure) => void;
  clock?: DeviceClock;
  /** How the phone fits its container: the smallest scale, and the room under it. */
  fit?: PhoneFit;
  className?: string;
}

/**
 * A push notification on a phone, in the platform's look: the lock screen, a banner (iOS) or heads-up
 * (Android) over the home screen, or the expanded view (iOS's long press, Android's shade). The phone is
 * laid out at its real size and scaled to fit its container (give the parent a height), so it cuts the
 * text exactly as that phone does. Android never shows the subtitle.
 */
export function PushPreview({ settings, screen, content, onScreenChange, onMeasure, clock = DEFAULT_CLOCK, fit, className }: PushPreviewProps) {
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

  const props = { content, settings, clock, onToggle };
  return (
    <PhoneFrame
      ref={root}
      platform={settings.platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={`${pushScreenLabel(settings.platform, screen)}, ${PLATFORM_STYLE[settings.platform]} preview`}
      fit={fit}
      className={className}
    >
      <Wallpaper />
      {settings.platform === "ios" ? (
        screen === "lock" ? (
          <LockScreen {...props} />
        ) : screen === "banner" ? (
          <Banner {...props} />
        ) : (
          <Expanded {...props} />
        )
      ) : screen === "lock" ? (
        <AndroidLockScreen {...props} />
      ) : screen === "banner" ? (
        <HeadsUp {...props} />
      ) : (
        <Shade {...props} />
      )}
    </PhoneFrame>
  );
}
