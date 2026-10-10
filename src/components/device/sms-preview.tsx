"use client";

import { PhoneFrame } from "./phone-frame";
import { DEFAULT_CLOCK } from "./push-preview";
import { MessagesThread } from "./ios/messages-thread";
import type { DeviceClock, DeviceSettings, SmsContent } from "./types";

export interface SmsPreviewProps {
  /** `previewsHidden` doesn't apply: the thread is the open app. */
  settings: DeviceSettings;
  content: SmsContent;
  clock?: DeviceClock;
  className?: string;
}

/**
 * A text message in the phone's messaging app, in the platform's look. Same geometry as `PushPreview`:
 * the container's height, the platform's exact width. The text is never cut; a long one scrolls.
 */
export function SmsPreview({ settings, content, clock = DEFAULT_CLOCK, className }: SmsPreviewProps) {
  return (
    <PhoneFrame
      platform={settings.platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={`Text message from ${content.sender}, ${settings.platform === "ios" ? "iOS" : "Android"}-style preview`}
      className={className}
    >
      {settings.platform === "ios" ? (
        <MessagesThread content={content} settings={settings} clock={clock} />
      ) : null /* The Android skin (android/) comes next: a blank screen until then. */}
    </PhoneFrame>
  );
}
