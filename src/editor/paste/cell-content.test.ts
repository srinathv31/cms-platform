// @vitest-environment happy-dom
// A table cell holds paragraphs and lists only, at every depth (docs/render-spec.md §2, rule 24): the
// clipboard's HTML (normalize-html.ts, fitCell) and the saved JSON (model/normalize.ts, cellContent)
// turn what else a cell brings into the same paragraphs and lists. One table of cases for both.

import { getSchema, type JSONContent } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { documentProblem } from "../model/document-check";
import { normalizeDocument } from "../model/normalize";
import { baseExtensions } from "../schema";
import { normalizePastedHtml } from "./normalize-html";

const t = (text: string): JSONContent => ({ type: "text", text });
const p = (text = ""): JSONContent => (text ? { type: "paragraph", content: [t(text)] } : { type: "paragraph" });
const h = (level: number, text: string): JSONContent => ({ type: "heading", attrs: { level }, content: [t(text)] });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const ol = (...items: JSONContent[]): JSONContent => ({ type: "orderedList", content: items });
const callout = (...content: JSONContent[]): JSONContent => ({ type: "callout", content });
const rule: JSONContent = { type: "horizontalRule" };
const td = (...content: JSONContent[]): JSONContent => ({ type: "tableCell", content });
const table = (...rows: JSONContent[][]): JSONContent => ({ type: "table", content: rows.map((cells) => ({ type: "tableRow", content: cells })) });

/**
 * Blocks as a short outline: `p:text` (`[br]` for a hard break), `ul[…]` / `ol[…]` of `li(…)`, and
 * the type for anything else. Attributes (ids, the schema's defaults) are left out.
 */
function outline(block: JSONContent): string {
  switch (block.type) {
    case "paragraph":
      return `p:${(block.content ?? []).map((n) => (n.type === "hardBreak" ? "[br]" : (n.text ?? ""))).join("")}`;
    case "bulletList":
    case "orderedList":
      return `${block.type === "bulletList" ? "ul" : "ol"}[${(block.content ?? []).map((item) => `li(${(item.content ?? []).map(outline).join(", ")})`).join(", ")}]`;
    default:
      return block.type ?? "?";
  }
}

/** The first cell's content of the first table in `doc`. */
function firstCell(doc: JSONContent): JSONContent[] {
  const found = (doc.content ?? []).find((block) => block.type === "table");
  return found?.content?.[0]?.content?.[0]?.content ?? [];
}

const CASES: { name: string; html: string; json: JSONContent[]; want: string[] }[] = [
  { name: "paragraphs and lists stay", html: "<p>a</p><ul><li><p>b</p></li></ul>", json: [p("a"), ul(li(p("b")))], want: ["p:a", "ul[li(p:b)]"] },
  { name: "a heading becomes a paragraph", html: "<h2>Fees</h2>", json: [h(2, "Fees")], want: ["p:Fees"] },
  { name: "a rule becomes an empty paragraph", html: "<p>a</p><hr>", json: [p("a"), rule], want: ["p:a", "p:"] },
  { name: "a callout gives its paragraphs", html: "<div data-callout><p>one</p><p>two</p></div>", json: [callout(p("one"), p("two"))], want: ["p:one", "p:two"] },
  {
    name: "a table gives its cells' content, in reading order",
    html: "<table><tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr></table>",
    json: [table([td(p("x")), td(p("y"))], [td(p("z")), td(p("w"))])],
    want: ["p:x", "p:y", "p:z", "p:w"],
  },
  { name: "a heading in a list item", html: "<ul><li><p>a</p><h3>b</h3></li></ul>", json: [ul(li(p("a"), h(3, "b")))], want: ["ul[li(p:a, p:b)]"] },
  { name: "a rule in a list item", html: "<ol><li><p>a</p><hr></li></ol>", json: [ol(li(p("a"), rule))], want: ["ol[li(p:a, p:)]"] },
  {
    name: "a callout in a list item",
    html: "<ul><li><p>a</p><div data-callout><p>c</p></div></li></ul>",
    json: [ul(li(p("a"), callout(p("c"))))],
    want: ["ul[li(p:a, p:c)]"],
  },
  {
    name: "a table in a list item",
    html: "<ul><li><p>a</p><table><tr><td>x</td><td>y</td></tr></table></li></ul>",
    json: [ul(li(p("a"), table([td(p("x")), td(p("y"))])))],
    want: ["ul[li(p:a, p:x, p:y)]"],
  },
  {
    name: "a heading in a nested list's item",
    html: "<ul><li><p>a</p><ol><li><p>b</p><h2>c</h2></li></ol></li></ul>",
    json: [ul(li(p("a"), ol(li(p("b"), h(2, "c")))))],
    want: ["ul[li(p:a, ol[li(p:b, p:c)])]"],
  },
];

const schema = getSchema(baseExtensions());

/** Clipboard HTML of a one-row table whose first cell holds `inner`, cleaned and parsed by the schema (no JSON normalization). */
function fromHtml(inner: string): JSONContent {
  const cleaned = normalizePastedHtml(`<table><tr><td>${inner}</td><td>other</td></tr></table>`);
  const container = document.createElement("div");
  container.innerHTML = cleaned;
  return PMDOMParser.fromSchema(schema).parse(container).toJSON() as JSONContent;
}

/** The same table as stored JSON, normalized at save. */
function fromJson(content: JSONContent[]): JSONContent {
  return normalizeDocument({ type: "doc", content: [table([td(...content), td(p("other"))])] });
}

describe("what a table cell holds, from the clipboard's HTML and from the JSON", () => {
  it.each(CASES)("$name", ({ html, json, want }) => {
    const pasted = fromHtml(html);
    const saved = fromJson(json);
    expect(firstCell(pasted).map(outline), "HTML (fitCell)").toEqual(want);
    expect(firstCell(saved).map(outline), "JSON (cellContent)").toEqual(want);
    expect(documentProblem(pasted)).toBeNull();
    expect(documentProblem(saved)).toBeNull();
  });
});
