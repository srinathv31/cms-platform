// @vitest-environment happy-dom
// The field binding (extensions/field-binding.ts): the chip popover's keys and how it follows the
// selection, focus tracking, and that the editor's paste path runs the normalizer. Drop, usage,
// renames and tombstones are covered in state/editor-root.test.ts; `{{key}}` paste in
// paste/paste.test.ts.

import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { destroyEditors, doc, mountEditor, press, text } from "../testing/editor";

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const chipNode = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

afterEach(destroyEditors);

function setup() {
  const root = createEditorRootRuntime({ variables: VARIABLES });
  root.registerField({ id: "body", label: "Document", kind: "body" });
  const chip = createChipPopoverStore();
  const editor = mountEditor(doc({ type: "paragraph", content: [text("Hi "), chipNode("first_name"), text(" there")] }), {
    extensions: editorExtensions({ store: root.variables, binding: { fieldId: "body", kind: "body", root, chip } }),
  });
  return { root, chip, editor: editor as Editor };
}

const selectChip = (editor: Editor) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 4)));

describe("chip popover", () => {
  it("Enter or Space on a selected chip toggles it; Esc closes it", () => {
    const { editor, chip } = setup();
    selectChip(editor);
    expect(press(editor, "Enter")).toBe(true);
    expect(chip.getState().pos).toBe(4);
    press(editor, " ");
    expect(chip.getState().pos).toBeNull();
    press(editor, " ");
    expect(chip.getState().pos).toBe(4);
    expect(press(editor, "Escape")).toBe(true);
    expect(chip.getState().pos).toBeNull();
    // Esc with nothing open is left to others.
    expect(press(editor, "Escape")).toBe(false);
  });

  it("Enter without a selected chip is ordinary Enter", () => {
    const { editor, chip } = setup();
    editor.commands.setTextSelection(2);
    press(editor, "Enter");
    expect(chip.getState().pos).toBeNull();
    expect(editor.state.doc.childCount).toBeGreaterThan(1);
  });

  it("a click on a chip opens it; moving the selection off the chip closes it", () => {
    const { editor, chip } = setup();
    editor.view.someProp("handleClickOn", (f) => f(editor.view, 5, editor.state.doc.nodeAt(4)!, 4, new MouseEvent("click"), true));
    expect(chip.getState().pos).toBe(4);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(chip.getState().pos).toBeNull();
  });
});

describe("focus and paste", () => {
  it("focus tells the root which field click-to-insert targets", () => {
    const { editor, root } = setup();
    editor.commands.setTextSelection(2);
    editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    root.insertVariable("first_name");
    expect(editor.state.doc.child(0).child(1).type.name).toBe("variable");
  });

  it("pasted HTML goes through the normalizer", () => {
    const { editor } = setup();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteHTML('<p style="color:red"><span style="font-weight:700">Bold</span><o:p></o:p></p>');
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"marks":[{"type":"bold"}]');
    expect(json).not.toContain("color");
  });
});
