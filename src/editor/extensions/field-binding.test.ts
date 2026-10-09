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
import { blockPos, destroyEditors, doc, mountEditor, press, text } from "../testing/editor";
import { VARIABLE_DRAG_TYPE } from "./field-binding";

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const chipNode = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

afterEach(destroyEditors);

function setup(content: JSONContent = doc({ type: "paragraph", content: [text("Hi "), chipNode("first_name"), text(" there")] })) {
  const root = createEditorRootRuntime({ variables: VARIABLES });
  root.registerField({ id: "body", label: "Document", kind: "body" });
  const chip = createChipPopoverStore();
  const editor = mountEditor(content, {
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

// ── A panel drop, then a block move (handoff review I4) ──────────────────────────────────────────

/** A paragraph with a block id, as stored documents have them. */
const block = (id: string, value: string): JSONContent => ({ type: "paragraph", attrs: { id }, content: [text(value)] });

/** A drop event as the browser sends it: the drag's data and how it may land. The test aims it with `aimAt`. */
function dropEvent(data: Record<string, string>, effectAllowed: DataTransfer["effectAllowed"]): DragEvent {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  const dataTransfer = { getData: (type: string) => data[type] ?? "", types: Object.keys(data), effectAllowed, files: [] };
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: 0 }, clientY: { value: 0 } });
  return event;
}

/** The drop lands at `pos` (happy-dom has no layout to aim with). */
const aimAt = (editor: Editor, pos: number) => (editor.view.posAtCoords = () => ({ pos, inside: -1 }));

/** A drag begins on `element`. UniqueID and the paste rules watch `dragstart` on the window. */
const startDrag = (element: Element) => element.dispatchEvent(new Event("dragstart", { bubbles: true }));

/** A panel row dragged from outside the editor and dropped at `pos`, with the data variables-panel.tsx gives it. */
function dropFromPanel(editor: Editor, key: string, pos: number): DragEvent {
  const row = document.createElement("li");
  document.body.appendChild(row);
  startDrag(row);
  aimAt(editor, pos);
  const event = dropEvent({ [VARIABLE_DRAG_TYPE]: key }, "copy");
  editor.view.dom.dispatchEvent(event);
  row.remove();
  return event;
}

/**
 * The block at `index` dragged by its grip and dropped at `pos`, the way the DragHandle does it: the
 * drag starts on the handle (beside the document, inside its parent), the block becomes `view.dragging`
 * as a move, and the browser's drop carries no data of its own.
 */
function moveBlockByGrip(editor: Editor, index: number, pos: number) {
  const { view } = editor;
  const handle = document.createElement("div");
  view.dom.parentElement!.appendChild(handle);
  startDrag(handle);
  const selection = NodeSelection.create(view.state.doc, blockPos(editor, index));
  view.dispatch(view.state.tr.setSelection(selection));
  view.dragging = { slice: selection.content(), move: true, node: selection } as typeof view.dragging;
  aimAt(editor, pos);
  view.dom.dispatchEvent(dropEvent({}, "uninitialized"));
  handle.remove();
}

/** Each top-level block's id and text, chips as `{{key}}`. */
function idsAndText(editor: Editor): [string, string][] {
  const out: [string, string][] = [];
  editor.state.doc.forEach((node) => {
    let line = "";
    node.descendants((child) => {
      if (child.isText) line += child.text;
      else if (child.type.name === "variable") line += `{{${child.attrs.key}}}`;
      return true;
    });
    out.push([node.attrs.id as string, line]);
  });
  return out;
}

describe("a panel drop, then a block move", () => {
  const DOC = doc(block("b_one", "One"), block("b_two", "Two"), block("b_three", "Three"));

  it("the moved block keeps its id, so its comment threads stay on it", () => {
    const { editor } = setup(DOC);

    const drop = dropFromPanel(editor, "first_name", 4); // after "One"
    expect(drop.defaultPrevented, "the panel drop is handled").toBe(true);
    expect(idsAndText(editor)).toEqual([
      ["b_one", "One {{first_name}}"],
      ["b_two", "Two"],
      ["b_three", "Three"],
    ]);

    moveBlockByGrip(editor, 2, 1); // "Three" to the start of "One": it goes above it
    expect(idsAndText(editor)).toEqual([
      ["b_three", "Three"],
      ["b_one", "One {{first_name}}"],
      ["b_two", "Two"],
    ]);
  });

  it("a block move on its own keeps the moved block's id", () => {
    const { editor } = setup(DOC);
    moveBlockByGrip(editor, 0, blockPos(editor, 2) + 1); // "One" to the start of "Three": it goes above it
    expect(idsAndText(editor)).toEqual([
      ["b_two", "Two"],
      ["b_one", "One"],
      ["b_three", "Three"],
    ]);
  });
});
