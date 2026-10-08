// @vitest-environment happy-dom
// Undo history carried from one editor to its replacement (a hidden route shown again builds a new
// editor, with its own schema): the new one steps back and forward through the same documents.

import { Editor, type JSONContent } from "@tiptap/core";
import { closeHistory, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it } from "vitest";
import type { Variable } from "../model/types";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { createVariableStore } from "../state/variable-store";
import { doc, p, text } from "../testing/editor";
import { captureHistory, restoreHistory } from "./history-carry";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function make(content: JSONContent): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions({ store: createVariableStore([]) }),
    content,
  });
  editors.push(editor);
  return editor;
}

/** Types `value` at the end of the first block, as its own undo step. */
function type(editor: Editor, value: string) {
  const end = editor.state.doc.child(0).nodeSize - 1;
  editor.view.dispatch(closeHistory(editor.state.tr.insertText(value, end)));
}

const firstLine = (editor: Editor) => editor.state.doc.child(0).textContent;
const stepBack = (editor: Editor) => undo(editor.state, editor.view.dispatch);
const stepForward = (editor: Editor) => redo(editor.state, editor.view.dispatch);

describe("history carry", () => {
  it("rebuilds undo and redo in a new editor, landing on the same documents", () => {
    const before = make(doc(p("Rates"), p("Fees")));
    type(before, " apply");
    type(before, " monthly");
    type(before, " today");
    stepBack(before); // " today" waits on the redo side
    expect(firstLine(before)).toBe("Rates apply monthly");

    const carry = captureHistory(before.state);
    expect(carry?.back).toHaveLength(2);
    expect(carry?.forward).toHaveLength(1);

    const after = make(before.getJSON());
    expect(restoreHistory(after.view, carry!)).toBe(true);
    expect(undoDepth(after.state)).toBe(2);
    expect(redoDepth(after.state)).toBe(1);

    stepBack(after);
    expect(firstLine(after)).toBe("Rates apply");
    stepBack(after);
    expect(firstLine(after)).toBe("Rates");
    expect(stepBack(after)).toBe(false);

    stepForward(after);
    stepForward(after);
    stepForward(after);
    expect(firstLine(after)).toBe("Rates apply monthly today");
    expect(after.state.doc.child(1).textContent).toBe("Fees");
  });

  it("puts the caret back where each change was", () => {
    const before = make(doc(p("One"), p("Two")));
    const endOfTwo = before.state.doc.child(0).nodeSize + before.state.doc.child(1).nodeSize - 1;
    before.view.dispatch(closeHistory(before.state.tr.insertText("!", endOfTwo)));

    const after = make(before.getJSON());
    restoreHistory(after.view, captureHistory(before.state)!);
    stepBack(after);
    expect(after.state.doc.child(1).textContent).toBe("Two");
    expect(after.state.selection.$head.parent.textContent).toBe("Two");
  });

  it("captures nothing without history, and restores nothing onto a different document", () => {
    const fresh = make(doc(p("Untouched")));
    expect(captureHistory(fresh.state)).toBeNull();

    const before = make(doc(p("Rates")));
    type(before, " apply");
    const carry = captureHistory(before.state)!;
    const other = make(doc(p("Something else")));
    expect(restoreHistory(other.view, carry)).toBe(false);
    expect(undoDepth(other.state)).toBe(0);
  });

  it("walks the history without the other plugins' side effects", async () => {
    const variables: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
    const root = createEditorRootRuntime({ variables });
    const content = doc({ type: "paragraph", content: [text("Hi "), { type: "variable", attrs: { key: "first_name" } }] });
    root.registerField({ id: "body", label: "Document", kind: "body" }, content);
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions({
        store: root.variables,
        binding: { fieldId: "body", kind: "body", root, chip: createChipPopoverStore() },
      }),
      content,
    });
    editors.push(editor);

    // Deleting the variable with its chips: undoing that in the live editor would bring the variable back.
    root.deleteVariable("first_name", { removeChips: true });
    expect(root.variables.getState().byKey.has("first_name")).toBe(false);

    expect(captureHistory(editor.state)?.back).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.variables.getState().byKey.has("first_name")).toBe(false);
  });
});
