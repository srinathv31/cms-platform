import type { CSSProperties } from "react";
import { pt } from "../geometry";
import type { DeviceTextSize } from "../types";

// The iPhone skin's type: Apple's Dynamic Type ramp at three reader sizes, and Apple's tracking for each
// point size. Sizes are in points and drawn through `pt()`, so they scale with the frame.

/** The text styles the skin uses, named as UIKit names them. */
export type IosTextStyle = "body" | "subheadline" | "footnote" | "caption";

/** [size, line height] in points, per reader size: Large (the default), xxxLarge, and AX1. */
const RAMP: Record<DeviceTextSize, Record<IosTextStyle, readonly [number, number]>> = {
  default: { body: [17, 22], subheadline: [15, 20], footnote: [13, 18], caption: [12, 16] },
  large: { body: [23, 29], subheadline: [21, 26], footnote: [19, 24], caption: [18, 23] },
  ax: { body: [28, 34], subheadline: [25, 31], footnote: [23, 29], caption: [22, 27] },
};

/** Apple's tracking for SF Pro, in points, by point size (between two rows it is interpolated). */
const TRACKING: readonly (readonly [number, number])[] = [
  [6, 0.24], [8, 0.21], [10, 0.12], [11, 0.06], [12, 0], [13, -0.08], [14, -0.15], [15, -0.23], [16, -0.31],
  [17, -0.43], [18, -0.44], [19, -0.45], [20, -0.45], [21, -0.36], [22, -0.26], [23, -0.1], [24, 0.07],
  [25, 0.15], [26, 0.22], [27, 0.29], [28, 0.38], [30, 0.4], [34, 0.4], [40, 0.37], [48, 0.35], [56, 0.3],
  [64, 0.22], [72, 0.14], [80, 0],
];

/** Apple's tracking for a point size, in points. */
export function tracking(size: number): number {
  const first = TRACKING[0]!;
  const last = TRACKING[TRACKING.length - 1]!;
  if (size <= first[0]) return first[1];
  if (size >= last[0]) return last[1];
  for (let i = 1; i < TRACKING.length; i++) {
    const [s1, t1] = TRACKING[i]!;
    const [s0, t0] = TRACKING[i - 1]!;
    if (size <= s1) return t0 + ((t1 - t0) * (size - s0)) / (s1 - s0);
  }
  return last[1];
}

/** A text style's size and line height in points at a reader size. */
export function textMetrics(style: IosTextStyle, textSize: DeviceTextSize): { size: number; lineHeight: number } {
  const [size, lineHeight] = RAMP[textSize][style];
  return { size, lineHeight };
}

/** The CSS for a text style at a reader size: size, line height and tracking, all in points. */
export function textStyle(style: IosTextStyle, textSize: DeviceTextSize): CSSProperties {
  const { size, lineHeight } = textMetrics(style, textSize);
  return fixedText(size, lineHeight);
}

/** Text that doesn't follow the reader's size (the clock, the status bar): a size and line height in points. */
export function fixedText(size: number, lineHeight: number): CSSProperties {
  return { fontSize: pt(size), lineHeight: pt(lineHeight), letterSpacing: pt(Number(tracking(size).toFixed(3))) };
}
