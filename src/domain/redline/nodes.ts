// Reading and marking TipTap nodes: the keys that decide whether two nodes are the same, and the
// redline marks that show a node inserted or deleted.

import type { RedlineMark } from "../review-types";
import type { JSONContent } from "../types";
import type { Cx } from "./context";

type Mark = NonNullable<JSONContent["marks"]>[number];
export type RedlineOp = RedlineMark["attrs"]["op"];

export const isNode = (x: unknown): x is JSONContent => typeof x === "object" && x !== null;

export const isTextblock = (node: JSONContent) => node.type === "paragraph" || node.type === "heading";

const isEmptyParagraph = (node: JSONContent) => node.type === "paragraph" && !node.content?.length;

/** The document's top-level blocks, without the trailing empty paragraphs. */
export function topLevel(doc: JSONContent | null | undefined): JSONContent[] {
  const content = doc && Array.isArray(doc.content) ? doc.content.filter(isNode) : [];
  let end = content.length;
  while (end > 0 && isEmptyParagraph(content[end - 1])) end--;
  return content.slice(0, end);
}

function idAttr(node: JSONContent): string | null {
  const id: unknown = node.attrs?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Each node's id, or null when it has none or shares it with a sibling. */
export function uniqueIds(nodes: readonly JSONContent[]): (string | null)[] {
  const seen = new Map<string, number>();
  for (const node of nodes) {
    const id = idAttr(node);
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return nodes.map((node) => {
    const id = idAttr(node);
    return id && seen.get(id) === 1 ? id : null;
  });
}

/** Blocks of one family can stand in for each other (a heading for a paragraph, a list for a list). */
export function family(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return "text";
    case "bulletList":
    case "orderedList":
      return "list";
    case "tableCell":
    case "tableHeader":
      return "cell";
    default:
      return String(node.type);
  }
}

/** Attribute values equal to these are the same as no value. */
const DEFAULT_ATTRS: Readonly<Record<string, unknown>> = { colspan: 1, rowspan: 1, start: 1 };

/** Attributes that mean something: not `id`, not null, not a default. Sorted, so key order is noise. */
function attrsKey(attrs: JSONContent["attrs"]): string {
  if (!attrs) return "";
  const parts: string[] = [];
  for (const name of Object.keys(attrs).sort()) {
    const value: unknown = attrs[name];
    if (name === "id" || value === null || value === undefined || DEFAULT_ATTRS[name] === value) continue;
    parts.push(`${name}=${JSON.stringify(value)}`);
  }
  return parts.length > 0 ? `{${parts.join(";")}}` : "";
}

/** A link is its href (target and rel are editor defaults); other marks are their type and attributes. */
function markKey(mark: Mark): string {
  return mark.type === "link" ? `link(${String(mark.attrs?.href ?? "")})` : mark.type + attrsKey(mark.attrs);
}

export function marksKey(marks: JSONContent["marks"]): string {
  return marks?.length ? `<${marks.map(markKey).sort().join(",")}>` : "";
}

/** The node's type and meaningful attributes: what a "kind" change changes. */
export function kindKey(node: JSONContent): string {
  return String(node.type) + attrsKey(node.attrs);
}

/** Everything about a node except ids. Equal keys render the same. */
export function nodeKey(cx: Cx, node: JSONContent): string {
  const hit = cx.keys.get(node);
  if (hit !== undefined) return hit;
  let key = kindKey(node) + marksKey(node.marks);
  if (typeof node.text === "string") key += JSON.stringify(node.text);
  if (node.content?.length) key += `[${node.content.map((child) => nodeKey(cx, child)).join(",")}]`;
  cx.keys.set(node, key);
  return key;
}

export function contentKey(cx: Cx, node: JSONContent): string {
  return (node.content ?? []).map((child) => nodeKey(cx, child)).join(",");
}

export function withContent(node: JSONContent, content: JSONContent[]): JSONContent {
  const copy: JSONContent = { ...node, content };
  if (content.length === 0) delete copy.content;
  return copy;
}

export function redline(op: RedlineOp): RedlineMark {
  return { type: "redline", attrs: { op } };
}

export function withMark(inline: JSONContent, op: RedlineOp): JSONContent {
  return { ...inline, marks: [...(inline.marks ?? []), redline(op)] };
}

/** The whole block marked: every inline node inside it gets the mark. */
export function markAll(node: JSONContent, op: RedlineOp): JSONContent {
  if (!node.content?.length) return node;
  if (isTextblock(node)) return { ...node, content: node.content.map((child) => withMark(child, op)) };
  return { ...node, content: node.content.map((child) => markAll(child, op)) };
}
