import { fanStyle } from "./page-stack";
import { roughLine } from "./rough";
import { r, STROKE, type StencilLogoSize } from "./sketch";

type Point = readonly [number, number];

/**
 * A sheet in a used stack, in units: larger than the mark, so it shows on every side, and turned `tilt` degrees
 * about its centre even at rest. `fold` dog-ears its top-right corner; `seed` picks its wobble.
 */
export interface RuggedSheet {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tilt: number;
  seed: number;
  fold?: number;
  /** A tinted sheet instead of a plain one. */
  wash?: boolean;
  /** How it swings when the stack fans out on hover, as in `Sheet` (page-stack.tsx). */
  fan?: readonly [number, number, number];
}

/**
 * Back to front. The back sheet is the dog-eared one, its corner turned up above the others: a stack that has
 * been used. The middle one is tinted and leans left; the front one leans right and shows past the mark's right
 * and bottom edges.
 */
export const RUGGED_SHEETS: readonly RuggedSheet[] = [
  {
    x0: -5,
    y0: -19,
    x1: 35,
    y1: 24,
    tilt: -3.5,
    seed: 11,
    fold: 10,
    fan: [-1.5, -2, -5],
  },
  {
    x0: -12,
    y0: -9,
    x1: 27,
    y1: 33,
    tilt: -7,
    seed: 23,
    wash: true,
    fan: [-1.5, -0.5, -4.5],
  },
  { x0: -4, y0: -4, x1: 36, y1: 37, tilt: 2.5, seed: 37, fan: [0.5, 0.5, 2.5] },
];

/**
 * A used stack of sheets. Each edge is ruled by hand (`roughLine`): it wobbles, and it starts before its corner
 * and runs past it. At `hero` each edge has a second, lighter pass beside the first, the way a pencil goes back
 * over a line. At `nav` there is one pass, with less wobble.
 */
export function RuggedStack({
  size,
  sheets,
  fans,
}: {
  size: StencilLogoSize;
  sheets: readonly RuggedSheet[];
  /** Overrides each sheet's `fan`, by index: a stack whose back sheet anchors a pen line keeps it still. */
  fans?: readonly (RuggedSheet["fan"] | null)[];
}) {
  return (
    <g strokeWidth={STROKE[size].ink}>
      {sheets.map((sheet, i) => {
        const fan = fans ? fans[i] : sheet.fan;
        return (
          <g key={i} style={fan ? fanStyle(fan) : undefined}>
            <RuggedSheetShape size={size} sheet={sheet} />
          </g>
        );
      })}
    </g>
  );
}

function RuggedSheetShape({
  size,
  sheet,
}: {
  size: StencilLogoSize;
  sheet: RuggedSheet;
}) {
  const { x0, y0, x1, y1, fold = 0, tilt, seed } = sheet;
  const hero = size === "hero";
  const corners: Point[] = fold
    ? [
        [x0, y0],
        [x1 - fold, y0],
        [x1, y0 + fold],
        [x1, y1],
        [x0, y1],
      ]
    : [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
  const paper = `M${corners.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
  const edges = corners.map((a, i) => [a, corners[(i + 1) % corners.length]]);
  const amp = hero ? 0.45 : 0.18;
  const overshoot = hero ? 1.1 : 0.6;
  const lines = edges
    .map(([a, b], i) => roughLine(a, b, seed * 10 + i, { amp, overshoot }))
    .join("");
  // The second pass: part of each edge, a hair to one side, lighter.
  const retrace = hero
    ? edges
        .map(([a, b], i) => {
          const k = seed * 10 + i + 50;
          const start = i % 2 ? 0.05 : 0.3;
          return roughLine(a, b, k, {
            amp: 0.5,
            overshoot: 0.6,
            from: start,
            to: start + 0.6,
            shift: i % 2 ? 0.45 : -0.4,
          });
        })
        .join("")
    : "";

  return (
    <g transform={`rotate(${tilt} ${(x0 + x1) / 2} ${(y0 + y1) / 2})`}>
      <path
        d={paper}
        className={sheet.wash ? "fill-logo-wash" : "fill-logo-paper-used"}
        stroke="none"
      />
      <path d={lines} className="stroke-logo-ink" />
      {hero && (
        <path
          d={retrace}
          className="stroke-logo-ink"
          strokeWidth={STROKE.hero.hairline}
          opacity={0.55}
        />
      )}
      {fold > 0 && <DogEar size={size} x1={x1} y0={y0} fold={fold} />}
    </g>
  );
}

/**
 * The turned-down corner: a flap from the cut on the top edge to the cut on the right edge, its tip short of the
 * corner it was and its edges curled. Tinted, so the stack's one dog-ear carries the accent.
 */
function DogEar({
  size,
  x1,
  y0,
  fold,
}: {
  size: StencilLogoSize;
  x1: number;
  y0: number;
  fold: number;
}) {
  const p1: Point = [x1 - fold, y0];
  const p2: Point = [x1, y0 + fold];
  const tip: Point = [x1 - fold * 0.88, y0 + fold * 0.9];
  const d =
    size === "hero"
      ? `M${p1[0]} ${p1[1]}Q${x1 - fold * 1.1} ${y0 + fold * 0.42} ${tip[0]} ${tip[1]}Q${x1 - fold * 0.42} ${y0 + fold * 1.08} ${p2[0]} ${p2[1]}Z`
      : `M${p1[0]} ${p1[1]}L${tip[0]} ${tip[1]}L${p2[0]} ${p2[1]}Z`;
  return <path d={d} className="fill-logo-wash stroke-logo-ink" />;
}

/**
 * Watercolour over the drawing, round the mark's lower left: two pools of the wash, multiplied, so the lines
 * show through and where they overlap the colour is deeper, as a second coat would be. Flat fills; no gradient.
 */
export function Wash({ size }: { size: StencilLogoSize }) {
  return (
    <g
      className="fill-logo-wash forced-colors:hidden"
      stroke="none"
      style={{ mixBlendMode: "multiply" }}
    >
      <path d="M-11 25.5C-10 21.5-6.5 20.5-3 21.5C.5 22.5 2 20 6 20.5C11 21 16.5 24 19 27.5C21 30.5 19.5 34 15.5 35C11.5 36 8.5 34.5 4.5 35.5C.5 36.5-4 38-7.5 36C-10.5 34.5-12 29.5-11 25.5Z" />
      {size === "hero" && (
        <path d="M-9.5 30C-9.5 27.5-7 26.5-5 27.5C-3 28.5-3.5 31.5-5.5 32.5C-7.5 33.5-9.5 32.5-9.5 30Z" />
      )}
    </g>
  );
}

// Up-left, left and down-left, 34° apart: written out, so no trig runs at render.
const SPARK_DIRECTIONS = [
  [-0.829, -0.559],
  [-1, 0],
  [-0.829, 0.559],
] as const;

/**
 * Three short strokes off the stack's left side, the sketch's mark for "look here": they fan out from a point
 * inside the stack and stop short of it, so they never meet in an arrowhead. Hero only: at `nav` they are 3px
 * ticks against the sidebar's edge, a smudge.
 */
export function Sparks({ size }: { size: StencilLogoSize }) {
  if (size === "nav") return null;
  const [x, y, near, far] = [-11, 12, 4.5, 9];
  const ticks = SPARK_DIRECTIONS.map(([dx, dy]) => {
    const at = (d: number) => `${r(x + dx * d)} ${r(y + dy * d)}`;
    return `M${at(near)}L${at(far)}`;
  });
  return <path d={ticks.join("")} className="stroke-logo-ink" />;
}
