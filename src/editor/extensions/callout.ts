// Callout: a boxed notice holding one or more paragraphs. Custom (TipTap has no free callout).
// The info icon is drawn by styles.css (.ucomp-doc [data-callout]::before) so the editor, the
// static renderer and HTML output share one DOM shape: <div data-callout>…paragraphs…</div>.

import { Node, mergeAttributes } from "@tiptap/core";
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
});
