import { SheetStack, TINTED_SHEETS } from "./page-stack";
import { PenLine, type PenLineGeometry } from "./pen-line";
import { Layer, type DecorationProps } from "./sketch";

// Hybrid's fine line, leaving from the dog-ear of Template Stack's front sheet.
const LINE: Record<DecorationProps["size"], PenLineGeometry> = {
  nav: {
    startX: 28,
    startY: -1.5,
    crestY: -7,
    crestInset: 24,
    tipX: 1,
    tipY: 1.5,
    angle: 35,
    penScale: 0.85,
    weight: 1.25,
  },
  hero: {
    startX: 28.5,
    startY: -2,
    crestY: -10,
    crestInset: 24,
    tipX: 1.5,
    tipY: 0.5,
    angle: 35,
    penScale: 0.75,
    weight: 2,
  },
};

/**
 * Hybrid with Template Stack's sheets: the tinted sheet, the third sheet and the tilt at hero, and the fine pen
 * line from the front sheet's dog-ear. On hover the sheets behind fan out; the front one, where the line starts,
 * stays put.
 */
export function HybridStackDecoration({ size }: DecorationProps) {
  return (
    <>
      <Layer
        box={{ left: -16, top: -20, width: 48, height: 52 }}
        viewBox="-16 -20 48 52"
        behind
        strokeWidth={1}
      >
        <SheetStack size={size} sheets={TINTED_SHEETS[size]} />
      </Layer>
      <PenLine size={size} tool="nib" geometry={LINE[size]} />
    </>
  );
}
