// One line, always (InlineVariableField): Enter (and Shift/Mod+Enter) never add a line — the `{{`
// picker still gets Enter first — and a multi-line paste joins its lines with spaces.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { flattenToLine } from "../paste/chips";

export const SingleLine = Extension.create({
  name: "singleLine",
  priority: 50,

  addKeyboardShortcuts() {
    return { Enter: () => true, "Shift-Enter": () => true, "Mod-Enter": () => true };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("singleLinePaste"),
        props: {
          transformPastedText: (text) => text.replace(/\s*[\r\n]+\s*/g, " "),
          transformPasted: (slice, view) => flattenToLine(slice, view.state.schema),
        },
      }),
    ];
  },
});
