import { PenLine, type PenLineGeometry } from "./pen-line";
import { RUGGED_SHEETS, RuggedStack, Sparks, Wash } from "./rugged-stack";
import { Layer, type DecorationProps } from "./sketch";

// The line leaves from the back sheet's dog-ear and lands at the pen. At `hero` it is a brush stroke.
const LINE: Record<DecorationProps["size"], PenLineGeometry> = {
  nav: {
    startX: 35,
    startY: -10.5,
    crestY: -15,
    crestInset: 24,
    tipX: 1,
    tipY: 1.5,
    angle: 35,
    penScale: 0.85,
    weight: 1.25,
  },
  hero: {
    startX: 35,
    startY: -10.5,
    crestY: -17,
    crestInset: 26,
    tipX: 1.5,
    tipY: 0,
    angle: 35,
    penScale: 0.85,
    motion: true,
    brush: { start: 0.3, full: 1.3, crest: 1.05, tip: 0.45 },
  },
};

/** The back sheet anchors the line, so it holds still on hover; the two in front of it fan. */
const FANS = [null, [-1.5, -0.5, -5], [0.5, 0.5, 2.5]] as const;

/**
 * Hybrid v2: Template Stack v2's used stack, and a pen line that leaves from its dog-ear: the template being
 * reused, and written on.
 */
export function HybridV2Decoration({ size }: DecorationProps) {
  return (
    <>
      <Layer
        box={{ left: -20, top: -24, width: 62, height: 66 }}
        viewBox="-20 -24 62 66"
        behind
        strokeWidth={1}
      >
        <RuggedStack size={size} sheets={RUGGED_SHEETS} fans={FANS} />
        <Wash size={size} />
        <Sparks size={size} />
      </Layer>
      <PenLine size={size} tool="nib" geometry={LINE[size]} />
    </>
  );
}
