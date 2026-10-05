// The document's blocks as a short list of names, for choosing which block to comment on without a
// pointer: a heading is its text, a table its header cells ("Table: Rate or fee, What you pay"), a list
// its first item ("List: Purchases must post…"), anything else its first words. Pure TypeScript.

import type { JSONContent, Variable } from "@/domain/types";

export interface BlockOption {
  id: string;
  /** What the menu shows. */
  label: string;
  heading: boolean;
}

const MAX_LABEL = 56;

function textOf(node: JSONContent, labels: ReadonlyMap<string, string>): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") {
    const key = String(node.attrs?.key ?? "");
    return labels.get(key) ?? key;
  }
  // Rows, items and paragraphs read as separate runs; words from different ones shouldn't run together.
  return (node.content ?? []).map((child) => textOf(child, labels)).join(node.type === "paragraph" || node.type === "text" ? "" : " ");
}

/** The cells of a table's first row that say something, as "a, b". */
function tableLabel(table: JSONContent, labels: ReadonlyMap<string, string>): string {
  for (const row of table.content ?? []) {
    const cells = (row.content ?? []).map((cell) => textOf(cell, labels).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (cells.length > 0) return `Table: ${cells.join(", ")}`;
  }
  return "";
}

/** The first item of a list that says something. */
function listLabel(list: JSONContent, labels: ReadonlyMap<string, string>): string {
  for (const item of list.content ?? []) {
    const text = textOf(item, labels).replace(/\s+/g, " ").trim();
    if (text) return `List: ${text}`;
  }
  return "";
}

/** What a block is called in the menu: its kind where its text alone would read as a run of cells or items. */
function nameOf(block: JSONContent, labels: ReadonlyMap<string, string>): string {
  switch (block.type) {
    case "table":
      return tableLabel(block, labels);
    case "bulletList":
    case "orderedList":
      return listLabel(block, labels);
    default:
      return textOf(block, labels);
  }
}

/** One line, cut at a word (not through one) with an ellipsis when it is too long. */
function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_LABEL) return flat;
  const cut = flat.slice(0, MAX_LABEL - 1);
  const wholeWords = flat[MAX_LABEL - 1] === " " ? cut : cut.replace(/\s+\S*$/, "");
  return `${(wholeWords || cut).trimEnd()}…`;
}

/** The top-level blocks that can carry a comment, in reading order. A divider can't; an empty block has nothing to name. */
export function blockOptions(body: JSONContent, variables: readonly Variable[]): BlockOption[] {
  const labels = new Map(variables.map((v) => [v.key, v.label] as const));
  const out: BlockOption[] = [];
  for (const block of body.content ?? []) {
    const id = block.attrs?.id;
    if (typeof id !== "string" || block.type === "horizontalRule") continue;
    const label = shorten(nameOf(block, labels));
    if (label) out.push({ id, label, heading: block.type === "heading" });
  }
  return out;
}
