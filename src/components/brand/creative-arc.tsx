import type { PenTool } from "./pen";
import { PenLine, type PenLineGeometry } from "./pen-line";
import { MARK, WORDMARK_X, type DecorationProps } from "./sketch";

export type ArcStart = "crest" | "wordmark";

const GEOMETRY: Record<DecorationProps["size"], PenLineGeometry> = {
  nav: {
    startX: MARK + 2,
    startY: 4,
    crestY: -8,
    crestInset: 26,
    tipX: 1,
    tipY: 1,
    angle: 35,
    penScale: 1,
  },
  hero: {
    startX: MARK + 1.5,
    startY: 3,
    crestY: -11,
    crestInset: 26,
    tipX: 1.5,
    tipY: 0,
    angle: 35,
    penScale: 0.9,
    motion: true,
  },
};

/**
 * Concept 1, Creative Arc: a pen line sweeps from the mark's top corner over the wordmark and ends at a nib, as
 * if it had just been drawn. `from="wordmark"` starts it over the S instead; `tool="pencil"` swaps the nib.
 */
export function CreativeArcDecoration({
  size,
  tool = "nib",
  from = "crest",
}: DecorationProps & { tool?: PenTool; from?: ArcStart }) {
  const geometry = GEOMETRY[size];
  return (
    <PenLine
      size={size}
      tool={tool}
      geometry={
        from === "wordmark"
          ? { ...geometry, startX: WORDMARK_X + 1, startY: geometry.startY + 1 }
          : geometry
      }
    />
  );
}
