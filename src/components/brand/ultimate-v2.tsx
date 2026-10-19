import { HybridV2Decoration } from "./hybrid-v2";
import type { DecorationProps } from "./sketch";
import { UnderlineDecoration } from "./underline";

/** Ultimate v2: Hybrid v2 over Underline's stroke, brushed at `hero` like the pen line. */
export function UltimateV2Decoration({ size }: DecorationProps) {
  return (
    <>
      <HybridV2Decoration size={size} />
      <UnderlineDecoration size={size} brushed drawn />
    </>
  );
}
