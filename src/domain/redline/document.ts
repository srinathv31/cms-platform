// The redline of a document: what changed between two versions, as one document a renderer can walk
// like the original (contract: RedlineDoc in ../review-types). A pure walk over the editor's TipTap
// JSON (docs/render-spec.md §2): no TipTap runtime, so it ports as is.
//
// Decisions:
//   - No base (a first version, nothing to compare with): every block is "unchanged" and the counts
//     are zero. Calling the whole document "added" would paint a first version solid green and count
//     every block as a change; the UI knows the base is null and says there is nothing to compare with yet.
//   - A moved block whose content changed too is "changed", with `movedFrom`. Counts tally statuses,
//     so it counts once, as changed (the counts always add up to changesOnly(doc).length).
//   - Trailing empty paragraphs (the editor's trailing line) are left out on both sides, as the
//     renderer does, so that line coming and going is never a change.
//   - Blocks without an id get `next:<index>` (or `base:<index>` when removed) as their RedlineBlock id.
//   - Unchanged nodes are the input objects, not copies. Nothing here mutates its input.

import type { RedlineBlock, RedlineDoc, RedlineStatus } from "../review-types";
import type { JSONContent } from "../types";
import { TOP_LEVEL, align } from "./align";
import { diffNode } from "./block-diff";
import { createCx } from "./context";
import { topLevel, uniqueIds } from "./nodes";

/** A run of unchanged blocks, folded away in the "Changes only" view ("N unchanged blocks"). */
export interface RedlineGap {
  type: "gap";
  count: number;
}

/** The redline of `next` against `base`, one entry per top-level block in reading order. */
export function diffDocuments(
  base: JSONContent | null,
  next: JSONContent,
): RedlineDoc {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const after = topLevel(next);
  const afterIds = uniqueIds(after);
  const nextId = (j: number) => afterIds[j] ?? `next:${j}`;

  if (!base) {
    return {
      blocks: after.map((node, j): RedlineBlock => ({
        id: nextId(j),
        status: "unchanged",
        node,
      })),
      counts,
    };
  }

  const before = topLevel(base);
  const beforeIds = uniqueIds(before);
  const taken = new Set(afterIds.filter((id): id is string => id !== null));
  const cx = createCx();
  const blocks: RedlineBlock[] = [];

  for (const e of align(cx, before, after, TOP_LEVEL)) {
    if (e.n < 0) {
      const id = beforeIds[e.b];
      blocks.push({
        id: id && !taken.has(id) ? id : `base:${e.b}`,
        status: "removed",
        node: before[e.b],
      });
      counts.removed++;
    } else if (e.b < 0) {
      blocks.push({ id: nextId(e.n), status: "added", node: after[e.n] });
      counts.added++;
    } else {
      const { node, changed } = diffNode(cx, before[e.b], after[e.n]);
      const status: RedlineStatus = changed
        ? "changed"
        : e.moved
          ? "moved"
          : "unchanged";
      const block: RedlineBlock = { id: nextId(e.n), status, node };
      if (e.moved) block.movedFrom = e.b;
      if (status !== "unchanged") counts[status]++;
      blocks.push(block);
    }
  }
  return { blocks, counts };
}

/** The "Changes only" filter: every block that isn't unchanged, in reading order. */
export function changesOnly(doc: RedlineDoc): RedlineBlock[] {
  return doc.blocks.filter((block) => block.status !== "unchanged");
}

/** The "Changes only" view with each run of unchanged blocks folded into one gap. */
export function groupUnchanged(doc: RedlineDoc): (RedlineBlock | RedlineGap)[] {
  const out: (RedlineBlock | RedlineGap)[] = [];
  let run = 0;
  for (const block of doc.blocks) {
    if (block.status === "unchanged") {
      run++;
      continue;
    }
    if (run > 0) out.push({ type: "gap", count: run });
    run = 0;
    out.push(block);
  }
  if (run > 0) out.push({ type: "gap", count: run });
  return out;
}

/** A rename between two versions: the name is versioned, so it goes through review like the body. */
export interface NameChange {
  from: string;
  to: string;
}

/**
 * The rename from `base` to `next`, or null when the name is the same or there is no base (nothing
 * Active yet). Names compare exactly, as typed: a change of case or spacing is a rename customers see.
 */
export function nameChange(
  base: string | null | undefined,
  next: string,
): NameChange | null {
  return base === null || base === undefined || base === next
    ? null
    : { from: base, to: next };
}
