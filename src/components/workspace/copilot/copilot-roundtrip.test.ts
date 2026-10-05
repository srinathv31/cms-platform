// @vitest-environment happy-dom
// The round trip the Copilot prompt depends on: a draft written out as Markdown (domain/copilot.ts)
// and read back by the editor's Markdown paste (markdownToHtml → the schema → `{{key}}` chips) is the
// same document. An answer that keeps the draft's syntax pastes back without losing structure.

import { describe, expect, it } from "vitest";
import { generateJSON } from "@tiptap/html";
import { baseExtensions, chipsInJSON, markdownToHtml, type JSONContent } from "@/editor";
import { documentToMarkdown } from "@/domain/copilot";

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const h = (level: number, title: string): JSONContent => ({ type: "heading", attrs: { level }, content: [text(title)] });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const row = (cell: "tableHeader" | "tableCell", ...cells: JSONContent[][]): JSONContent => ({
  type: "tableRow",
  content: cells.map((content) => ({ type: cell, content: [p(...content)] })),
});

const BODY: JSONContent = {
  type: "doc",
  content: [
    h(2, "Offer details"),
    p(text("Hi "), chip("first_name"), text(", earn a "), text("$200", [{ type: "bold" }]), text(" credit "), text("soon", [{ type: "italic" }]), text(".")),
    { type: "bulletList", content: [li(p(text("One"))), li(p(text("Two")), { type: "orderedList", content: [li(p(text("Nested")))] })] },
    h(2, "Rates and fees"),
    { type: "table", content: [row("tableHeader", [text("Rate")], [text("What you pay")]), row("tableCell", [text("Purchase APR")], [chip("purchase_apr")])] },
    h(3, "How interest works"),
    p(text("See "), text("the terms", [{ type: "link", attrs: { href: "https://example.com/terms" } }]), text(" [and *more*].")),
    { type: "horizontalRule" },
    h(2, "Legal notices"),
    p(text("Terms apply.")),
  ],
};

/** The parts of a node that matter here: type, text, marks (by type and href), level, chip key. */
function shape(node: JSONContent): unknown {
  const attrs: Record<string, unknown> = {};
  if (node.type === "heading") attrs.level = node.attrs?.level;
  if (node.type === "variable") attrs.key = node.attrs?.key;
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks?.length ? { marks: node.marks.map((mark) => (mark.type === "link" ? `link:${mark.attrs?.href}` : mark.type)) } : {}),
    ...(node.content?.length ? { content: node.content.map(shape) } : {}),
  };
}

describe("draft → Markdown → paste", () => {
  it("gives back the same blocks, marks, links and chips", () => {
    const markdown = documentToMarkdown(BODY);
    const back = chipsInJSON(generateJSON(markdownToHtml(markdown), baseExtensions()));
    expect(shape(back)).toEqual(shape(BODY));
  });
});
