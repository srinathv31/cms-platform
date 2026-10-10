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
 * Screen sizes per platform and width class. iOS: a 375pt phone (the compact size), a 402pt one (today's
 * standard size) and a 440pt one (the large size). The heights cap the frame in a very tall container.
 */
export const SCREEN_SIZES: Record<DevicePlatform, Record<DeviceWidth, ScreenSize>> = {
  ios: {
    compact: { width: 375, height: 812, radius: 48 },
    standard: { width: 402, height: 874, radius: 56 },
    large: { width: 440, height: 956, radius: 58 },
  },
  // Placeholder until the Android skin lands (it brings its own dp sizes).
  android: {
    compact: { width: 360, height: 780, radius: 40 },
    standard: { width: 412, height: 915, radius: 44 },
    large: { width: 448, height: 998, radius: 46 },
  },
};

/** The frame round the screen, in points: a dark metal rim, then the black glass edge. */
export const BEZEL = { rim: 2.5, glass: 7.5 } as const;
export const BEZEL_WIDTH = BEZEL.rim + BEZEL.glass;

/** The phone's whole width in points: the screen plus the bezel on both sides. */
export function frameWidth(size: ScreenSize): number {
  return size.width + 2 * BEZEL_WIDTH;
}
