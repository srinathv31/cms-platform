// How a paired block differs:
//   - lists, list items, callouts, cells: their children line up (align.ts) and are diffed recursively.
//     Table rows line up by content, then by position (or similarity, when rows were added); cells
//     line up by position.
//   - a child that doesn't line up is marked whole: every inline node inside gets the mark.
//   - a block whose kind changed (heading level, required key, list type, paragraph <-> heading) is
//     marked whole: the old content goes back deleted, then the new content inserted (only the new,
//     inserted, when the content itself didn't change, such as a level change).
//   - textblocks (paragraph, heading) go to inline-diff.ts.

import type { JSONContent } from "../types";
import { LIST_ITEMS, INNER_BLOCKS, TABLE_ROWS, align, type AlignOptions } from "./align";
import type { Cx, Diffed } from "./context";
import { diffTextblock } from "./inline-diff";
import { isTextblock, family, kindKey, nodeKey, contentKey, withContent, withMark, markAll } from "./nodes";

/** `next` with what changed since `base` marked in; `base` is the block paired with it. */
export function diffNode(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  if (nodeKey(cx, base) === nodeKey(cx, next)) return { node: next, changed: false };
  if (kindKey(base) !== kindKey(next)) return { node: replaceWhole(cx, base, next), changed: true };
  if (isTextblock(next)) return diffTextblock(cx, base, next);
  switch (next.type) {
    case "table":
      return diffChildren(cx, base, next, TABLE_ROWS);
    case "tableRow":
      return diffCells(cx, base, next);
    case "bulletList":
    case "orderedList":
      return diffChildren(cx, base, next, LIST_ITEMS);
    default: // listItem, callout, tableCell, tableHeader
      return diffChildren(cx, base, next, INNER_BLOCKS);
  }
}

/** A kind change: the old content back as deleted, then the new as inserted (just the new if the same). */
function replaceWhole(cx: Cx, base: JSONContent, next: JSONContent): JSONContent {
  if (family(base) !== family(next)) return markAll(next, "insert"); // never paired; kept total
  const same = contentKey(cx, base) === contentKey(cx, next);
  const mark = isTextblock(next) ? withMark : markAll;
  return withContent(next, [
    ...(same ? [] : (base.content ?? []).map((child) => mark(child, "delete"))),
    ...(next.content ?? []).map((child) => mark(child, "insert")),
  ]);
}

function diffChildren(cx: Cx, base: JSONContent, next: JSONContent, opts: AlignOptions): Diffed {
  const before = base.content ?? [];
  const after = next.content ?? [];
  const out: JSONContent[] = [];
  let changed = false;
  for (const e of align(cx, before, after, opts)) {
    if (e.n < 0) {
      out.push(markAll(before[e.b], "delete"));
      changed = true;
    } else if (e.b < 0) {
      out.push(markAll(after[e.n], "insert"));
      changed = true;
    } else {
      const child = diffNode(cx, before[e.b], after[e.n]);
      out.push(child.node);
      changed ||= child.changed;
    }
  }
  return changed ? { node: withContent(next, out), changed } : { node: next, changed: false };
}

/** Cells line up by position; extra cells on either side are marked whole. */
function diffCells(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  const before = base.content ?? [];
  const after = next.content ?? [];
  const out: JSONContent[] = [];
  let changed = before.length !== after.length;
  for (let k = 0; k < Math.max(before.length, after.length); k++) {
    if (k >= after.length) {
      out.push(markAll(before[k], "delete"));
    } else if (k >= before.length) {
      out.push(markAll(after[k], "insert"));
    } else {
      const cell = diffNode(cx, before[k], after[k]);
      out.push(cell.node);
      changed ||= cell.changed;
    }
  }
  return changed ? { node: withContent(next, out), changed } : { node: next, changed: false };
}
