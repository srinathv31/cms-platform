import { SheetStack, TINTED_SHEETS } from "./page-stack";
import { Layer, type DecorationProps } from "./sketch";

/**
 * Concept 2, Template Stack: sheets of paper stacked behind the mark, the front one dog-eared. Charcoal lines,
 * one tinted sheet and the fold for colour. Reusable templates, kept in order. On hover the sheets behind fan out.
 */
export function TemplateStackDecoration({ size }: DecorationProps) {
  return (
    <Layer
      box={{ left: -16, top: -20, width: 48, height: 52 }}
      viewBox="-16 -20 48 52"
      behind
      strokeWidth={1}
    >
      <SheetStack size={size} sheets={TINTED_SHEETS[size]} />
    </Layer>
  );
}
