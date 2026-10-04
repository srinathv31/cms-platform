// Server-safe first paint of a document (no "use client", no hooks).
// Renders TipTap JSON with @tiptap/static-renderer from the same schema as the live editor and
// the same chip component, inside the same wrapper and classes, so swapping in the editor once
// its JS loads causes no visible change.

import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { StaticDocumentProps } from "../types";
import { cx } from "../lib/cx";
import { baseExtensions } from "../schema";
import { VariableChipView } from "./variable-chip";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import "../styles.css";

export function StaticDocument({ content, variables, className }: StaticDocumentProps) {
  const byKey = new Map(variables.map((v) => [v.key, v]));

  const body = renderToReactElement({
    content,
    extensions: baseExtensions({ variables }),
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
    <div className={cx(SURFACE_CLASS, className)} data-static-document="">
      <div className={DOC_CLASS}>{body}</div>
    </div>
  );
}
