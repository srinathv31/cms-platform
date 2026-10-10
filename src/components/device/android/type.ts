import type { CSSProperties } from "react";
import { pt } from "../geometry";
import type { DeviceTextSize } from "../types";

// The Android skin's type: the Material 3 roles a Pixel uses, at three font scales. `default` is 100%,
// `large` is 130%, `ax` is the largest, 200%, with Android 14's non-linear scaling (big text grows less:
// 14sp becomes 28, 16sp about 30, 12sp 24). Sizes are in dp and drawn through `pt()`.

export type AndroidTextStyle = "title" | "body" | "label" | "message";

/** [size, line height] in dp per font scale. */
const RAMP: Record<DeviceTextSize, Record<AndroidTextStyle, readonly [number, number]>> = {
  default: { title: [16, 22], body: [14, 20], label: [12, 16], message: [16, 22] },
  large: { title: [21, 28], body: [18, 26], label: [16, 21], message: [21, 28] },
  ax: { title: [30, 41], body: [28, 40], label: [24, 32], message: [30, 41] },
};

/** Material 3's tracking per role, in em, so it scales with the size. */
const TRACKING: Record<AndroidTextStyle, number> = {
  title: 0.009, // titleMedium: 0.15sp at 16sp
  body: 0.018, // bodyMedium: 0.25sp at 14sp
  label: 0.03, // labelMedium: 0.5sp at 12sp, eased for Google Sans
  message: 0.009,
};

export function androidMetrics(style: AndroidTextStyle, textSize: DeviceTextSize): { size: number; lineHeight: number } {
  const [size, lineHeight] = RAMP[textSize][style];
  return { size, lineHeight };
}

/** The CSS for a Material role at a font scale. */
export function androidText(style: AndroidTextStyle, textSize: DeviceTextSize): CSSProperties {
  const { size, lineHeight } = androidMetrics(style, textSize);
  return { fontSize: pt(size), lineHeight: pt(lineHeight), letterSpacing: `${TRACKING[style]}em` };
}

/** Text that doesn't follow the font scale (the lock clock, the shade's header): a size and line height in dp. */
export function androidFixed(size: number, lineHeight: number, tracking = 0): CSSProperties {
  return { fontSize: pt(size), lineHeight: pt(lineHeight), letterSpacing: `${tracking}em` };
}
