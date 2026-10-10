// @vitest-environment happy-dom
// The small extensions: single-line (one-line fields), line-boundary-keys (Home/End),
// block-range-highlight (the dragged blocks), and the menus' open-on-typing rule
// (menu-placement.ts).

import type { Editor } from "@tiptap/core";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineFieldExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { blocks, destroyEditors, doc, mountEditor, p, press } from "../testing/editor";
import { MENU_FLOATING_UI, showOnTyping } from "./menu-placement";

afterEach(() => {
  destroyEditors();
  vi.restoreAllMocks();
});

describe("single-line", () => {
  it("Enter, Shift+Enter and Mod+Enter never add a line", () => {
    const editor = mountEditor(doc(p("Subject")), { extensions: inlineFieldExtensions({ store: createVariableStore([]) }) });
    editor.commands.setTextSelection(4);
    expect(press(editor, "Enter")).toBe(true);
    expect(press(editor, "Enter", { shift: true })).toBe(true);
    // Mod is Ctrl outside Apple platforms (the test DOM).
    expect(press(editor, "Enter", { ctrl: true })).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("Subject");
  });
});

describe("field-lines (a field that keeps its line breaks)", () => {
  it("Enter and Shift+Enter add a hard break in the one paragraph", () => {
    const editor = mountEditor(doc(p("Hello")), { extensions: inlineFieldExtensions({ store: createVariableStore([]) }, "lines") });
    editor.commands.setTextSelection(6);
    expect(press(editor, "Enter")).toBe(true);
    expect(press(editor, "Enter", { shift: true })).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.getJSON().content?.[0]?.content).toEqual([{ type: "text", text: "Hello" }, { type: "hardBreak" }, { type: "hardBreak" }]);
  });
});

describe("line-boundary-keys (Home / End)", () => {
  const setup = () => {
    const editor = mountEditor(doc(p("First line of text")));
    editor.commands.setTextSelection(3);
    return editor;
  };

  it("moves to the visual line's end with Selection.modify and puts that selection in the state", () => {
    const editor = setup();
    const textNode = editor.view.dom.querySelector("p")!.firstChild!;
    const modify = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ modify, focusNode: textNode, focusOffset: 18 } as unknown as Selection);
    expect(press(editor, "End")).toBe(true);
    expect(modify).toHaveBeenCalledWith("move", "forward", "lineboundary");
    expect(editor.state.selection.from).toBe(19);
  });

  it("Shift extends; Home goes backward", () => {
    const editor = setup();
    const textNode = editor.view.dom.querySelector("p")!.firstChild!;
    const modify = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ modify, focusNode: textNode, focusOffset: 0 } as unknown as Selection);
    press(editor, "Home", { shift: true });
    expect(modify).toHaveBeenCalledWith("extend", "backward", "lineboundary");
    expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([3, 1]);
  });

  it("leaves Cmd/Ctrl/Alt+Home/End alone, and browsers without Selection.modify", () => {
    const editor = setup();
    const modify = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ modify } as unknown as Selection);
    expect(press(editor, "End", { meta: true })).toBe(false);
    expect(press(editor, "Home", { ctrl: true })).toBe(false);
    expect(modify).not.toHaveBeenCalled();
    vi.spyOn(document, "getSelection").mockReturnValue({} as Selection);
    expect(press(editor, "End")).toBe(false);
  });
});

describe("block-range-highlight", () => {
  it("paints the blocks of a NodeRangeSelection and marks the editor while it lasts", () => {
    const editor = mountEditor(doc(p("One"), p("Two"), p("Three")));
    const range = NodeRangeSelection.create(editor.state.doc, 0, editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize);
    editor.view.dispatch(editor.state.tr.setSelection(range));
    expect(editor.view.dom.classList.contains("has-block-range")).toBe(true);
    expect(editor.view.dom.querySelectorAll(".ProseMirror-selectednoderange")).toHaveLength(2);
    editor.commands.setTextSelection(1);
    expect(editor.view.dom.classList.contains("has-block-range")).toBe(false);
    expect(blocks(editor)).toEqual(["p:One", "p:Two", "p:Three"]);
  });
});

describe("menus open from typing only (menu-placement.ts)", () => {
  const key = new PluginKey("testMenu");
  const fakeEditor = () => ({ state: {} as EditorState }) as unknown as Editor;
  const tr = (docChanged: boolean) => ({ docChanged, getMeta: () => undefined }) as unknown as Transaction;

  it("opens on a typed change, not on a selection move or undo/redo", () => {
    vi.spyOn(key, "getState").mockReturnValue({ active: false });
    const shouldShow = showOnTyping(key);
    const args = (transaction: Transaction) => ({ editor: fakeEditor(), range: { from: 0, to: 0 }, query: "", text: "", transaction });
    expect(shouldShow(args(tr(true)))).toBe(true);
    expect(shouldShow(args(tr(false)))).toBe(false);
    // Undo/redo: covered end to end in state/editor-root.test.ts ("undo brings the raw {{query back…").
  });

  it("stays open once open, whatever the transaction", () => {
    vi.spyOn(key, "getState").mockReturnValue({ active: true });
    const shouldShow = showOnTyping(key);
    expect(shouldShow({ editor: fakeEditor(), range: { from: 0, to: 0 }, query: "", text: "", transaction: tr(false) })).toBe(true);
  });

  it("places menus with a fixed strategy that shifts and sizes to the viewport", () => {
    expect(MENU_FLOATING_UI.strategy).toBe("fixed");
    expect(MENU_FLOATING_UI.middleware?.map((m) => m.name)).toEqual(["shift", "size"]);
  });
});
