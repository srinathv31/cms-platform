// Pure helpers behind <RedlineDocument>: grouping, labels and the whole-block marks. No React, so
// they are cheap to test and safe on the server and the client.

import type { JSONContent } from "@/editor";
import type { RedlineBlock, RedlineDoc, RedlineStatus } from "@/domain/review-types";

/**
 * What the document paints, in reading order:
 * - a block;
 * - with `changesOnly`, a caption (the section an unchanged heading names, over the changes below it)
 *   and a quiet count for a run of unchanged blocks.
 */
export type RedlineItem =
  | { type: "block"; block: RedlineBlock }
  | { type: "caption"; text: string; key: string }
  | { type: "gap"; count: number };

/** The words of a node, for a heading's caption. A chip reads as its label. */
export function plainText(node: JSONContent, labels?: ReadonlyMap<string, string>): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") {
    const key = String(node.attrs?.key ?? "");
    return labels?.get(key) ?? key;
  }
  return (node.content ?? []).map((child) => plainText(child, labels)).join("");
}

const isHeading = (block: RedlineBlock) => block.node.type === "heading";

/**
 * The items to paint. With `changesOnly`, the document is cut down to what changed, and keeps its
 * bearings:
 * - a heading that didn't change is not painted as a heading: its words caption the changes under it
 *   (the nearest heading above them), once, over the first thing its section shows;
 * - a heading that changed is painted as the change it is, and is its own label;
 * - each run of unchanged blocks (not counting the headings above) becomes one quiet count, where it was.
 * A section with nothing changed still gets its caption and the count, so the reader sees that it was looked at.
 */
export function groupBlocks(doc: RedlineDoc, changesOnly: boolean, labels?: ReadonlyMap<string, string>): RedlineItem[] {
  if (!changesOnly) return doc.blocks.map((block) => ({ type: "block", block }));

  const items: RedlineItem[] = [];
  let run = 0;
  let pending: { text: string; key: string } | null = null;
  const flush = () => {
    if (run > 0) items.push({ type: "gap", count: run });
    run = 0;
  };

  for (const block of doc.blocks) {
    if (block.status === "unchanged" && isHeading(block)) {
      flush();
      const text = plainText(block.node, labels).replace(/\s+/g, " ").trim();
      pending = text ? { text, key: block.id } : null;
      continue;
    }
    if (isHeading(block)) {
      // A changed heading says where it is on its own.
      flush();
      pending = null;
      items.push({ type: "block", block });
      continue;
    }
    if (pending) {
      items.push({ type: "caption", ...pending });
      pending = null;
    }
    if (block.status === "unchanged") {
      run++;
      continue;
    }
    flush();
    items.push({ type: "block", block });
  }
  flush();
  return items;
}

/** "1 unchanged block", "4 unchanged blocks". */
export function gapLabel(count: number): string {
  return `${count} unchanged ${count === 1 ? "block" : "blocks"}`;
}

/** What assistive technology hears for a block that isn't unchanged. */
export const BLOCK_LABEL: Record<Exclude<RedlineStatus, "unchanged">, string> = {
  added: "Added block",
  removed: "Removed block",
  changed: "Changed block",
  moved: "Moved block",
};

/** The block's layout kind: the editor's block rhythm depends on headings and dividers (see redline.css). */
export function blockKind(node: JSONContent): "h1" | "h2" | "h3" | "hr" | "block" {
  if (node.type === "heading") {
    const level = Number(node.attrs?.level);
    return level === 1 ? "h1" : level === 3 ? "h3" : "h2";
  }
  return node.type === "horizontalRule" ? "hr" : "block";
}

/** Joins with the Oxford comma: "a", "a and b", "a, b, and c". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** "2 added, 1 removed, and 3 changed"; "No changes" when nothing differs. */
export function redlineSummary(counts: RedlineDoc["counts"]): string {
  const parts = (
    [
      [counts.added, "added"],
      [counts.removed, "removed"],
      [counts.changed, "changed"],
      [counts.moved, "moved"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  return parts.length === 0 ? "No changes" : joinAnd(parts);
}

const DELETE_MARK = { type: "redline", attrs: { op: "delete" } } as const;

/**
 * A removed block is struck as a whole: every text run and chip in it gets the `delete` mark, so it
 * reads the same as deleted words inside a changed block (and carries `<del>` for screen readers).
 * Returns a copy; the input is never changed.
 */
export function markAllDeleted(node: JSONContent): JSONContent {
  if (node.type === "text" || node.type === "variable") {
    const marks = node.marks ?? [];
    return marks.some((m) => m.type === "redline") ? node : { ...node, marks: [...marks, DELETE_MARK] };
  }
  return node.content ? { ...node, content: node.content.map(markAllDeleted) } : node;
}
