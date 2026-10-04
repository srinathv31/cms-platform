// Shows which blocks a drag-handle drag carries. The official DragHandle selects the dragged
// blocks with a NodeRangeSelection; this paints it with the official NodeRange decoration helper
// (`ProseMirror-selectednoderange`) without adopting NodeRange's keyboard bindings, which would
// take over Shift+Arrow and Mod+A from normal text selection.

import { Extension } from "@tiptap/core";
import { getNodeRangeDecorations, isNodeRangeSelection } from "@tiptap/extension-node-range";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const BlockRangeHighlight = Extension.create({
  name: "blockRangeHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockRangeHighlight"),
        props: {
          decorations: (state) =>
            isNodeRangeSelection(state.selection) ? getNodeRangeDecorations([...state.selection.ranges]) : null,
          attributes: (state): Record<string, string> =>
            isNodeRangeSelection(state.selection) ? { class: "has-block-range" } : {},
        },
      }),
    ];
  },
});
