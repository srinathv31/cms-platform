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
