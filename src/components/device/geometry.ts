import type { DevicePlatform, DeviceWidth } from "./types";

// Every size inside the phone is written in device points and drawn as a multiple of `--pt`, which the
// frame sets from its container's width (tokens.css registers it). At 1:1 one point is one CSS pixel; in a
// narrower container the whole phone shrinks evenly, so its text wraps exactly as it does at 1:1.

/** `n` device points, as a CSS length. */
export function pt(n: number): string {
  return n === 0 ? "0" : `calc(${n} * var(--pt))`;
}

/** A screen's size in points, and the radius of its corners. */
export interface ScreenSize {
  width: number;
  height: number;
  radius: number;
}

/**
 * Screen sizes per platform and width class, in the platform's own unit (iOS points, Android dp; one `--pt`
 * either way). The heights cap the frame in a very tall container.
 *   iOS: 375pt (the compact size), 402pt (today's standard), 440pt (the large size).
 *   Android: 360dp (the common compact width), 412dp (a standard Pixel, 1080 px at 2.625), 448dp (a large
 *   Pro XL Pixel, 1344 px at 3.0). Their corners are a little tighter than an iPhone's.
 */
export const SCREEN_SIZES: Record<DevicePlatform, Record<DeviceWidth, ScreenSize>> = {
  ios: {
    compact: { width: 375, height: 812, radius: 48 },
    standard: { width: 402, height: 874, radius: 56 },
    large: { width: 440, height: 956, radius: 58 },
  },
  android: {
    compact: { width: 360, height: 800, radius: 40 },
    standard: { width: 412, height: 915, radius: 46 },
    large: { width: 448, height: 998, radius: 48 },
  },
};

/** The unit a platform's sizes are in, for labels: "402pt", "412dp". */
export const SIZE_UNIT: Record<DevicePlatform, string> = { ios: "pt", android: "dp" };

/** The frame round the screen, in points: a dark metal rim, then the black glass edge. */
export const BEZEL = { rim: 2.5, glass: 7.5 } as const;
export const BEZEL_WIDTH = BEZEL.rim + BEZEL.glass;

/** The phone's whole width in points: the screen plus the bezel on both sides. */
export function frameWidth(size: ScreenSize): number {
  return size.width + 2 * BEZEL_WIDTH;
}
