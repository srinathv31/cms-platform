// Pure helpers behind <RedlineDocument>: grouping, labels and the whole-block marks. No React, so
// they are cheap to test and safe on the server and the client.

import type { JSONContent } from "@/editor/model/types";
import { plural } from "@/domain/plural";
import type { RedlineBlock, RedlineDoc, RedlineStatus } from "@/domain/review-types";

/**
 * What the document paints, in reading order:
 * - a block;
 * - with `changesOnly`, a caption (the section an unchanged heading names, over the changes below it)
 *   and a quiet count for a run of unchanged blocks.
 * `hidden` lists the blocks an item stands in for (Changes only): the blocks of a counted run, the
 * heading a caption names, and an unchanged heading that shows nowhere. A comment on a hidden block
 * gets its marker beside that item.
 */
export type RedlineItem =
  | { type: "block"; block: RedlineBlock; hidden?: string[] }
  | { type: "caption"; text: string; key: string; hidden: string[] }
  | { type: "gap"; count: number; hidden: string[] };

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
 *
 * `reveal` (the block of the thread being read) is painted where it is even though it didn't change,
 * so a comment on an unchanged block can be read against its text; the runs around it are counted
 * apart.
 */
export function groupBlocks(
  doc: RedlineDoc,
  changesOnly: boolean,
  labels?: ReadonlyMap<string, string>,
  reveal: string | null = null,
): RedlineItem[] {
  if (!changesOnly) return doc.blocks.map((block) => ({ type: "block", block }));

  const items: RedlineItem[] = [];
  let run: string[] = [];
  let pending: { text: string; key: string } | null = null;
  /** Unchanged headings that show nowhere (no caption): they ride on the next item painted. */
  let dropped: string[] = [];
  const push = (item: RedlineItem) => {
    if (dropped.length > 0) item.hidden = [...dropped, ...(item.hidden ?? [])];
    dropped = [];
    items.push(item);
  };
  const flush = () => {
    if (run.length > 0) push({ type: "gap", count: run.length, hidden: run });
    run = [];
  };
  const drop = () => {
    if (pending) dropped.push(pending.key);
    pending = null;
  };
  const caption = () => {
    if (pending) push({ type: "caption", ...pending, hidden: [pending.key] });
    pending = null;
  };

  for (const block of doc.blocks) {
    const shown = block.status !== "unchanged" || block.id === reveal;
    if (!shown && isHeading(block)) {
      flush();
      drop();
      const text = plainText(block.node, labels).replace(/\s+/g, " ").trim();
      if (text) pending = { text, key: block.id };
      else dropped.push(block.id);
      continue;
    }
    if (isHeading(block)) {
      // A changed (or revealed) heading says where it is on its own.
      flush();
      drop();
      push({ type: "block", block });
      continue;
    }
    caption();
    if (!shown) {
      run.push(block.id);
      continue;
    }
    flush();
    push({ type: "block", block });
  }
  flush();
  drop();
  // Headings after the last thing painted ride on it.
  const last = items[items.length - 1];
  if (dropped.length > 0 && last) last.hidden = [...(last.hidden ?? []), ...dropped];
  return items;
}

/**
 * The key a comment marker is grouped and placed under for what an item stands in for: a block's own
 * id, or `collapsed:` and the first block a count or caption hides (the element carries it as
 * `data-collapsed`).
 */
export function hostKey(item: RedlineItem): string | null {
  if (item.type === "block") return item.block.id;
  return item.hidden.length > 0 ? `collapsed:${item.hidden[0]}` : null;
}

/** True for the key of a caption or count that stands for hidden blocks (not a block's own id). */
export function isCollapsedKey(key: string): boolean {
  return key.startsWith("collapsed:");
}

/** Every hidden block, to the key of the item it is collapsed into (Changes only). */
export function collapsedHosts(items: readonly RedlineItem[]): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const item of items) {
    const key = hostKey(item);
    if (key) for (const id of item.hidden ?? []) hosts.set(id, key);
  }
  return hosts;
}

/** "1 unchanged block", "4 unchanged blocks". */
export function gapLabel(count: number): string {
  return plural(count, "unchanged block");
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
