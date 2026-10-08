// @vitest-environment happy-dom
// List markers (extensions/list-markers.ts): the live editor's decorations and the static render
// show the same marker text, the one model/list-markers.ts writes (docs/render-spec.md, "Lists and
// markers"), for nested, mixed, styled and started lists.

import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { StaticDocument } from "../components/static-document";
import { destroyEditors, mountEditor } from "../testing/editor";
import { LIST_MARKER_ATTR, listItemMarkers } from "./list-markers";

afterEach(destroyEditors);

// ── Fixtures ─────────────────────────────────────────────────────

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: "listItem", content: [p(text), ...nested] });
const ol = (items: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({ type: "orderedList", attrs, content: items });
const ul = (items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const cell = (...content: JSONContent[]): JSONContent => ({ type: "tableCell", content });
const table = (...cells: JSONContent[]): JSONContent => ({ type: "table", content: [{ type: "tableRow", content: cells }] });

/** A document and the markers it shows, in document order. */
const CASES: [string, JSONContent, string[]][] = [
  ["ordered › ordered › ordered › ordered (default by depth)", doc(ol([li("1", ol([li("2", ol([li("3", ol([li("4")]))]))]))])), ["1.", "a.", "i.", "1."]],
  ["ordered › bullet › ordered (bullets don't count)", doc(ol([li("1", ul([li("2", ol([li("3")]))]))])), ["1.", "•", "a."]],
  ["bullet › ordered › bullet › bullet", doc(ul([li("1", ol([li("2", ul([li("3", ul([li("4")]))]))]))])), ["•", "1.", "◦", "▪"]],
  ["four bullet levels cycle", doc(ul([li("1", ul([li("2", ul([li("3", ul([li("4")]))]))]))])), ["•", "◦", "▪", "•"]],
  ["a styled parent doesn't change a child's default", doc(ol([li("1", ol([li("2")]))], { markerFormat: "lower-alpha", markerDelimiter: "parens" })), ["(a)", "a."]],
  ["a styled child", doc(ol([li("1", ol([li("2"), li("3")], { markerFormat: "upper-roman", markerDelimiter: "paren-right" }))])), ["1.", "I)", "II)"]],
  ["format and delimiter fall back on their own", doc(ol([li("a"), li("b")], { markerDelimiter: "parens" }), ol([li("c")], { markerFormat: "upper-alpha" })), ["(1)", "(2)", "A."]],
  ["start 0", doc(ol([li("a"), li("b")], { start: 0 })), ["0.", "1."]],
  ["start 25 in (a)", doc(ol([li("a"), li("b"), li("c")], { start: 25, markerFormat: "lower-alpha", markerDelimiter: "parens" })), ["(y)", "(z)", "(aa)"]],
  ["roman past 3999 falls back to digits", doc(ol([li("a"), li("b"), li("c")], { start: 3998, markerFormat: "upper-roman" })), ["MMMCMXCVIII.", "MMMCMXCIX.", "4000."]],
  ["start 9999 in 1)", doc(ol([li("a"), li("b")], { start: 9999, markerDelimiter: "paren-right" })), ["9999)", "10000)"]],
  ["alpha 0 falls back to digits", doc(ol([li("a"), li("b")], { start: 0, markerFormat: "lower-alpha" })), ["0.", "a."]],
  [
    "depth counts through tables",
    doc(ol([li("1", table(cell(p("x"), ol([li("in cell", ol([li("deeper")]))])), cell(ul([li("bullet")]))))])),
    ["1.", "a.", "i.", "•"],
  ],
  ["unknown style values read as the default", doc(ol([li("a")], { markerFormat: "fancy", markerDelimiter: "dash" })), ["1."]],
];

/** A position inside the text `text`. */
function textPos(root: PMNode, text: string): number {
  let at = -1;
  root.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos + 1;
    return at < 0;
  });
  return at;
}

/** The markers of every list item, in order, from a rendered element. */
function markersIn(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll("li")].map((el) => el.getAttribute(LIST_MARKER_ATTR));
}

function staticMarkers(content: JSONContent): (string | null)[] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<StaticDocument content={content} variables={[]} />);
  return markersIn(host);
}

describe("list markers", () => {
  it.each(CASES)("%s", (_name, content, expected) => {
    const editor = mountEditor(content);
    expect(listItemMarkers(editor.state.doc).map((m) => m.marker)).toEqual(expected);
    // The live editor and the static paint show exactly the same text on the same items.
    expect(markersIn(editor.view.dom)).toEqual(expected);
    expect(staticMarkers(content)).toEqual(expected);
  });

  it("renders the marker on the item itself, beside its block id, in the static paint", () => {
    const html = renderToStaticMarkup(
      <StaticDocument content={doc({ type: "orderedList", attrs: { id: "l1", start: 3 }, content: [{ ...li("Fee"), attrs: { id: "i1" } }] })} variables={[]} />,
    );
    expect(html).toContain('<ol data-id="l1" start="3">');
    expect(html).toMatch(/<li (?=[^>]*data-id="i1")(?=[^>]*data-list-marker="3\.")[^>]*><p>Fee<\/p><\/li>/);
  });

  it("keeps the markers when the static paint also highlights review threads", () => {
    const content = doc(p("intro"), { ...ol([li("Fee"), li("Rate")], { markerFormat: "lower-roman", markerDelimiter: "parens" }), attrs: { id: "l1", markerFormat: "lower-roman", markerDelimiter: "parens" } });
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <StaticDocument content={content} variables={[]} threads={[{ id: "t1", blockId: "l1", quote: "Rate", status: "open" }]} />,
    );
    expect(host.querySelector('mark[data-thread="t1"]')?.textContent).toBe("Rate");
    expect(markersIn(host)).toEqual(["(i)", "(ii)"]);
  });

  it("keeps the stored document free of markers", () => {
    const editor = mountEditor(doc(ol([li("a")])));
    expect(JSON.stringify(editor.getJSON())).not.toMatch(/listMarker|list-marker/);
    expect(editor.getHTML()).not.toContain(LIST_MARKER_ATTR);
  });

  it("renumbers as the document changes, and undo brings the markers back", () => {
    const editor = mountEditor(doc(ol([li("one"), li("two")]), ol([li("x")], { markerFormat: "lower-roman", markerDelimiter: "parens" })));
    expect(markersIn(editor.view.dom)).toEqual(["1.", "2.", "(i)"]);

    // A new first item pushes the others along.
    editor.commands.insertContentAt(1, li("zero"));
    expect(markersIn(editor.view.dom)).toEqual(["1.", "2.", "3.", "(i)"]);

    // Indenting an item makes it the first item of a nested list (depth 1: a.).
    editor.commands.setTextSelection(textPos(editor.state.doc, "two"));
    expect(editor.commands.sinkListItem("listItem")).toBe(true);
    expect(markersIn(editor.view.dom)).toEqual(["1.", "2.", "a.", "(i)"]);

    editor.commands.undo();
    expect(markersIn(editor.view.dom)).toEqual(["1.", "2.", "3.", "(i)"]);
    editor.commands.undo();
    expect(markersIn(editor.view.dom)).toEqual(["1.", "2.", "(i)"]);
  });

  it("typing inside an item keeps the markers on their items; splitting an item renumbers", () => {
    const editor = mountEditor(doc(p("intro"), ol([li("one"), li("two")], { markerFormat: "upper-alpha" })));
    editor.commands.insertContentAt(textPos(editor.state.doc, "intro"), "typed ");
    editor.commands.insertContentAt(textPos(editor.state.doc, "two"), "x");
    expect(markersIn(editor.view.dom)).toEqual(["A.", "B."]);
    expect([...editor.view.dom.querySelectorAll("li")].map((el) => el.textContent)).toEqual(["one", "txwo"]);

    editor.commands.setTextSelection(textPos(editor.state.doc, "one") + 2);
    expect(editor.commands.splitListItem("listItem")).toBe(true);
    expect(markersIn(editor.view.dom)).toEqual(["A.", "B.", "C."]);
    expect(staticMarkers(editor.getJSON())).toEqual(["A.", "B.", "C."]);
  });

  it("follows a style written to the list, as the static paint of the result does", () => {
    const editor = mountEditor(doc(ol([li("a"), li("b")], { start: 4 })));
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "markerFormat", "lower-roman").setNodeAttribute(0, "markerDelimiter", "parens"));
    expect(markersIn(editor.view.dom)).toEqual(["(iv)", "(v)"]);
    expect(staticMarkers(editor.getJSON())).toEqual(["(iv)", "(v)"]);
  });

  it("shows a start nothing can number from as 1 rather than failing", () => {
    for (const start of [-3, 1.5, "7"]) {
      const editor = mountEditor(doc(ol([li("a"), li("b")], { start })));
      expect(markersIn(editor.view.dom)).toEqual(["1.", "2."]);
    }
  });
});
