import { Layer, MARK, STROKE, type DecorationProps } from "./sketch";

/** Each corner's two ticks: [x, y, dx, dy] from the corner, along the mark's edges and away from it. */
function corners(gap: number, arm: number, inset: number) {
  const a = inset;
  const b = MARK - inset;
  return [
    [a, a, -1, -1],
    [b, a, 1, -1],
    [b, b, 1, 1],
    [a, b, -1, 1],
  ]
    .map(
      ([x, y, dx, dy]) =>
        `M${x + dx * gap} ${y}h${dx * arm}M${x} ${y + dy * gap}v${dy * arm}`,
    )
    .join("");
}

/**
 * An extra: printer's crop marks at the mark's corners, the marks that say where a printed page is cut. Documents
 * made to spec. Straight lines on half units, so at `nav` they are the sharpest of the set on a 1x screen; at
 * `hero` a registration target in the accent sits off the top-right corner.
 */
export function CropMarksDecoration({ size }: DecorationProps) {
  const hero = size === "hero";
  return (
    <Layer
      box={{ left: -10, top: -10, width: 52, height: 52 }}
      viewBox="-10 -10 52 52"
      strokeWidth={STROKE[size].ink}
    >
      <path
        d={hero ? corners(2.5, 5, 0) : corners(2.5, 4, 0.5)}
        className="stroke-logo-ink"
        strokeLinecap="butt"
      />
      {hero && (
        <g strokeWidth={STROKE.hero.hairline}>
          <circle cx={MARK + 6} cy={-6} r={2.2} />
          <path d={`M${MARK + 2.6} -6h6.8M${MARK + 6} -9.4v6.8`} />
        </g>
      )}
    </Layer>
  );
}
