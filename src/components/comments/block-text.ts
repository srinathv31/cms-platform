// What a block says, as one line of plain text: the muted anchor line on a card about a whole block
// (a thread with no quote). Pure; it reads the document's JSON, so it works on the saved body and on
// the live one alike.

import type { JSONContent } from "@/domain/types";

/** Enough for any one-line truncation; keeps a huge block from putting its whole text in the DOM. */
const MAX = 240;

const INLINE = new Set(["text", "variable", "hardBreak"]);

/** Variable labels by key: a chip reads as its label, as it does in the document. */
export type VariableLabels = ReadonlyMap<string, string> | Record<string, string>;

function labelOf(labels: VariableLabels | undefined, key: string): string {
  if (!labels) return key;
  return (labels instanceof Map ? labels.get(key) : (labels as Record<string, string>)[key]) ?? key;
}

function collect(node: JSONContent, labels: VariableLabels | undefined): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") return labelOf(labels, String(node.attrs?.key ?? ""));
  if (node.type === "hardBreak") return " ";
  const children = node.content ?? [];
  const inline = children.every((child) => child.type !== undefined && INLINE.has(child.type));
  return children.map((child) => collect(child, labels)).join(inline ? "" : " ");
}

/** The block with this id: a top-level one first, then any nested one that carries the id. */
function findBlock(doc: JSONContent, blockId: string): JSONContent | null {
  for (const block of doc.content ?? []) if (block.attrs?.id === blockId) return block;
  const walk = (node: JSONContent): JSONContent | null => {
    for (const child of node.content ?? []) {
      if (child.attrs?.id === blockId) return child;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(doc);
}

/** The text of a block on one line (whitespace runs as one space, chips as their label), or null when the block isn't there or says nothing. */
export function blockTextOf(
  doc: JSONContent | null | undefined,
  blockId: string,
  labels?: VariableLabels,
): string | null {
  if (!doc) return null;
  const block = findBlock(doc, blockId);
  if (!block) return null;
  const text = collect(block, labels).replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, MAX);
}
