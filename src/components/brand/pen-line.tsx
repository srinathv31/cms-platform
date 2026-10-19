import { Pen, type PenTool } from "./pen";
import type { CSSProperties } from "react";
import { brush, pointAtX, swell } from "./rough";
import { em, Layer, r, STROKE, type StencilLogoSize } from "./sketch";

/** The pen layer's box around the tip, in units: the tip is its point (0, 0). */
const PEN_BOX = { x: -6, y: -16, width: 22, height: 20 };

/** Where a pen line runs, in units: x from the lockup's left, except the tip, which is from the wordmark's end. */
export interface PenLineGeometry {
  /** Where the line starts. */
  startX: number;
  startY: number;
  /** The height it levels off at, `crestInset` units before the wordmark's end. */
  crestY: number;
  crestInset: number;
  /** The tip of the pen, where the line ends: units right of the wordmark's end, and down from the lockup's top. */
  tipX: number;
  tipY: number;
  /** The pen's lean, degrees clockwise from upright, and its size. */
  angle: number;
  penScale: number;
  /** Two short ticks beside the pen (hero only). */
  motion?: boolean;
  /** The line's weight in CSS pixels; the size's accent weight unless set. */
  weight?: number;
  /**
   * At `hero`, draw the line as a brush stroke instead: units across where it starts, at its fullest, at the
   * crest and at the tip. `nav` keeps the even line, which stays sharp at that size.
   */
  brush?: { start: number; full: number; crest: number; tip: number };
}

/**
 * A pen line over the wordmark, in three layers. The rise is a stretching layer between the start and the crest,
 * so it spans whatever width the wordmark renders at; it leaves the crest level, the one direction a sideways
 * stretch can't bend. The fall is a fixed layer anchored to the wordmark's end. The pen is a layer of its own, its
 * tip at the line's end, so it keeps its shape and its angle to the line.
 *
 * On hover the pen draws the line (keyframes in globals.css): it travels the curve through 15 stops, nine on the
 * rise and six on the fall, and each layer of line is wiped in to exactly where the pen is. The stops are worked
 * out here, in em and in percentages of the lockup's width, since the rise stretches.
 */
export function PenLine({
  size,
  tool,
  geometry: g,
}: {
  size: StencilLogoSize;
  tool: PenTool;
  geometry: PenLineGeometry;
}) {
  const weight = g.weight ?? STROKE[size].accent;

  // The rise: 0..100 across, units down. It starts steep and arrives at the crest level.
  const riseTop = g.crestY - 4;
  const riseHeight = g.startY - g.crestY + 8;
  const s = g.startY - riseTop;
  const c = g.crestY - riseTop;
  const rise = `M0 ${r(s)}C24 ${r(s - (s - c) * 0.8)} 60 ${r(c)} 100 ${r(c)}`;

  // The fall: from the crest, level, curving down into the tip.
  const extent = g.tipX + 16;
  const fallTop = g.crestY - 6;
  const fallWidth = g.crestInset + extent;
  const fallHeight = Math.max(g.tipY - fallTop + 8, 20);
  const jy = g.crestY - fallTop;
  const tx = g.crestInset + g.tipX;
  const ty = g.tipY - fallTop;
  const fall = `M0 ${r(jy)}C${r(tx * 0.45)} ${r(jy)} ${r(tx * 0.84)} ${r(jy + (ty - jy) * 0.3)} ${r(tx)} ${r(ty)}`;

  // The brush: the same curves as filled shapes. The rise's width is measured straight down, so the sideways
  // stretch never thins it, and it runs a unit past the crest under the fall's start, so the two meet without a
  // seam.
  const b = size === "hero" ? g.brush : undefined;
  const riseBrush =
    b &&
    brush(
      [
        [0, s],
        [24, s - (s - c) * 0.8],
        [60, c],
        [101, c],
      ],
      swell(b.start, b.full, b.crest),
      { vertical: true, steps: 36 },
    );
  const fallBrush =
    b &&
    brush(
      [
        [-0.5, jy],
        [tx * 0.45, jy],
        [tx * 0.84, jy + (ty - jy) * 0.3],
        [tx, ty],
      ],
      (t) => b.crest + (b.tip - b.crest) * t ** 1.3,
      { steps: 20 },
    );

  // The pen's stops. Along the rise, at even steps across it: x as a share of the stretch, y off the curve there.
  const riseCurve = [
    [0, s],
    [24, s - (s - c) * 0.8],
    [60, c],
    [100, c],
  ] as const;
  const fallCurve = [
    [0, jy],
    [tx * 0.45, jy],
    [tx * 0.84, jy + (ty - jy) * 0.3],
    [tx, ty],
  ] as const;
  const stops: [string, string][] = [];
  for (let k = 0; k <= 8; k++) {
    const q = k / 8;
    const [, y] = pointAtX(riseCurve, q * 100);
    stops.push([
      `calc(${em(g.startX + PEN_BOX.x)} + (100% - ${em(g.startX + g.crestInset)}) * ${q})`,
      em(riseTop + y + PEN_BOX.y),
    ]);
  }
  // Along the fall, at even steps across it, from the crest (the wordmark's end less the inset).
  for (let j = 1; j <= 6; j++) {
    const [x, y] = pointAtX(fallCurve, (tx * j) / 6);
    stops.push([
      `calc(100% + ${em(x - g.crestInset + PEN_BOX.x)})`,
      em(fallTop + y + PEN_BOX.y),
    ]);
  }
  const penStops = Object.fromEntries(
    stops.flatMap(([x, y], i) => [
      [`--pen-x-${i}`, x],
      [`--pen-y-${i}`, y],
    ]),
  ) as CSSProperties;

  return (
    <>
      <Layer
        draw="rise"
        box={{
          left: g.startX,
          right: g.crestInset,
          top: riseTop,
          height: riseHeight,
        }}
        viewBox={`0 0 100 ${riseHeight}`}
        stretch
        strokeWidth={weight}
      >
        {riseBrush ? (
          <path d={riseBrush} fill="currentColor" stroke="none" />
        ) : (
          <path d={rise} />
        )}
      </Layer>
      <Layer
        draw="fall"
        box={{
          right: -extent,
          width: fallWidth,
          top: fallTop,
          height: fallHeight,
        }}
        viewBox={`0 0 ${fallWidth} ${fallHeight}`}
        style={{ "--fall-shown": em(fallWidth - tx) } as CSSProperties}
        strokeWidth={weight}
      >
        {fallBrush ? (
          <path d={fallBrush} fill="currentColor" stroke="none" />
        ) : (
          <path d={fall} />
        )}
      </Layer>
      <Layer
        draw="pen"
        box={{
          right: -(g.tipX + PEN_BOX.width + PEN_BOX.x),
          width: PEN_BOX.width,
          top: g.tipY + PEN_BOX.y,
          height: PEN_BOX.height,
        }}
        viewBox={`${PEN_BOX.x} ${PEN_BOX.y} ${PEN_BOX.width} ${PEN_BOX.height}`}
        // It turns about its tip: it leans back while it travels and settles as it lands.
        style={{
          ...penStops,
          transformOrigin: `${em(-PEN_BOX.x)} ${em(-PEN_BOX.y)}`,
        }}
        strokeWidth={STROKE[size].ink}
      >
        {/* Motion ticks ride with the pen while it draws, and stay by it when it stops. */}
        {g.motion && size === "hero" && (
          <g strokeWidth={STROKE.hero.hairline}>
            <path d="M8 -5.5L12 -8" />
            <path d="M9 -1L13.5 -1.8" />
          </g>
        )}
        <Pen
          tool={tool}
          size={size}
          x={0}
          y={0}
          angle={g.angle}
          scale={g.penScale}
        />
      </Layer>
    </>
  );
}
