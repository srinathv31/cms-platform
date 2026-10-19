import type { CSSProperties } from "react";
import { edge, STROKE, type StencilLogoSize } from "./sketch";

/** A sheet of paper behind the mark, in units. `fold` cuts its top-right corner into a dog-ear that size. */
export interface Sheet {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fold?: number;
  /** A tinted sheet instead of a white one. */
  wash?: boolean;
  /** Short lines of "text" in the strip that shows above the sheet in front (hero only). */
  lines?: readonly (readonly [number, number, number])[];
  /** Hand-drawn bows for the top, right, bottom and left edges (hero only). */
  bows?: readonly [number, number, number, number];
  /** Degrees clockwise about its centre, so the stack looks laid by hand (hero only). */
  tilt?: number;
  /**
   * How far the sheet swings when the stack fans out: units across, units down, and degrees about `FAN_PIVOT`,
   * each times `--logo-fan`, which the lockup takes from 0 to 1 on hover. The front sheet has none: it stays put
   * and the ones behind it fan.
   */
  fan?: readonly [number, number, number];
}

/** What the sheets swing about: below the mark's middle, like a hand of cards held at the bottom. */
const FAN_PIVOT = [20, 32] as const;

export function fanStyle([dx, dy, degrees]: readonly [
  number,
  number,
  number,
]): CSSProperties {
  // CSS lengths on an SVG element are user units, so these are units at every size, like the drawing.
  return {
    transformOrigin: `${FAN_PIVOT[0]}px ${FAN_PIVOT[1]}px`,
    transform: `translate(calc(var(--logo-fan) * ${dx}px), calc(var(--logo-fan) * ${dy}px)) rotate(calc(var(--logo-fan) * ${degrees}deg))`,
  };
}

/**
 * Template Stack's sheets, back to front: each offset up and to the left of the one in front, so what shows of
 * it is an L along the mark's top and left; the front one dog-eared over the mark's top-right corner, the one
 * behind it tinted. Hybrid Stack and Ultimate use them too.
 */
export const TINTED_SHEETS: Record<StencilLogoSize, readonly Sheet[]> = {
  // Two sheets on half units: every straight edge is a sharp 1px line on a 1x screen.
  nav: [
    {
      x0: -7.5,
      y0: -10.5,
      x1: 22.5,
      y1: 23.5,
      wash: true,
      fan: [-1, -1.5, -7],
    },
    { x0: -3.5, y0: -5.5, x1: 26.5, y1: 28.5, fold: 5 },
  ],
  hero: [
    {
      x0: -12,
      y0: -18,
      x1: 19,
      y1: 17,
      bows: [0.35, -0.2, 0, 0.3],
      tilt: -5,
      lines: [
        [-8, -14.5, 13],
        [-8, -12.4, 8],
      ],
      fan: [-1.5, -2, -9],
    },
    {
      x0: -8,
      y0: -12,
      x1: 23,
      y1: 23,
      wash: true,
      bows: [-0.3, 0, 0, -0.25],
      tilt: -2,
      fan: [-0.75, -1, -4.5],
    },
    { x0: -4, y0: -7.5, x1: 27, y1: 28, fold: 7, bows: [0.25, 0.2, 0, 0.35] },
  ],
};

/** The paper's outline: a rectangle, its top-right corner cut by the fold. */
function outline({ x0, y0, x1, y1, fold = 0 }: Sheet) {
  return fold
    ? `M${x0} ${y0}H${x1 - fold}L${x1} ${y0 + fold}V${y1}H${x0}Z`
    : `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
}

/**
 * Sheets drawn back to front, each filled with paper so it hides the one behind. At `nav` an outline is one
 * closed path on half units, so its straight edges land on pixel centres. At `hero` the edges are drawn one at a
 * time, overshooting the corners a little and bowed by hand, the way a sketch is.
 */
export function SheetStack({
  size,
  sheets,
}: {
  size: StencilLogoSize;
  sheets: readonly Sheet[];
}) {
  return (
    <g strokeWidth={STROKE[size].ink}>
      {sheets.map((sheet, i) => (
        <SheetShape key={i} size={size} sheet={sheet} />
      ))}
    </g>
  );
}

function SheetShape({ size, sheet }: { size: StencilLogoSize; sheet: Sheet }) {
  const { x0, y0, x1, y1, fold = 0, tilt } = sheet;
  const paper = sheet.wash ? "fill-logo-wash" : "fill-logo-paper";
  // Two groups: a CSS transform on an SVG element replaces its transform attribute, so the fan and the tilt
  // can't share one.
  return (
    <g style={sheet.fan && fanStyle(sheet.fan)}>
      <g
        transform={
          size === "hero" && tilt
            ? `rotate(${tilt} ${(x0 + x1) / 2} ${(y0 + y1) / 2})`
            : undefined
        }
      >
        <path d={outline(sheet)} className={paper} stroke="none" />
        {size === "nav" ? (
          <path d={outline(sheet)} className="stroke-logo-ink" />
        ) : (
          <path d={sketchedOutline(sheet)} className="stroke-logo-ink" />
        )}
        {fold > 0 && (
          <path
            d={`M${x1 - fold} ${y0}V${y0 + fold}H${x1}`}
            className="fill-logo-wash stroke-logo-ink"
          />
        )}
        {size === "hero" &&
          sheet.lines?.map(([x, y, length], i) => (
            <path
              key={i}
              d={`M${x} ${y}h${length}`}
              strokeWidth={STROKE.hero.hairline}
            />
          ))}
      </g>
    </g>
  );
}

/** Four edges, each its own stroke: starting a little before its corner, ending a little after, bowed. */
function sketchedOutline({ x0, y0, x1, y1, fold = 0, bows }: Sheet) {
  const [top, right, bottom, left] = bows ?? [0, 0, 0, 0];
  const o = 0.9; // overshoot past each corner
  return [
    edge(x0 - o, y0, x1 - fold + o * 0.4, y0, top),
    fold ? edge(x1 - fold, y0, x1, y0 + fold, 0) : "",
    edge(x1, y0 + fold - o * 0.4, x1, y1 + o, right),
    edge(x1 + o * 0.6, y1, x0 - o * 0.4, y1, bottom),
    edge(x0, y1 + o * 0.5, x0, y0 - o, left),
  ]
    .filter(Boolean)
    .join("");
}
