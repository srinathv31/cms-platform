// Home and End move the caret to the start/end of the visual line (Shift extends the selection).
// Chrome on macOS maps them to "scroll to the top/bottom of the page" instead, which throws the
// author out of the text. Cmd/Ctrl/Alt combinations keep their native meaning.
//
// The browser finds the line boundary (Selection.modify knows about wrapping); the result goes
// straight into the editor state, so a keystroke right after End types at the new place even before
// the browser's selectionchange arrives (otherwise a selected chip could be typed over).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

export const LineBoundaryKeys = Extension.create({
  name: "lineBoundaryKeys",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("lineBoundaryKeys"),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== "Home" && event.key !== "End") return false;
            if (event.metaKey || event.ctrlKey || event.altKey) return false;
            const selection = view.dom.ownerDocument.getSelection();
            if (!selection || typeof selection.modify !== "function") return false;

            const extend = event.shiftKey;
            selection.modify(extend ? "extend" : "move", event.key === "Home" ? "backward" : "forward", "lineboundary");
            const { focusNode, focusOffset } = selection;
            if (focusNode && view.dom.contains(focusNode)) {
              try {
                const head = view.posAtDOM(focusNode, focusOffset);
                const anchor = extend ? view.state.selection.anchor : head;
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
              } catch {
                // ProseMirror will read the DOM selection on selectionchange instead.
              }
            }
            return true; // ProseMirror prevents the default (the page scroll)
          },
        },
      }),
    ];
  },
});
