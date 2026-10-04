"use client";

// Client variant of the `variable` node: same schema, plus the React chip NodeView.
// Kept in its own "use client" module so schema.ts stays importable from server code.

import { ReactNodeViewRenderer } from "@tiptap/react";
import { VariableNodeView } from "../components/variable-node-view";
import { Variable } from "./variable";

export const VariableWithChip = Variable.extend({
  addNodeView() {
    return ReactNodeViewRenderer(VariableNodeView, { as: "span" });
  },
});
