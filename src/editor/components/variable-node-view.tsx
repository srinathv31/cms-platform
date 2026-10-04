"use client";

// React NodeView for the `variable` node. Reads the label/type for its key from the editor's
// variable store, so renaming a variable re-renders exactly the chips that use it.

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useStore } from "zustand";
import type { VariableOptions } from "../extensions/variable";
import { createVariableStore } from "../state/variable-store";
import { VariableChipView } from "./variable-chip";

const EMPTY_STORE = createVariableStore([]);

export function VariableNodeView({ node, selected, extension }: ReactNodeViewProps) {
  const key = (node.attrs.key as string | null) ?? null;
  const store = (extension.options as VariableOptions).store ?? EMPTY_STORE;
  const variable = useStore(store, (s) => (key ? s.byKey.get(key) : undefined));

  return (
    <NodeViewWrapper as="span">
      <VariableChipView variableKey={key} variable={variable} selected={selected} />
    </NodeViewWrapper>
  );
}
