import { brush, swell } from "./rough";
import { Layer, STROKE, WORDMARK_X, type DecorationProps } from "./sketch";

// The stroke as a brush at `hero`: a light touch, full early, flicking off thin at the right.
const BRUSHED = brush(
  [
    [0, 4.6],
    [24, 3.9],
    [62, 3],
    [100, 1.4],
  ],
  swell(0.35, 1.5, 0.25, 0.3),
  { vertical: true, steps: 36 },
);

/**
 * An extra: the pen's underline. One quick stroke under the wordmark, rising a touch to the right and running a
 * little past it, the mark an editor makes under a word; at `hero` a shorter second pass under the first. It
 * stretches with the wordmark, and sits inside the mark's height, so it never moves the header. `brushed` draws it
 * at `hero` as a brush stroke, a light touch flicking off thin, as Ultimate v2's pen line is.
 *
 * `drawn` is for an underline under a pen line (the Ultimates): on hover it sweeps in as the pen lands, then its
 * second pass (keyframes in globals.css). Each pass is its own layer so each can be wiped in on its own beat.
 */
export function UnderlineDecoration({
  size,
  brushed = false,
  drawn = false,
}: DecorationProps & { brushed?: boolean; drawn?: boolean }) {
  const hero = size === "hero";
  const box = { left: WORDMARK_X - 1, right: -3, top: 24, height: 6 };
  return (
    <>
      <Layer
        draw={drawn ? "underline" : undefined}
        box={box}
        viewBox="0 0 100 6"
        stretch
        strokeWidth={STROKE[size].accent}
      >
        {brushed && hero ? (
          <path d={BRUSHED} fill="currentColor" stroke="none" />
        ) : (
          <path d="M0 4.6C24 3.9 62 3 100 1.4" />
        )}
      </Layer>
      {hero && (
        <Layer
          draw={drawn ? "underline-2" : undefined}
          box={box}
          viewBox="0 0 100 6"
          stretch
          strokeWidth={STROKE.hero.hairline}
        >
          <path d="M14 6.4C38 5.9 62 5.4 84 4.5" />
        </Layer>
      )}
    </>
  );
}
