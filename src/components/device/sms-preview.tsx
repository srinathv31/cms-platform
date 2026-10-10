"use client";

import { PLATFORM_STYLE } from "./labels";
import { PhoneFrame } from "./phone-frame";
import { DEFAULT_CLOCK } from "./push-preview";
import { AndroidMessagesThread } from "./android/messages-thread";
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
  const props = { content, settings, clock };
  return (
    <PhoneFrame
      platform={settings.platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={`Text message from ${content.sender}, ${PLATFORM_STYLE[settings.platform]} preview`}
      className={className}
    >
      {settings.platform === "ios" ? <MessagesThread {...props} /> : <AndroidMessagesThread {...props} />}
    </PhoneFrame>
  );
}
