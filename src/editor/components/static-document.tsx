// Server-safe first paint of a document (no "use client", no hooks).
// Renders TipTap JSON with @tiptap/static-renderer from the same schema as the live editor and
// the same chip component, inside the same wrapper and classes, so swapping in the editor once
// its JS loads causes no visible change. Open review threads are highlighted with the same markup
// as the live editor's decorations (extensions/review-threads.ts).

import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { StaticDocumentProps } from "../types";
import { cx } from "../lib/cx";
import { variableLeafText } from "../lib/threads";
import { drawnThreads, reviewThreadMarks, withThreadHighlights } from "../extensions/review-threads";
import { BLOCK_ID_TYPES, baseExtensions } from "../schema";
import { VariableChipView } from "./variable-chip";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import "../styles.css";

export function StaticDocument({ content, variables, align = "center", className, threads, activeThreadId = null }: StaticDocumentProps) {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const highlighted = threads ? drawnThreads(threads) : [];
  const extensions = highlighted.length
    ? [...baseExtensions({ variables }), ...reviewThreadMarks(BLOCK_ID_TYPES)]
    : baseExtensions({ variables });

  const body = renderToReactElement({
    content: highlighted.length
      ? withThreadHighlights(content, extensions, highlighted, activeThreadId, variableLeafText((key) => byKey.get(key)))
      : content,
    extensions,
    options: {
      nodeMapping: {
        variable: ({ node }: { node: PMNode }) => {
          const key = (node.attrs.key as string | null) ?? null;
          return <VariableChipView variableKey={key} variable={key ? byKey.get(key) : undefined} />;
        },
      },
    },
  });

  return (
    <div className={cx(SURFACE_CLASS, className)} data-static-document="" data-align={align === "start" ? "start" : undefined}>
      <div className={DOC_CLASS}>{body}</div>
    </div>
  );
}
