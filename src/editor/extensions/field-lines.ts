// A field that keeps its line breaks (InlineVariableField with `lines="lines"`, an SMS message): still
// one paragraph of text and chips, but Enter adds a hard break (as Shift+Enter and Mod+Enter do, through
// the hard break's own keys), and a paste keeps its lines as hard breaks, blank lines included. The `{{`
// picker still gets Enter first. Its one-line counterpart is single-line.ts.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { flattenToLines, linesOfText } from "../paste/chips";

export const FieldLines = Extension.create({
  name: "fieldLines",
  priority: 50,

  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("fieldLinesPaste"),
        props: {
          // Plain text: one paragraph, each line break a hard break (ProseMirror's own parser would
          // make a paragraph per line and drop the blank ones).
          clipboardTextParser: (text, _context, _plain, view) => linesOfText(text, view.state.schema),
          transformPasted: (slice, view) => flattenToLines(slice, view.state.schema),
        },
      }),
    ];
  },
});
