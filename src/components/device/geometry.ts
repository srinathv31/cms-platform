import { containScale, type BoxSize } from "@/components/primitives/scaled-viewport";
import type { DevicePlatform, DeviceWidth } from "./types";

// The phone is laid out at its real size, one device point to one CSS pixel, and then the whole of it is
// scaled with a transform to fit its container (phone-frame.tsx). A transform doesn't lay text out again,
// so every line breaks and every field cuts exactly where it does at 1:1, at any scale.

/** `n` device points, as a CSS length. Inside the phone a point is a CSS pixel. */
export function pt(n: number): string {
  return n === 0 ? "0" : `${n}px`;
}

/** A screen's size in points, and the radius of its corners. */
export interface ScreenSize {
  width: number;
  height: number;
  radius: number;
}

/**
 * Screen sizes per platform and width class, in the platform's own unit (iOS points, Android dp; one CSS
 * px either way), with the screen's corner radius.
 *
 * iOS:
 *   - compact 375 × 812, the 5.4" size (iPhone 12 mini and 13 mini); corners 44pt.
 *   - standard 402 × 874, iPhone 17 and 17 Pro (1206 × 2622 px at 3x); corners 62pt.
 *   - large 440 × 956, iPhone 17 Pro Max (1320 × 2868 px at 3x); corners 62pt.
 *   The radii are what UIScreen reports (`_displayCornerRadius`, as the ScreenCorners project lists them;
 *   the 402 and 440 sizes first shipped as the iPhone 16 Pro and Pro Max).
 * Android:
 *   - compact 360 × 800, the most common Android viewport (1080 × 2400 px at 3.0, e.g. a Galaxy S21).
 *   - standard 412 × 915, a Pixel 8 (1080 × 2400 px at 2.625: 411.4 × 914.3, which Chrome rounds up).
 *   - large 448 × 997, a Pixel 9 Pro XL or 10 Pro XL (1344 × 2992 px at 3.0: 997.3).
 *   Corners 39dp: the Pixel 8's display corner is 102 px at 2.625, the 8 Pro's 115 px at 3.0.
 */
export const SCREEN_SIZES: Record<DevicePlatform, Record<DeviceWidth, ScreenSize>> = {
  ios: {
    compact: { width: 375, height: 812, radius: 44 },
    standard: { width: 402, height: 874, radius: 62 },
    large: { width: 440, height: 956, radius: 62 },
  },
  android: {
    compact: { width: 360, height: 800, radius: 39 },
    standard: { width: 412, height: 915, radius: 39 },
    large: { width: 448, height: 997, radius: 39 },
  },
};

/** The unit a platform's sizes are in, for labels: "402pt", "412dp". */
export const SIZE_UNIT: Record<DevicePlatform, string> = { ios: "pt", android: "dp" };

/**
 * The frame round the screen, in points: a metal rim, then the black glass border. From the phones' own
 * outlines, body against screen:
 *   - iPhone 17: 71.5 × 149.6 mm round a 66.6 × 144.8 mm screen, about 2.4 mm a side, 14.5pt.
 *   - Pixel 9: 72.0 × 152.8 mm round a 65.0 × 145.9 mm screen, about 3.5 mm a side, 21.5dp.
 * So the whole phone has the real one's proportions: 431 × 903 (0.477) against the iPhone's 0.478, and
 * 455 × 958 (0.475) against the Pixel's 0.471.
 */
export const BEZEL: Record<DevicePlatform, { rim: number; glass: number }> = {
  ios: { rim: 3, glass: 11.5 },
  android: { rim: 4, glass: 17.5 },
};

/** The bezel's whole width on each side, in points. */
export function bezelWidth(platform: DevicePlatform): number {
  return BEZEL[platform].rim + BEZEL[platform].glass;
}

/** The whole phone at 1:1, in CSS px: the screen plus the bezel on every side. */
export function frameSize(platform: DevicePlatform, width: DeviceWidth): BoxSize {
  const screen = SCREEN_SIZES[platform][width];
  const bezel = 2 * bezelWidth(platform);
  return { width: screen.width + bezel, height: screen.height + bezel };
}

/**
 * The smallest scale a phone fits its container's height at: about 8px for the 15pt notification text,
 * the least that reads comfortably. A container shorter than that keeps this scale, and the phone runs
 * past its bottom (the preview's well scrolls). A standard phone still fits whole in the 1280 × 800 well.
 */
export const MIN_SCALE = 0.55;

/**
 * The scale that fits a phone in `box`. A phone is never drawn bigger than the platform's standard phone
 * would be in the same box, so the compact size reads smaller, as it is; the standard and large sizes fit
 * the box, down to `minScale` for height. Never above 1.
 */
export function phoneScale(box: BoxSize, platform: DevicePlatform, width: DeviceWidth, minScale = MIN_SCALE): number {
  const own = frameSize(platform, width);
  const standard = frameSize(platform, "standard");
  return containScale(
    box,
    { width: Math.max(own.width, standard.width), height: Math.max(own.height, standard.height) },
    minScale,
  );
}
