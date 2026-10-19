import { SheetStack, type Sheet } from "./page-stack";
import { PenLine, type PenLineGeometry } from "./pen-line";
import { Layer, type DecorationProps } from "./sketch";

// Two sheets, closer than Template Stack's, and no tinted sheet: the fold and the line carry the colour.
const SHEETS: Record<DecorationProps["size"], readonly Sheet[]> = {
  nav: [
    { x0: -5.5, y0: -8.5, x1: 24.5, y1: 21.5, fan: [-1, -1.5, -6] },
    { x0: -2.5, y0: -4.5, x1: 27.5, y1: 27.5, fold: 4 },
  ],
  hero: [
    {
      x0: -7,
      y0: -11,
      x1: 24,
      y1: 24,
      bows: [0.3, 0, 0, 0.3],
      fan: [-1.5, -2, -7],
    },
    {
      x0: -3.5,
      y0: -5.5,
      x1: 27.5,
      y1: 29,
      fold: 5.5,
      bows: [-0.25, 0, 0, 0.2],
    },
  ],
};

// The line leaves from the dog-ear, flatter and finer than Creative Arc's, to a smaller pen.
const LINE: Record<DecorationProps["size"], PenLineGeometry> = {
  nav: {
    startX: 29,
    startY: -1.5,
    crestY: -6.5,
    crestInset: 24,
    tipX: 1,
    tipY: 1.5,
    angle: 35,
    penScale: 0.85,
    weight: 1.25,
  },
  hero: {
    startX: 29,
    startY: -2,
    crestY: -9,
    crestInset: 24,
    tipX: 1.5,
    tipY: 0.5,
    angle: 35,
    penScale: 0.75,
    weight: 2,
  },
};

/**
 * Concept 3, Hybrid: a compact stack behind the mark, and a fine pen line that leaves from the front sheet's
 * dog-ear for the wordmark's end. One gesture, page to pen, rather than Template Stack and Creative Arc together.
 */
export function HybridDecoration({ size }: DecorationProps) {
  return (
    <>
      <Layer
        box={{ left: -12, top: -14, width: 44, height: 46 }}
        viewBox="-12 -14 44 46"
        behind
        strokeWidth={1}
      >
        <SheetStack size={size} sheets={SHEETS[size]} />
      </Layer>
      <PenLine size={size} tool="nib" geometry={LINE[size]} />
    </>
  );
}
