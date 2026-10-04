// The + button's action: an empty line below the block with "/" in it, which opens the block menu
// there. An empty paragraph under the pointer is reused instead. One undo step of its own, so a
// dismissed menu can take the line back out exactly (SlashMenuController.armUndo).

import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";

export function insertBlockBelow(editor: Editor, node: PMNode, pos: number): boolean {
  const chain = editor.chain().command(({ tr }) => {
    closeHistory(tr);
    return true;
  });
  if (node.type.name === "paragraph" && node.content.size === 0) {
    chain.insertContentAt(pos + 1, "/").focus(pos + 2, { scrollIntoView: false });
  } else {
    const after = pos + node.nodeSize;
    chain
      .insertContentAt(after, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(after + 2)
      .focus(undefined, { scrollIntoView: false });
  }
  return chain.run();
}
