import { HybridStackDecoration } from "./hybrid-stack";
import type { DecorationProps } from "./sketch";
import { UnderlineDecoration } from "./underline";

/** Everything at once: Hybrid Stack (the tinted sheets and the pen line) over Underline's stroke. */
export function UltimateDecoration({ size }: DecorationProps) {
  return (
    <>
      <HybridStackDecoration size={size} />
      <UnderlineDecoration size={size} drawn />
    </>
  );
}
