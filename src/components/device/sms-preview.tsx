"use client";

import { smsCaption } from "./labels";
import { PhoneFrame } from "./phone-frame";
import { DEFAULT_CLOCK } from "./push-preview";
import { AndroidMessagesThread } from "./android/messages-thread";
import { MessagesThread } from "./ios/messages-thread";
import type { DeviceClock, DeviceSettings, PhoneFit, SmsContent } from "./types";

export interface SmsPreviewProps {
  /** `previewsHidden` doesn't apply: the thread is the open app. */
  settings: DeviceSettings;
  content: SmsContent;
  clock?: DeviceClock;
  /** How the phone fits its container: the smallest scale, and the room under it. */
  fit?: PhoneFit;
  className?: string;
}

/**
 * A text message in the phone's messaging app, in the platform's look. Same geometry as `PushPreview`:
 * the phone at its real size, scaled to fit its container. The text is never cut; a long one scrolls.
 * With no sender, the header shows a muted "No sender" and the caption leaves out "from".
 */
export function SmsPreview({ settings, content, clock = DEFAULT_CLOCK, fit, className }: SmsPreviewProps) {
  const props = { content, settings, clock };
  return (
    <PhoneFrame
      platform={settings.platform}
      width={settings.width}
      appearance={settings.appearance}
      caption={smsCaption(settings.platform, content.sender)}
      fit={fit}
      className={className}
    >
      {settings.platform === "ios" ? <MessagesThread {...props} /> : <AndroidMessagesThread {...props} />}
    </PhoneFrame>
  );
}
