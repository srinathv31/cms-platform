import type { CSSProperties } from "react";
import { pt } from "../geometry";

// The iPhone skin's glass. The blur sits on the glass element itself, never on a wrapper: a backdrop-filter
// only sees what is painted inside its Backdrop Root (the nearest ancestor with opacity below 1, a filter,
// a mask, a clip-path, a mix-blend-mode or a backdrop-filter of its own). So nothing between a glass element
// and the wallpaper may fade or filter: an enter animation fades the glass element itself, and the
// wallpaper and the glass share one root.

export type GlassKind = "regular" | "strong" | "quiet";

const FILL: Record<GlassKind, string> = {
  regular: "var(--device-glass)",
  strong: "var(--device-glass-strong)",
  quiet: "var(--device-glass-quiet)",
};

/** A glass surface: a frosted fill, the blur behind it, a hairline rim and a specular top edge. */
export function glass(kind: GlassKind, { blur = 30, shadow = false }: { blur?: number; shadow?: boolean } = {}): CSSProperties {
  const filter = `blur(${pt(blur)}) saturate(1.8)`;
  const edges = [`inset 0 0 0 ${pt(0.5)} var(--device-glass-rim)`, `inset 0 ${pt(1)} 0 0 var(--device-glass-specular)`];
  if (shadow) edges.push(`0 ${pt(10)} ${pt(30)} ${pt(-6)} var(--device-glass-shadow)`);
  return {
    background: FILL[kind],
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
    boxShadow: edges.join(", "),
  };
}
