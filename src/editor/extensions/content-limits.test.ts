// @vitest-environment happy-dom
// The editor keeps documents inside the limits (content-limits.ts, schema.ts): table cells hold
// paragraphs and lists, lists nest at most 9 deep, tables have at most 12 columns, and a pasted slice
// is normalized like a saved document without breaking where it lands.

import type { Editor, JSONContent } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { documentProblem, normalizeAndCheckBody } from "../model/document-check";
import { CELL_CONTENT } from "../schema";
import { destroyEditors, doc, mountEditor, p, press, type } from "../testing/editor";
import { BLOCK_ITEMS } from "./block-items";
import { canAddColumn, normalizeSlice, tableColumnsAt } from "./content-limits";

afterEach(destroyEditors);

const td = (...content: JSONContent[]): JSONContent => ({ type: "tableCell", content: content.length ? content : [p()] });
const table = (columns: number, rows = 2): JSONContent => ({
  type: "table",
  content: Array.from({ length: rows }, () => ({ type: "tableRow", content: Array.from({ length: columns }, () => td()) })),
});

/** The caret in the first empty paragraph of the first table cell. */
function caretInCell(editor: Editor) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === "tableCell") at = pos + 2;
    return at < 0;
  });
  editor.commands.setTextSelection(at);
}

const types = (editor: Editor) => (editor.getJSON().content ?? []).map((block) => block.type);

describe("table cells hold paragraphs and lists", () => {
  it("is the schema's content expression", () => {
    const editor = mountEditor(doc(p()));
    expect(CELL_CONTENT).toBe("(paragraph | bulletList | orderedList)+");
    expect(editor.schema.nodes.tableCell.spec.content).toBe(CELL_CONTENT);
    expect(editor.schema.nodes.tableHeader.spec.content).toBe(CELL_CONTENT);
  });

  it("the block menu offers text and lists in a cell, no headings, tables, callouts or dividers", () => {
    const editor = mountEditor(doc(p("Before"), table(2)));
    caretInCell(editor);
    const offered = BLOCK_ITEMS.filter((item) => item.isAvailable(editor)).map((item) => item.id);
    expect(offered).toEqual(["text", "bulletList", "orderedList"]);
  });

  it("`---` typed in a cell stays text instead of splitting the table", () => {
    const editor = mountEditor(doc(p("Before"), table(2)));
    caretInCell(editor);
    for (const char of "---") type(editor, char);
    expect(types(editor)).toEqual(["paragraph", "table", "paragraph"]);
    expect(editor.state.doc.child(1).firstChild?.firstChild?.textContent).toBe("---");
  });

  it("`---` on a line of its own outside a table is still a divider", () => {
    const editor = mountEditor(doc(p("Before"), p()));
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);
    for (const char of "---") type(editor, char);
    expect(types(editor)).toContain("horizontalRule");
  });

  describe("in a list inside a cell", () => {
    /** A table whose first cell holds a bulleted item of two paragraphs; the caret at the end of the second, "second". */
    function inCellList(second = ""): Editor {
      const item = { type: "listItem", content: [p("first"), p(second)] };
      const editor = mountEditor(doc(p("Before"), { type: "table", content: [{ type: "tableRow", content: [td({ type: "bulletList", content: [item] }), td()] }] }));
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === "listItem") at = pos + 1 + node.child(0).nodeSize + 1 + second.length;
        return at < 0;
      });
      editor.commands.setTextSelection(at);
      return editor;
    }
    const itemBlocks = (editor: Editor) => {
      const out: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "listItem") node.forEach((child) => void out.push(`${child.type.name}:${child.textContent}`));
      });
      return out;
    };

    it("the block menu offers text and lists only", () => {
      const editor = inCellList();
      expect(editor.can().setHeading({ level: 2 })).toBe(true); // the schema would let a list item take one
      expect(BLOCK_ITEMS.filter((item) => item.isAvailable(editor)).map((item) => item.id)).toEqual(["text", "orderedList"]);
    });

    it("`---` and `#`–`###` typed at the start of a line stay text", () => {
      for (const shortcut of ["---", "# ", "## ", "### "]) {
        const editor = inCellList();
        for (const char of shortcut) type(editor, char);
        expect(itemBlocks(editor), shortcut).toEqual(["paragraph:first", `paragraph:${shortcut}`]);
      }
    });

    it("Mod-Alt-1 to 3 do nothing (outside a table they still make headings)", () => {
      const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
      const mod = mac ? { meta: true, alt: true } : { ctrl: true, alt: true };
      const editor = inCellList("x");
      const before = editor.getJSON();
      expect(press(editor, "2", mod)).toBe(true);
      expect(editor.getJSON()).toEqual(before);

      const outside = mountEditor(doc({ type: "bulletList", content: [{ type: "listItem", content: [p("first"), p("x")] }] }));
      outside.commands.setTextSelection(outside.state.doc.firstChild!.firstChild!.child(0).nodeSize + 3);
      press(outside, "2", mod);
      expect(outside.state.doc.firstChild!.firstChild!.child(1).type.name).toBe("heading");
    });

    it("a pasted heading, rule or callout lands as paragraphs", () => {
      const editor = inCellList();
      const pasted = editor.schema.nodeFromJSON(
        doc(p("a"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "b" }] }, { type: "horizontalRule" }, { type: "callout", content: [p("c")] }, p("d")),
      );
      const slice = normalizeSlice(new Slice(pasted.content, 0, 0), editor.schema, false, true);
      expect(slice.content.toJSON().map((b: JSONContent) => b.type)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph", "paragraph"]);
      editor.view.dispatch(editor.state.tr.replaceSelection(slice));
      expect(documentProblem(editor.getJSON())).toBeNull();
    });

    /** Drops `nodes` (JSON) after the first item's first paragraph, as ProseMirror's own drop does: one transaction. */
    function drop(editor: Editor, ...nodes: JSONContent[]) {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === "listItem") at = pos + 1 + node.child(0).nodeSize;
        return at < 0;
      });
      const content = nodes.map((node) => editor.schema.nodeFromJSON(node));
      editor.view.dispatch(editor.state.tr.insert(at, content).setMeta("uiEvent", "drop"));
    }
    /** A document's node types and text, nothing else. */
    const outline = (node: JSONContent): unknown => node.text ?? [node.type, ...(node.content ?? []).map(outline)];
    const heading = (value: string): JSONContent => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: value }] });

    it("a dropped heading, rule, callout or table is converted at once, as the save stores it", () => {
      const editor = inCellList("second");
      drop(
        editor,
        heading("dropped heading"),
        { type: "horizontalRule" },
        { type: "callout", content: [p("callout one"), p("callout two")] },
        { type: "table", content: [{ type: "tableRow", content: [td(p("t1")), td(p("t2"))] }] },
      );
      expect(itemBlocks(editor)).toEqual([
        "paragraph:first",
        "paragraph:dropped heading",
        "paragraph:",
        "paragraph:callout one",
        "paragraph:callout two",
        "paragraph:t1",
        "paragraph:t2",
        "paragraph:second",
      ]);
      // What the editor shows is what the save stores and every channel renders.
      const saved = normalizeAndCheckBody(editor.getJSON());
      expect(saved.problem).toBeNull();
      expect(outline(saved.doc)).toEqual(outline(editor.getJSON()));
    });

    it("converts what a dropped list carries in its own items, at any depth", () => {
      const editor = inCellList("second");
      const nested = { type: "bulletList", content: [{ type: "listItem", content: [p("inner"), heading("inner heading")] }] };
      drop(editor, { type: "orderedList", content: [{ type: "listItem", content: [p("outer"), heading("outer heading"), nested] }] });
      expect(itemBlocks(editor)).not.toContain("heading:outer heading");
      expect(itemBlocks(editor)).toContain("paragraph:outer heading");
      expect(itemBlocks(editor)).toContain("paragraph:inner heading");
      expect(documentProblem(editor.getJSON())).toBeNull();
    });

    it("the conversion is part of the drop's undo step", () => {
      const editor = inCellList("second");
      drop(editor, heading("dropped"));
      expect(itemBlocks(editor)).toEqual(["paragraph:first", "paragraph:dropped", "paragraph:second"]);
      editor.commands.undo();
      expect(itemBlocks(editor)).toEqual(["paragraph:first", "paragraph:second"]);
    });

    it("leaves a heading in a list outside a table as it is", () => {
      const editor = mountEditor(doc({ type: "bulletList", content: [{ type: "listItem", content: [p("first")] }] }));
      drop(editor, heading("stays a heading"));
      expect(itemBlocks(editor)).toEqual(["paragraph:first", "heading:stays a heading"]);
    });
  });

  it("lists in cells still work from Markdown", () => {
    const editor = mountEditor(doc(p("Before"), table(2)));
    caretInCell(editor);
    for (const char of "- ") type(editor, char);
    expect(editor.state.doc.child(1).firstChild?.firstChild?.firstChild?.type.name).toBe("bulletList");
  });
});

describe("table columns", () => {
  it("counts the columns of the table around the caret; none outside a table", () => {
    const editor = mountEditor(doc(p("Before"), table(5)));
    expect(tableColumnsAt(editor.state)).toBeNull();
    expect(canAddColumn(editor.state)).toBe(false);
    caretInCell(editor);
    expect(tableColumnsAt(editor.state)).toBe(5);
    expect(canAddColumn(editor.state)).toBe(true);
  });

  it("a table of 12 columns takes no more", () => {
    const editor = mountEditor(doc(p("Before"), table(11)));
    caretInCell(editor);
    expect(canAddColumn(editor.state)).toBe(true);
    editor.chain().addColumnAfter().run();
    expect(tableColumnsAt(editor.state)).toBe(12);
    expect(canAddColumn(editor.state)).toBe(false);
  });
});

describe("Tab in a list", () => {
  /** Lists `levels` deep, one item each but the deepest (two); the caret in the deepest second item. */
  function nested(levels: number): Editor {
    let list: JSONContent = { type: "bulletList", content: [0, 1].map((i) => ({ type: "listItem", content: [p(`deepest ${i}`)] })) };
    for (let level = levels - 1; level >= 1; level--) list = { type: "bulletList", content: [{ type: "listItem", content: [p(`level ${level}`), list] }] };
    const editor = mountEditor(doc(list));
    let caret = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "deepest 1") caret = pos + 1;
    });
    editor.commands.setTextSelection(caret);
    return editor;
  }

  const depth = (node: JSONContent, level = 0): number => {
    const here = node.type === "bulletList" || node.type === "orderedList" ? level + 1 : level;
    return Math.max(here, ...(node.content ?? []).map((child) => depth(child, here)));
  };

  it("nests an item down to the ninth level", () => {
    const editor = nested(8);
    expect(press(editor, "Tab")).toBe(true);
    expect(depth(editor.getJSON())).toBe(9);
  });

  it("does nothing at the ninth level, so the document stays inside the limit", () => {
    const editor = nested(9);
    const before = editor.getJSON();
    press(editor, "Tab");
    expect(editor.getJSON()).toEqual(before);
    expect(documentProblem(editor.getJSON())).toBeNull();
  });

  it("Shift+Tab still lifts at the ninth level", () => {
    const editor = nested(9);
    const before = editor.getJSON();
    expect(press(editor, "Tab", { shift: true })).toBe(true);
    expect(editor.getJSON()).not.toEqual(before);
  });
});

describe("normalizeSlice", () => {
  it("normalizes a slice and keeps its open depths", () => {
    const editor = mountEditor(doc(p()));
    const pasted = editor.schema.nodeFromJSON(doc({ type: "paragraph", content: [{ type: "text", text: "a\tb" }] }));
    const slice = new Slice(pasted.content, 1, 1);
    const out = normalizeSlice(slice, editor.schema);
    expect(out.openStart).toBe(1);
    expect(out.openEnd).toBe(1);
    expect(out.content.textBetween(0, out.content.size)).toBe("a b");
  });

  it("a paragraph left with no text stays, empty", () => {
    const editor = mountEditor(doc(p()));
    const pasted = editor.schema.nodeFromJSON(doc({ type: "paragraph", content: [{ type: "text", text: "\u0001" }] }));
    expect(normalizeSlice(new Slice(pasted.content, 0, 0), editor.schema).content.firstChild?.childCount).toBe(0);
  });
});
