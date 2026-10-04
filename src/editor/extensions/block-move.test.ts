// @vitest-environment happy-dom
// Alt+Shift+↑/↓ block moves (extensions/block-move.ts).

import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECTIONS_DOC,
  blockPos,
  blocks,
  caret,
  destroyEditors,
  mountEditor,
  noted,
  p,
  press,
} from "../testing/editor";

afterEach(destroyEditors);

const mount = (content: JSONContent = SECTIONS_DOC) => mountEditor(content);

describe("block moves (Alt+Shift+↑/↓)", () => {
  it("moves a block down across a section heading, keeps the caret, one undo step per move", () => {
    const editor = mount();
    caret(editor, 2, 3); // "Off|er body"
    press(editor, "ArrowDown", { alt: true, shift: true });
    expect(blocks(editor).slice(1, 4)).toEqual(["h2*:Offer details", "h2*:Rates and fees", "p:Offer body"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("Offer body");
    expect(editor.state.selection.$from.parentOffset).toBe(3);
    press(editor, "ArrowDown", { alt: true, shift: true });
    expect(blocks(editor).slice(2, 5)).toEqual(["h2*:Rates and fees", "p:Rates body", "p:Offer body"]);
    editor.commands.undo();
    expect(blocks(editor).slice(2, 5)).toEqual(["h2*:Rates and fees", "p:Offer body", "p:Rates body"]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual(blocks(mount()));
  });

  it("moves a block up into the previous section", () => {
    const editor = mount();
    caret(editor, 4);
    press(editor, "ArrowUp", { alt: true, shift: true });
    expect(blocks(editor).slice(2, 5)).toEqual(["p:Offer body", "p:Rates body", "h2*:Rates and fees"]);
  });

  it("never moves a required heading", async () => {
    const editor = mount();
    caret(editor, 3, 2);
    press(editor, "ArrowUp", { alt: true, shift: true });
    expect(blocks(editor)).toEqual(blocks(mount()));
    expect(noted(editor)).toBe("Rates and fees");
  });

  it("moves a list item within its list, then the whole list at its edge", () => {
    const list: JSONContent = {
      type: "bulletList",
      content: ["One", "Two"].map((value) => ({ type: "listItem", content: [p(value)] })),
    };
    const editor = mount({ type: "doc", content: [p("Before"), list] });
    // Caret in "Two".
    const two = blockPos(editor, 1) + 1 + editor.state.doc.child(1).child(0).nodeSize + 2;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, two)));
    press(editor, "ArrowUp", { alt: true, shift: true });
    expect(blocks(editor)).toEqual(["p:Before", "bulletList[p:Two|p:One]"]);
    press(editor, "ArrowUp", { alt: true, shift: true });
    expect(blocks(editor)).toEqual(["bulletList[p:Two|p:One]", "p:Before"]);
  });
});
