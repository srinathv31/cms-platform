// Tiny builders for TipTap JSON (the shape the editor stores), for documents written by hand in
// tests. They write what a saved document holds: blocks carry an `id`, an ordered list carries
// `start`, and a numbering style appears only when the author chose one.

import type { JSONContent } from "@tiptap/core";
import type { MarkerDelimiter, MarkerFormat } from "@/editor/model/list-markers";
import type { Variable } from "@/editor/model/types";

export type Node = JSONContent;
type Mark = { type: string; attrs?: Record<string, unknown> };

export const bold: Mark = { type: "bold" };
export const italic: Mark = { type: "italic" };
export const underline: Mark = { type: "underline" };
export const linkMark = (href: string): Mark => ({ type: "link", attrs: { href } });

/** A text run. `marks` is a list of Mark values (bold, italic, underline, linkMark(...)). */
export const t = (text: string, ...marks: Mark[]): Node => ({ type: "text", text, ...(marks.length ? { marks } : {}) });
export const b = (text: string): Node => t(text, bold);
export const link = (text: string, href: string): Node => t(text, linkMark(href));
/** A variable chip. */
export const v = (key: string, ...marks: Mark[]): Node => ({ type: "variable", attrs: { key }, ...(marks.length ? { marks } : {}) });
export const br: Node = { type: "hardBreak" };

export const p = (...content: Node[]): Node => ({ type: "paragraph", ...(content.length ? { content } : {}) });
/** A paragraph of plain text. */
export const para = (text: string): Node => p(t(text));
export const h = (level: number, ...content: Node[]): Node => ({ type: "heading", attrs: { level, requiredKey: null }, content });
export const section = (level: number, requiredKey: string, ...content: Node[]): Node => ({ type: "heading", attrs: { level, requiredKey }, content });

export const li = (...content: Node[]): Node => ({ type: "listItem", content });
/** A list item holding one line of text, then any nested blocks. */
export const item = (text: string, ...more: Node[]): Node => li(para(text), ...more);
export const ul = (...items: Node[]): Node => ({ type: "bulletList", content: items });

export interface OrderedStyle {
  start?: number;
  format?: MarkerFormat | null;
  delimiter?: MarkerDelimiter | null;
}
/** An ordered list. With no style (or `{}`), it takes the default for its depth. */
export const ol = (style: OrderedStyle, ...items: Node[]): Node => {
  const attrs: Record<string, unknown> = { start: style.start ?? 1 };
  if (style.format !== undefined) attrs.markerFormat = style.format;
  if (style.delimiter !== undefined) attrs.markerDelimiter = style.delimiter;
  return { type: "orderedList", attrs, content: items };
};

export const td = (...content: Node[]): Node => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: content.length ? content : [p()] });
export const th = (...content: Node[]): Node => ({ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: content.length ? content : [p()] });
/** A cell of text. */
export const cell = (text: string): Node => td(para(text));
export const head = (text: string): Node => th(para(text));
export const span = (cellNode: Node, colspan: number, rowspan = 1): Node => ({ ...cellNode, attrs: { ...cellNode.attrs, colspan, rowspan } });
export const row = (...cells: Node[]): Node => ({ type: "tableRow", content: cells });
export const table = (...rows: Node[]): Node => ({ type: "table", content: rows });

export const callout = (...content: Node[]): Node => ({ type: "callout", content });
export const rule: Node = { type: "horizontalRule" };

/** The document. Top-level blocks get stable ids (b1, b2, ...) like saved documents. */
export const doc = (...blocks: Node[]): Node => ({
  type: "doc",
  content: blocks.map((block, i) => ({ ...block, attrs: { id: `b${i + 1}`, ...block.attrs } })),
});

/** The one-line email fields: a document of one paragraph. */
export const line = (...content: Node[]): Node => ({ type: "doc", content: [{ type: "paragraph", content }] });

export const variable = (key: string, label: string, type: Variable["type"], required: boolean, sample: string): Variable => ({
  key,
  label,
  type,
  required,
  sample,
});

/** `depth` ordered lists inside one another, the innermost holding `text`. */
export function nestedOrdered(depth: number, text: string): Node {
  let inner: Node = ol({}, item(text));
  for (let d = 1; d < depth; d += 1) inner = ol({}, item(`Level ${depth - d}`, inner));
  return inner;
}
