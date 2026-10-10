import type { DevicePlatform, PushScreen } from "./types";

// What each platform calls a screen. The kit keeps one set of values (`PushScreen`); a preview's controls
// and captions take the platform's own words from here: a "banner" on iPhone is a "heads-up" on Android.

const SCREEN_LABELS: Record<DevicePlatform, Record<PushScreen, string>> = {
  ios: { lock: "Lock screen", banner: "Banner", expanded: "Expanded" },
  android: { lock: "Lock screen", banner: "Heads-up", expanded: "Expanded" },
};

/** The platform's name for a push screen: "Banner" on iPhone, "Heads-up" on Android. */
export function pushScreenLabel(platform: DevicePlatform, screen: PushScreen): string {
  return SCREEN_LABELS[platform][screen];
}

/** How the skins are named: generic looks, not the makers' own. */
export const PLATFORM_STYLE: Record<DevicePlatform, string> = { ios: "iOS-style", android: "Android-style" };

/**
 * What a text thread's header shows when the text has no sender (`SmsContent.sender` empty), in the
 * header's muted ink: a neutral placeholder, never a made-up number.
 */
export const NO_SENDER = "No sender";

/** The sender a text thread names: its short code or number, or null when it has none. */
export function smsSender(sender: string): string | null {
  return sender.trim() || null;
}

/** The text message figure's caption: "Text message from 26725, iOS-style preview", without "from" when there is no sender. */
export function smsCaption(platform: DevicePlatform, sender: string): string {
  const from = smsSender(sender);
  return `${from === null ? "Text message" : `Text message from ${from}`}, ${PLATFORM_STYLE[platform]} preview`;
}
