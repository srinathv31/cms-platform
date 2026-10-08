// Server-safe first paint of a document (no "use client", no hooks).
// Renders TipTap JSON with @tiptap/static-renderer from the same schema as the live editor and
// the same chip component, inside the same wrapper and classes, so swapping in the editor once
// its JS loads causes no visible change. Open review threads are highlighted with the same markup
// as the live editor's decorations (extensions/review-threads.ts), and every list item carries the
// marker the live editor draws (extensions/list-markers.ts). A hard break that ends a paragraph or
// heading gets the extra <br> the live editor adds (ProseMirror's trailing break), so the empty line
// after it shows here too: a browser collapses a block's final <br>.

import { getSchema } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { StaticDocumentProps } from "../types";
import { cx } from "../lib/cx";
import { variableLeafText } from "../lib/threads";
import { listMarkerAttrs, withListMarkers } from "../extensions/list-markers";
import { drawnThreads, reviewThreadMarks, withThreadHighlights } from "../extensions/review-threads";
import { BLOCK_ID_TYPES, baseExtensions } from "../schema";
import { VariableChipView } from "./variable-chip";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import "../styles.css";

export function StaticDocument({ content, variables, align = "center", className, threads, activeThreadId = null }: StaticDocumentProps) {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const highlighted = threads ? drawnThreads(threads) : [];
  const extensions = [
    ...baseExtensions({ variables }),
    listMarkerAttrs(),
    ...(highlighted.length ? reviewThreadMarks(BLOCK_ID_TYPES) : []),
  ];

  const doc = highlighted.length
    ? withThreadHighlights(content, extensions, highlighted, activeThreadId, variableLeafText((key) => byKey.get(key)))
    : getSchema(extensions).nodeFromJSON(content);

  const body = renderToReactElement({
    content: withListMarkers(doc),
    extensions,
    options: {
      nodeMapping: {
        variable: ({ node }: { node: PMNode }) => {
          const key = (node.attrs.key as string | null) ?? null;
          return <VariableChipView variableKey={key} variable={key ? byKey.get(key) : undefined} />;
        },
        hardBreak: staticHardBreak,
      },
    },
  });

  return (
    <div className={cx(SURFACE_CLASS, className)} data-static-document="" data-align={align === "start" ? "start" : undefined}>
      <div className={DOC_CLASS}>{body}</div>
    </div>
  );
}

/**
 * A hard break in a static render. The last one in its paragraph or heading also gets the live
 * editor's trailing <br>, which keeps the empty line after it from collapsing.
 */
export function staticHardBreak({ node, parent }: { node: PMNode; parent?: PMNode }) {
  if (parent?.lastChild !== node) return <br />;
  return (
    <>
      <br />
      <br className="ProseMirror-trailingBreak" />
    </>
  );
}
