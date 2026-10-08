// @vitest-environment happy-dom
// Paste keeps the content limits (docs/render-spec.md §2–3): what lands in the editor is what every
// channel will show. Through the editor's own paste path: view.pasteHTML / pasteText →
// transformPastedHTML (normalize-html.ts) → the schema parse → transformPasted (content-limits.ts).

import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { documentProblem } from "../model/document-check";
import { tableGrid } from "../model/table-grid";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { createEditorRootRuntime } from "../state/editor-root";
import { destroyEditors, doc, mountEditor, p } from "../testing/editor";

afterEach(destroyEditors);

/** The document's editor as the app mounts it (bound to its root, so the clipboard HTML is cleaned too). */
const empty = () => {
  const root = createEditorRootRuntime({ variables: [] });
  root.registerField({ id: "body", label: "Document", kind: "body" });
  const binding = { fieldId: "body", kind: "body" as const, root, chip: createChipPopoverStore() };
  return mountEditor(doc(p()), { extensions: editorExtensions({ store: root.variables, binding }) });
};

/** The document's blocks without the empty line the paste landed in. */
function blocks(editor: Editor): JSONContent[] {
  const content = editor.getJSON().content ?? [];
  while (content.length > 1 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content) content.pop();
  return content;
}

function texts(node: JSONContent): string[] {
  if (node.type === "text") return [node.text ?? ""];
  return (node.content ?? []).flatMap(texts);
}

function find(node: JSONContent, type: string): JSONContent[] {
  return [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap((child) => find(child, type))];
}

describe("paste: text", () => {
  it("tabs become one space each (plain text)", () => {
    const editor = empty();
    editor.view.pasteText("Annual fee\t$95\t\tWaived");
    expect(texts(editor.getJSON()).join("")).toBe("Annual fee $95  Waived");
  });

  it("tabs become one space each (HTML)", () => {
    const editor = empty();
    editor.view.pasteHTML("<p>Rate:\t21.99%</p>");
    expect(texts(editor.getJSON()).join("")).toBe("Rate: 21.99%");
  });

  it("control characters go", () => {
    const editor = empty();
    editor.view.pasteText("a\u0007b\u001Fc");
    expect(texts(editor.getJSON()).join("")).toBe("abc");
  });
});

describe("paste: links", () => {
  const hrefs = (editor: Editor) =>
    find(editor.getJSON(), "text").flatMap((node) => (node.marks ?? []).filter((m) => m.type === "link").map((m) => m.attrs?.href));

  it("keeps web, email and phone links, normalized", () => {
    const editor = empty();
    editor.view.pasteHTML(
      '<p><a href="HTTPS://Coral.Example/café">terms</a> <a href="mailto:help@coral.example">mail</a> <a href="tel:+18005550100">call</a></p>',
    );
    expect(hrefs(editor)).toEqual(["https://Coral.Example/caf%C3%A9", "mailto:help@coral.example", "tel:+18005550100"]);
  });

  it("anything else is its text only", () => {
    const editor = empty();
    editor.view.pasteHTML('<p><a href="javascript:alert(1)">a</a> <a href="/terms">b</a> <a href="https://x.example/a b">c</a></p>');
    expect(hrefs(editor)).toEqual([]);
    expect(texts(editor.getJSON()).join("")).toBe("a b c");
  });

  it("the same from the editor's own HTML (passed through untouched until the schema reads it)", () => {
    const editor = empty();
    editor.view.pasteHTML('<p data-pm-slice="1 1 []"><a href="ftp://x.example">ftp</a> <a href=" https://ok.example ">ok</a></p>');
    expect(hrefs(editor)).toEqual(["https://ok.example"]);
  });
});

describe("paste: headings and lists", () => {
  it("h4–h6 become level 3", () => {
    const editor = empty();
    editor.view.pasteHTML("<h4>Four</h4><h6>Six</h6>");
    expect(blocks(editor).map((b) => [b.type, b.attrs?.level])).toEqual([
      ["heading", 3],
      ["heading", 3],
    ]);
  });

  it("a list start outside 0 to 9999 is brought inside it, so the editor shows what every channel prints", () => {
    // Only a ProseMirror editor's HTML keeps a list's start (other HTML is rebuilt without it).
    for (const [given, shown] of [["20000", 9999], ["-3", 0], ["x", 1], ["12", 12]] as const) {
      const editor = empty();
      editor.view.pasteHTML(`<ol data-pm-slice="0 0 []" start="${given}"><li><p>x</p></li></ol>`);
      expect(find(editor.getJSON(), "orderedList")[0]?.attrs?.start, given).toBe(shown);
      expect(documentProblem(editor.getJSON())).toBeNull();
    }
  });

  it("TipTap's orderedList `type` is cleared; start stays", () => {
    const editor = empty();
    editor.view.pasteHTML('<ol data-pm-slice="0 0 []" type="a" start="3"><li><p>x</p></li></ol>');
    const list = find(editor.getJSON(), "orderedList")[0];
    expect(list.attrs?.type).toBeNull();
    expect(list.attrs?.start).toBe(3);
  });
});

describe("paste: tables", () => {
  it("cell alignment and widths go", () => {
    const editor = empty();
    editor.view.pasteHTML(
      '<table data-pm-slice="0 0 []"><tbody><tr><td colwidth="120" style="text-align: center"><p>a</p></td><td align="right"><p>b</p></td></tr></tbody></table>',
    );
    const cells = find(editor.getJSON(), "tableCell");
    expect(cells.map((c) => [c.attrs?.align, c.attrs?.colwidth])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("a heading, a rule and a nested table in a cell stay in the cell, as paragraphs; the table stays whole", () => {
    const editor = empty();
    editor.view.pasteHTML(
      "<table><tr><th><h2>Fees</h2></th><th>Amount</th></tr>" +
        "<tr><td>Annual<hr></td><td><table><tr><td>$95</td><td>first year</td></tr><tr><td><h3>then</h3></td><td>$0</td></tr></table></td></tr></table>",
    );
    const content = blocks(editor);
    expect(content.map((b) => b.type)).toEqual(["table"]);
    const [table] = content;
    expect(tableGrid(table).width).toBe(2);
    const cellTexts = find(table, "tableRow").map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((b) => `${b.type}:${texts(b).join("")}`)));
    expect(cellTexts).toEqual([
      [["paragraph:Fees"], ["paragraph:Amount"]],
      [["paragraph:Annual", "paragraph:"], ["paragraph:$95", "paragraph:first year", "paragraph:then", "paragraph:$0"]],
    ]);
    expect(documentProblem(editor.getJSON())).toBeNull();
  });

  it("a table wider than 12 columns arrives as tables of at most 12, every cell kept", () => {
    const editor = empty();
    const cells = (tag: string, prefix: string) => Array.from({ length: 15 }, (_, i) => `<${tag}>${prefix}${i + 1}</${tag}>`).join("");
    editor.view.pasteHTML(`<table><tr>${cells("th", "H")}</tr><tr>${cells("td", "c")}</tr></table>`);
    const tables = blocks(editor).filter((b) => b.type === "table");
    expect(tables.map((t) => tableGrid(t).width)).toEqual([12, 3]);
    expect(tables.flatMap(texts)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `H${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `c${i + 1}`),
      "H13",
      "H14",
      "H15",
      "c13",
      "c14",
      "c15",
    ]);
    expect(documentProblem(editor.getJSON())).toBeNull();
  });
});
