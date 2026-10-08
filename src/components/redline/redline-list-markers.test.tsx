// @vitest-environment happy-dom
// List markers are the same text everywhere an author or reviewer sees a document: the live editor,
// its static first paint (StaticDocument, also the review screen's Document view until the editor
// mounts), the redline, and the RenderDoc every channel prints (docs/render-spec.md, "Lists and
// markers"). In the redline, an item struck whole keeps the number it had and doesn't push the
// new version's numbering along. It lives beside redline-document.tsx because the redline is the
// one surface that may import all the others (the editor's own marker tests are
// src/editor/extensions/list-markers.test.tsx).

import type { JSONContent } from "@tiptap/core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { diffDocuments } from "@/domain/redline";
import { resolveDocument } from "@/domain/render/resolve";
import type { RenderBlock } from "@/domain/render/types";
import { StaticDocument } from "@/editor/components/static-document";
import { LIST_MARKER_ATTR } from "@/editor/extensions/list-markers";
import { destroyEditors, mountEditor } from "@/editor/testing/editor";
import { RedlineDocument } from "./redline-document";

afterEach(destroyEditors);

const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { id: `p-${text}` }, content: [{ type: "text", text }] });
const li = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: "listItem", attrs: { id: `i-${text}` }, content: [p(text), ...nested] });
const ol = (id: string, items: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({ type: "orderedList", attrs: { id, ...attrs }, content: items });
const ul = (id: string, items: JSONContent[]): JSONContent => ({ type: "bulletList", attrs: { id }, content: items });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** Nested, mixed, styled and started lists, one in a table, and an out-of-range roman number. */
const DOC = doc(
  ol("l1", [li("one", ol("l2", [li("two", ol("l3", [li("three", ol("l4", [li("four")]))]))])), li("five", ul("b1", [li("bullet", ul("b2", [li("circle", ol("l5", [li("in bullets")]))]))]))]),
  ol("l6", [li("a"), li("b"), li("c")], { start: 25, markerFormat: "lower-alpha", markerDelimiter: "parens" }),
  ol("l7", [li("x"), li("y")], { start: 3999, markerFormat: "upper-roman", markerDelimiter: "paren-right" }),
  ol("l8", [li("zero")], { start: 0, markerDelimiter: "parens" }),
  {
    type: "table",
    attrs: { id: "t1" },
    content: [{ type: "tableRow", content: [{ type: "tableCell", content: [ol("l9", [li("cell", ol("l10", [li("cell inner")]))], { markerFormat: "upper-alpha" })] }] }],
  },
);

const EXPECTED = ["1.", "a.", "i.", "1.", "2.", "•", "◦", "a.", "(y)", "(z)", "(aa)", "MMMCMXCIX)", "4000)", "(0)", "A.", "a."];

function markersIn(html: string): (string | null)[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  return [...host.querySelectorAll("li")].map((el) => el.getAttribute(LIST_MARKER_ATTR));
}

/** The RenderDoc's markers, in document order. */
function renderDocMarkers(blocks: readonly RenderBlock[]): string[] {
  return blocks.flatMap((block): string[] => {
    if (block.type === "list") return block.items.flatMap((item) => [item.marker, ...renderDocMarkers(item.content)]);
    if (block.type === "table") return block.rows.flatMap((row) => row.cells.flatMap((cell) => renderDocMarkers(cell.content)));
    return [];
  });
}

describe("list markers everywhere", () => {
  it("the RenderDoc, the live editor, its static paint and the redline show the same markers", () => {
    expect(renderDocMarkers(resolveDocument(DOC, { variables: [], values: {} }))).toEqual(EXPECTED);

    const editor = mountEditor(DOC);
    expect([...editor.view.dom.querySelectorAll("li")].map((el) => el.getAttribute(LIST_MARKER_ATTR))).toEqual(EXPECTED);

    expect(markersIn(renderToStaticMarkup(<StaticDocument content={DOC} variables={[]} />))).toEqual(EXPECTED);

    // A redline with nothing to compare with paints every block as is.
    expect(markersIn(renderToStaticMarkup(<RedlineDocument doc={diffDocuments(null, DOC)} variables={[]} />))).toEqual(EXPECTED);
  });
});

describe("list markers in the redline", () => {
  const redline = (base: JSONContent, next: JSONContent) => markersIn(renderToStaticMarkup(<RedlineDocument doc={diffDocuments(base, next)} variables={[]} />));

  it("a removed item keeps its number; the items after it show the new version's", () => {
    const base = doc(ol("l", [li("alpha"), li("beta"), li("gamma"), li("delta")]));
    const next = doc(ol("l", [li("alpha"), li("gamma"), li("delta")]));
    // alpha 1., beta (struck) 2., gamma 2., delta 3.
    expect(redline(base, next)).toEqual(["1.", "2.", "2.", "3."]);
  });

  it("an added item takes its number in the new version", () => {
    const base = doc(ol("l", [li("alpha"), li("gamma")], { markerFormat: "lower-roman" }));
    const next = doc(ol("l", [li("alpha"), li("beta"), li("gamma")], { markerFormat: "lower-roman" }));
    expect(redline(base, next)).toEqual(["i.", "ii.", "iii."]);
  });

  it("a removed list keeps its numbers; a restyled list shows its new style", () => {
    expect(redline(doc(ol("l", [li("alpha"), li("beta")], { start: 5 })), doc(p("gone")))).toEqual(["5.", "6."]);
    const restyled = redline(doc(ol("l", [li("alpha"), li("beta")])), doc(ol("l", [li("alpha"), li("beta")], { markerFormat: "upper-alpha", markerDelimiter: "parens" })));
    expect(restyled).toEqual(["(A)", "(B)"]);
  });
});
