import { RUGGED_SHEETS, RuggedStack, Sparks, Wash } from "./rugged-stack";
import { Layer, type DecorationProps } from "./sketch";

/**
 * Template Stack v2: a used stack. Sheets larger than the mark, fanned at rest, ruled by hand, the back one
 * dog-eared; watercolour over the drawing and sparks off its side. On hover the sheets fan further.
 */
export function StackV2Decoration({ size }: DecorationProps) {
  return (
    <Layer
      box={{ left: -20, top: -24, width: 62, height: 66 }}
      viewBox="-20 -24 62 66"
      behind
      strokeWidth={1}
    >
      <RuggedStack size={size} sheets={RUGGED_SHEETS} />
      <Wash size={size} />
      <Sparks size={size} />
    </Layer>
  );
}
