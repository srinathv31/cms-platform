// Callout: a boxed notice holding one or more paragraphs. Custom (TipTap has no free callout).
// The info icon is drawn by styles.css (.ucomp-doc [data-callout]::before) so the editor, the
// static renderer and HTML output share one DOM shape: <div data-callout>…paragraphs…</div>.
//
// Keys, like a list item:
//   Enter on an empty last line   leaves the callout (the line moves out below it)
//   Backspace at the start        lifts that first line out (an empty callout unwraps entirely)

import { Node, mergeAttributes } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { NODE } from "../model/types";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selected blocks in a callout. */
      setCallout: () => ReturnType;
      /** Wrap in a callout, or lift out of one. */
      toggleCallout: () => ReturnType;
      /** Lift the selected blocks out of the callout. */
      unsetCallout: () => ReturnType;
    };
  }
}

/** The caret's line in a callout: its index and the callout's depth, or null outside one. */
function calloutLine(state: EditorState): { index: number; childCount: number; empty: boolean; atStart: boolean } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.depth < 2) return null;
  const callout = $from.node(-1);
  if (callout.type.name !== NODE.callout) return null;
  return {
    index: $from.index(-1),
    childCount: callout.childCount,
    empty: $from.parent.content.size === 0,
    atStart: $from.parentOffset === 0,
  };
}

export const Callout = Node.create({
  name: NODE.callout,
  group: "block",
  content: "paragraph+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-callout]" }, { tag: "aside[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-callout": "" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const line = calloutLine(this.editor.state);
        if (!line || !line.empty || line.index !== line.childCount - 1) return false;
        return this.editor.commands.lift(this.name);
      },
      Backspace: () => {
        const line = calloutLine(this.editor.state);
        if (!line || !line.atStart || line.index !== 0) return false;
        return this.editor.commands.lift(this.name);
      },
    };
  },
});
