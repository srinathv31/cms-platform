// @vitest-environment happy-dom
// The block menu's numbering (lib/list-numbering.ts): which list it acts on, the previews, and the
// two edits (style and start), each one undo step that changes the saved document.

import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { listItemMarkers } from "../extensions/list-markers";
import { NUMBERING_STYLES } from "../model/list-markers";
import { destroyEditors, mountEditor } from "../testing/editor";
import {
  currentNumberingValue,
  defaultNumbering,
  keyboardBlockAt,
  numberingPreview,
  numberingTarget,
  numberingValue,
  parseListStart,
  setListNumbering,
  setListStart,
  styleFromValue,
} from "./list-numbering";

afterEach(destroyEditors);

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: "listItem", content: [p(text), ...nested] });
const ol = (items: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({ type: "orderedList", attrs, content: items });
const ul = (items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const table = (...cells: JSONContent[][]): JSONContent => ({
  type: "table",
  content: [{ type: "tableRow", content: cells.map((content) => ({ type: "tableCell", content })) }],
});

/** A position inside the text `text`. */
function textPos(root: PMNode, text: string): number {
  let at = -1;
  root.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`no "${text}"`);
  return at;
}

/** Position of the top-level block at `index`. */
function blockAt(root: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += root.child(i).nodeSize;
  return pos;
}

const markers = (root: PMNode) => listItemMarkers(root).map((m) => m.marker);

describe("the list the block menu acts on", () => {
  const content = doc(
    p("intro"),
    ol([li("one", ol([li("nested a"), li("nested b")])), li("two")]),
    ul([li("bullet", ol([li("in bullet")]))]),
    table([p("cell"), ol([li("in cell")])], [p("other")]),
    p("outro"),
  );

  it("is the hovered numbered list itself while the caret is elsewhere", () => {
    const editor = mountEditor(content);
    editor.commands.setTextSelection(textPos(editor.state.doc, "intro"));
    const target = numberingTarget(editor.state, blockAt(editor.state.doc, 1));
    expect(target).toMatchObject({ pos: blockAt(editor.state.doc, 1), orderedDepth: 0 });
  });

  it("is the nested list the caret is in (a level is reached by putting the caret in it)", () => {
    const editor = mountEditor(content);
    editor.commands.setTextSelection(textPos(editor.state.doc, "nested b"));
    const target = numberingTarget(editor.state, blockAt(editor.state.doc, 1))!;
    expect(target.orderedDepth).toBe(1);
    expect(target.node.textContent).toBe("nested anested b");
    // The caret in the outer list's own item: the outer list.
    editor.commands.setTextSelection(textPos(editor.state.doc, "two"));
    expect(numberingTarget(editor.state, blockAt(editor.state.doc, 1))?.orderedDepth).toBe(0);
  });

  it("is the first numbered list inside a bulleted list or a table", () => {
    const editor = mountEditor(content);
    editor.commands.setTextSelection(textPos(editor.state.doc, "intro"));
    expect(numberingTarget(editor.state, blockAt(editor.state.doc, 2))?.node.textContent).toBe("in bullet");
    expect(numberingTarget(editor.state, blockAt(editor.state.doc, 3))?.node.textContent).toBe("in cell");
  });

  it("is nothing for a block without a numbered list", () => {
    const editor = mountEditor(content);
    expect(numberingTarget(editor.state, blockAt(editor.state.doc, 0))).toBeNull();
    expect(numberingTarget(editor.state, blockAt(editor.state.doc, 4))).toBeNull();
  });

  it("from the keyboard: the caret's block, except in a table cell outside a numbered list (the table's)", () => {
    const editor = mountEditor(content);
    const at = (text: string) => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, textPos(editor.state.doc, text))));
      return keyboardBlockAt(editor.state);
    };
    expect(at("intro")).toEqual({ blockPos: 0, target: null });
    expect(at("nested a")?.target?.orderedDepth).toBe(1);
    expect(at("in cell")?.target?.node.textContent).toBe("in cell");
    expect(at("cell")).toBeNull();
    expect(at("other")).toBeNull();
  });
});

describe("styles", () => {
  it("previews each of the ten menu styles with its first three markers", () => {
    expect(NUMBERING_STYLES.map(numberingPreview)).toEqual([
      "1. 2. 3.",
      "a. b. c.",
      "A. B. C.",
      "i. ii. iii.",
      "I. II. III.",
      "(1) (2) (3)",
      "(a) (b) (c)",
      "(i) (ii) (iii)",
      "1) 2) 3)",
      "a) b) c)",
    ]);
  });

  it("previews the default by depth: 1. → a. → i. → 1.", () => {
    expect([0, 1, 2, 3].map((depth) => numberingPreview(defaultNumbering(depth)))).toEqual(["1. 2. 3.", "a. b. c.", "i. ii. iii.", "1. 2. 3."]);
  });

  it("reads the list's checked style: default, a menu style, or none for a pair the menu doesn't offer", () => {
    const editor = mountEditor(
      doc(
        ol([li("a")]),
        ol([li("b")], { markerFormat: "lower-alpha", markerDelimiter: "parens" }),
        ol([li("c")], { markerFormat: "upper-roman", markerDelimiter: "parens" }),
        ol([li("d")], { markerDelimiter: "parens" }),
      ),
    );
    const values = [0, 1, 2, 3].map((i) => currentNumberingValue(editor.state.doc.child(i)));
    expect(values).toEqual(["default", "lower-alpha/parens", null, null]);
    expect(styleFromValue(numberingValue(NUMBERING_STYLES[6]))).toEqual(NUMBERING_STYLES[6]);
    expect(styleFromValue("default")).toBeNull();
  });

  it("parses a start number: whole numbers from 0 to 9999 only", () => {
    expect(["0", "1", " 12 ", "9999", "007"].map(parseListStart)).toEqual([0, 1, 12, 9999, 7]);
    expect(["", "-1", "10000", "1.5", "1e3", "abc", "１"].map(parseListStart)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("edits", () => {
  it("sets a style on the list, as one undo step that the saved document carries", () => {
    const editor = mountEditor(doc(p("before"), ol([li("one", ol([li("inner")])), li("two")])));
    const updates: JSONContent[] = [];
    editor.on("update", ({ editor: e }) => updates.push(e.getJSON()));
    const list = blockAt(editor.state.doc, 1);

    expect(setListNumbering(editor.view, list, { format: "lower-alpha", delimiter: "parens" })).toBe(true);
    expect(markers(editor.state.doc)).toEqual(["(a)", "a.", "(b)"]);
    expect(updates).toHaveLength(1);
    expect(updates[0].content?.[1].attrs).toMatchObject({ markerFormat: "lower-alpha", markerDelimiter: "parens" });

    // Another style right away is still its own step.
    expect(setListNumbering(editor.view, list, { format: "upper-roman", delimiter: "period" })).toBe(true);
    expect(markers(editor.state.doc)).toEqual(["I.", "a.", "II."]);
    editor.commands.undo();
    expect(markers(editor.state.doc)).toEqual(["(a)", "a.", "(b)"]);
    editor.commands.undo();
    expect(markers(editor.state.doc)).toEqual(["1.", "a.", "2."]);
    editor.commands.redo();
    expect(markers(editor.state.doc)).toEqual(["(a)", "a.", "(b)"]);
  });

  it("Default clears both attributes back to null (the style by depth)", () => {
    const editor = mountEditor(doc(ol([li("one", ol([li("inner")], { markerFormat: "upper-alpha", markerDelimiter: "paren-right" }))])));
    const inner = textPos(editor.state.doc, "inner") - 4; // inside the text, then paragraph, item, list
    expect(editor.state.doc.nodeAt(inner)?.type.name).toBe("orderedList");
    expect(markers(editor.state.doc)).toEqual(["1.", "A)"]);
    expect(setListNumbering(editor.view, inner, null)).toBe(true);
    expect(editor.state.doc.nodeAt(inner)?.attrs).toMatchObject({ markerFormat: null, markerDelimiter: null });
    expect(markers(editor.state.doc)).toEqual(["1.", "a."]);
    // Nothing to change: no step.
    expect(setListNumbering(editor.view, inner, null)).toBe(false);
  });

  it("sets the start number (0 to 9999) as one undo step, and refuses anything else", () => {
    const editor = mountEditor(doc(ol([li("a"), li("b")], { markerFormat: "lower-roman" })));
    expect(setListStart(editor.view, 0, 4)).toBe(true);
    expect(markers(editor.state.doc)).toEqual(["iv.", "v."]);
    expect(setListStart(editor.view, 0, 0)).toBe(true);
    expect(markers(editor.state.doc)).toEqual(["0.", "i."]);
    for (const bad of [-1, 10000, 2.5, Number.NaN]) expect(setListStart(editor.view, 0, bad)).toBe(false);
    editor.commands.undo();
    expect(markers(editor.state.doc)).toEqual(["iv.", "v."]);
    editor.commands.undo();
    expect(markers(editor.state.doc)).toEqual(["i.", "ii."]);
  });

  it("only writes to numbered lists", () => {
    const editor = mountEditor(doc(ul([li("a")]), p("b")));
    expect(setListNumbering(editor.view, 0, NUMBERING_STYLES[1])).toBe(false);
    expect(setListStart(editor.view, 0, 3)).toBe(false);
    expect(setListStart(editor.view, editor.state.doc.child(0).nodeSize, 3)).toBe(false);
  });
});
