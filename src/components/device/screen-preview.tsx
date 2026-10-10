"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pt } from "./geometry";
import { PLATFORM_STYLE } from "./labels";
import { PhoneFrame, cutoutWidth } from "./phone-frame";
import { DEFAULT_CLOCK } from "./push-preview";
import { HomeIndicator, STATUS_BAR_HEIGHT, StatusBar } from "./status-bar";
import type { DeviceClock, DevicePlatform, DeviceSettings, PhoneFit } from "./types";

/** The strip a full-screen app leaves clear along the bottom edge for the home indicator or gesture handle. */
const BOTTOM_INSET: Record<DevicePlatform, number> = { ios: 34, android: 24 };

/** An app's own background and text, per platform. */
const APP_SURFACE: Record<DevicePlatform, string> = {
  ios: "bg-(--device-bg) text-(--device-label)",
  android: "bg-(--device-m3-surface) text-(--device-m3-on-surface)",
};

export interface ScreenPreviewProps {
  /** `previewsHidden` and `textSize` don't apply: the content is the caller's. */
  settings: Pick<DeviceSettings, "platform" | "appearance" | "width">;
  /** What the screen shows, e.g. "Web page from Coral". The figure's name adds the skin: ", iOS-style preview". */
  caption: string;
  /** The app's content. It fills the screen between the status bar and the bottom inset, top to bottom. */
  children: ReactNode;
  clock?: DeviceClock;
  /** How the phone fits its container: the smallest scale, and the room under it. */
  fit?: PhoneFit;
  className?: string;
}

/**
 * Any app's screen on the phone, for content that isn't a push or a text: the frame, the status bar and the
 * home indicator (iOS) or gesture handle (Android) around what the caller draws, such as a web page in an
 * iframe. Same geometry as `PushPreview`: the phone at its real size, scaled to fit its container, so a
 * web page inside lays out at the phone's real width.
 */
export function ScreenPreview({ settings, caption, children, clock = DEFAULT_CLOCK, fit, className }: ScreenPreviewProps) {
  const { platform } = settings;
  return (
    <PhoneFrame
      platform={platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={`${caption}, ${PLATFORM_STYLE[platform]} preview`}
      fit={fit}
      className={className}
    >
      <div
        data-slot="device-app"
        className={cn("absolute inset-0 flex flex-col", APP_SURFACE[platform])}
        style={{ paddingTop: pt(STATUS_BAR_HEIGHT[platform]), paddingBottom: pt(BOTTOM_INSET[platform]) }}
      >
        {children}
      </div>
      <StatusBar platform={platform} time={clock.time} ink="app" cutout={platform === "ios" ? cutoutWidth("ios") : 0} />
      <HomeIndicator platform={platform} ink="app" />
    </PhoneFrame>
  );
}
