import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StencilLogoSize = "nav" | "hero";

export interface DecorationProps {
  size: StencilLogoSize;
}

/**
 * Design units per em. The lockup's font-size is the mark's side, so 1em is the mark and a unit is 1/32 of it:
 * one CSS pixel at `nav`, 2.5 at `hero`. Every position is written in units, so the decorations scale with the
 * one font-size and a straight line drawn on a half unit lands on a pixel centre at `nav` on a 1x screen.
 */
export const U = 32;

/** The lockup's geometry in units: the mark is the square 0..32, the wordmark starts after the gap. */
export const MARK = 32;
export const GAP = 12;
export const WORDMARK_X = MARK + GAP;

export const em = (units: number) => `${units / U}em`;

/**
 * Stroke weights in CSS pixels, set per size rather than scaled with it: every shape draws with
 * `vector-effect: non-scaling-stroke`. A nav line must sit on whole pixels to stay sharp on a 1x screen, and a
 * hero line two and a half times as thick reads as a marker, not a pen.
 */
export const STROKE = {
  nav: { ink: 1, accent: 1.5, hairline: 1 },
  hero: { ink: 1.5, accent: 2.5, hairline: 1.25 },
} as const satisfies Record<StencilLogoSize, Record<string, number>>;

/** Where a layer sits, in units from the lockup's edges. `right` anchors it to the end of the wordmark. */
export interface LayerBox {
  left?: number;
  right?: number;
  top: number;
  width?: number;
  height: number;
}

function boxStyle({ left, right, top, width, height }: LayerBox) {
  const style: CSSProperties = { top: em(top), height: em(height) };
  if (left !== undefined) style.left = em(left);
  if (right !== undefined) style.right = em(right);
  if (width !== undefined) style.width = em(width);
  // An absolute <svg> is a replaced element: `left` and `right` alone don't stretch it, so a layer anchored to
  // both edges takes the lockup's width less both insets.
  else if (left !== undefined && right !== undefined)
    style.width = `calc(100% - ${em(left + right)})`;
  return style;
}

/**
 * One decoration layer: an absolutely placed SVG that is never in the accessibility tree, never a click target
 * (the lockup is a link) and never clipped. `behind` paints it under the mark (the lockup is `isolate`).
 * `stretch` lets the layer's width follow the wordmark: the viewBox stretches sideways, and the non-scaling
 * stroke keeps the line's weight. Colour is `currentColor`, the accent unless the layer says otherwise.
 */
export function Layer({
  box,
  viewBox,
  stretch = false,
  behind = false,
  draw,
  style,
  strokeWidth,
  className,
  children,
}: {
  box: LayerBox;
  viewBox: string;
  stretch?: boolean;
  behind?: boolean;
  /** Its part in the draw on hover (globals.css): a line or an underline pass wiped in, or the pen that travels. */
  draw?: "rise" | "fall" | "pen" | "underline" | "underline-2";
  /** Custom properties the draw reads: the pen's stops, the fall's reveal. */
  style?: CSSProperties;
  strokeWidth: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="logo-decoration"
      data-draw={draw}
      viewBox={viewBox}
      preserveAspectRatio={stretch ? "none" : undefined}
      overflow="visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ ...boxStyle(box), ...style }}
      className={cn(
        "pointer-events-none absolute overflow-visible text-logo-accent [&_*]:[vector-effect:non-scaling-stroke]",
        behind && "-z-1",
        className,
      )}
    >
      {children}
    </svg>
  );
}

/**
 * An edge drawn by hand: a quadratic from a to b whose middle is pushed `bow` units to its left (negative, to
 * its right). The bows are chosen per edge, so the drawing is the same on every render.
 */
export function edge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bow = 0,
): string {
  const length = Math.hypot(bx - ax, by - ay) || 1;
  const cx = (ax + bx) / 2 + ((by - ay) / length) * bow;
  const cy = (ay + by) / 2 - ((bx - ax) / length) * bow;
  return `M${r(ax)} ${r(ay)}Q${r(cx)} ${r(cy)} ${r(bx)} ${r(by)}`;
}

/** Two decimals: enough for a 2.5px unit, and stable text for the server and client renders. */
export const r = (n: number) => String(Math.round(n * 100) / 100);
