// How blocks line up (top level, and the same way inside lists, list items, callouts and cells):
//   1. By `attrs.id`. Drafts keep block ids across versions, so this is the normal case.
//   2. Where an id can't speak (missing, duplicated, or on one side only, and at least one of the two
//      blocks has no id): identical content that occurs once on each side, then, between the pairs
//      that keep their order, the most similar block of the same type (word overlap of 0.5 or more).
//      Inside a list item, a callout or a cell, a stretch with as many blocks on each side pairs in
//      order instead. Two blocks that both have ids, different ones, never pair: one was removed,
//      the other added.
//   3. The longest run of pairs that keeps the base order (the LCS of the id sequences) stays put.
//      At the top level every other pair is "moved"; inside a block it's a delete plus an insert.
//   4. Unpaired base blocks are "removed" and sit where they used to be; unpaired new ones "added".

import type { JSONContent } from "../types";
import type { Cx } from "./context";
import { uniqueIds, family, nodeKey } from "./nodes";
import { textSimilarity, rowSimilarity } from "./similarity";

export interface AlignOptions {
  /** Pair by `attrs.id` first. */
  ids: boolean;
  /** Report pairs out of order as moved (top level) instead of a delete plus an insert. */
  moves: boolean;
  /** 0..1, for blocks of the same type that content may pair. */
  similarity: (cx: Cx, a: JSONContent, b: JSONContent) => number;
  /** In a stretch with as many unpaired blocks on each side, pair them in order. */
  evenByPosition: boolean;
}

/** Blocks this similar (or more) are the same block, edited. */
const SIMILAR = 0.5;
/** Past this many candidate pairs in one stretch, skip the similarity pass (all deleted and inserted). */
const MAX_GAP_PAIRS = 10_000;

/** The document's blocks: a rewritten paragraph reads as one removed and one added. */
export const TOP_LEVEL: AlignOptions = { ids: true, moves: true, similarity: textSimilarity, evenByPosition: false };
/** A list's items: a replaced item reads as one deleted and one inserted. */
export const LIST_ITEMS: AlignOptions = { ids: true, moves: false, similarity: textSimilarity, evenByPosition: false };
/** Inside a list item, a callout or a cell (already paired): its lines pair in order when the counts match. */
export const INNER_BLOCKS: AlignOptions = { ...LIST_ITEMS, evenByPosition: true };
/** A table's rows: by content, then by position. */
export const TABLE_ROWS: AlignOptions = { ids: false, moves: false, similarity: rowSimilarity, evenByPosition: true };

/** One step of the merged reading order. `b` or `n` is -1 for an insert or a delete. */
interface Entry {
  b: number;
  n: number;
  moved: boolean;
}

export function align(cx: Cx, before: readonly JSONContent[], after: readonly JSONContent[], opts: AlignOptions): Entry[] {
  const m = before.length;
  const n = after.length;
  const b2n = new Int32Array(m).fill(-1);
  const n2b = new Int32Array(n).fill(-1);
  const link = (i: number, j: number) => {
    b2n[i] = j;
    n2b[j] = i;
  };
  const beforeIds = opts.ids ? uniqueIds(before) : null;
  const afterIds = opts.ids ? uniqueIds(after) : null;

  // 1. The same id.
  if (beforeIds && afterIds) {
    const at = new Map<string, number>();
    beforeIds.forEach((id, i) => {
      if (id) at.set(id, i);
    });
    afterIds.forEach((id, j) => {
      const i = id ? at.get(id) : undefined;
      if (i !== undefined && family(before[i]) === family(after[j])) link(i, j);
    });
  }

  // Content pairs two blocks only when ids can't: both unpaired, and at least one has no id.
  const mayPair = (i: number, j: number) => b2n[i] < 0 && n2b[j] < 0 && !(beforeIds?.[i] && afterIds?.[j]);

  // 2. Identical content that occurs once among the unpaired blocks on each side.
  const once = (nodes: readonly JSONContent[], partner: Int32Array) => {
    const at = new Map<string, number>();
    nodes.forEach((node, k) => {
      if (partner[k] >= 0) return;
      const key = nodeKey(cx, node);
      at.set(key, at.has(key) ? -1 : k);
    });
    return at;
  };
  const beforeOnce = once(before, b2n);
  for (const [key, j] of once(after, n2b)) {
    const i = beforeOnce.get(key);
    if (j >= 0 && i !== undefined && i >= 0 && mayPair(i, j)) link(i, j);
  }

  // 3. The longest run of pairs in base order stays put; the rest moved.
  const paired: number[] = [];
  for (let j = 0; j < n; j++) if (n2b[j] >= 0) paired.push(j);
  const inOrder = increasingRun(paired.map((j) => n2b[j]));
  const moved = new Uint8Array(n);
  const movedAway = new Uint8Array(m);
  const anchors: number[] = [];
  paired.forEach((j, k) => {
    const i = n2b[j];
    if (inOrder[k]) {
      anchors.push(j);
    } else if (opts.moves) {
      moved[j] = 1;
      movedAway[i] = 1;
    } else {
      b2n[i] = -1;
      n2b[j] = -1;
    }
  });

  // 4. Between in-order pairs: the most similar blocks of the same type.
  let i0 = 0;
  let j0 = 0;
  for (let k = 0; k <= anchors.length; k++) {
    const j1 = k < anchors.length ? anchors[k] : n;
    const i1 = k < anchors.length ? n2b[j1] : m;
    const gb: number[] = [];
    const gn: number[] = [];
    for (let i = i0; i < i1; i++) if (b2n[i] < 0) gb.push(i);
    for (let j = j0; j < j1; j++) if (n2b[j] < 0) gn.push(j);
    if (gb.length > 0 && gn.length > 0) pairStretch(cx, before, after, gb, gn, opts, mayPair, link);
    i0 = i1 + 1;
    j0 = j1 + 1;
  }

  // 5. Reading order: removed blocks where they were, before what was added in their place.
  const entries: Entry[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && (b2n[i] < 0 || movedAway[i])) {
      if (b2n[i] < 0) entries.push({ b: i, n: -1, moved: false });
      i++;
    } else if (j < n && (n2b[j] < 0 || moved[j])) {
      entries.push({ b: n2b[j], n: j, moved: moved[j] === 1 });
      j++;
    } else if (i < m && j < n) {
      entries.push({ b: i, n: j, moved: false }); // an in-order pair: b2n[i] === j
      i++;
      j++;
    } else {
      break;
    }
  }
  return entries;
}

/** Pairs the unpaired blocks of one stretch (between two in-order pairs) by similarity, in order. */
function pairStretch(
  cx: Cx,
  before: readonly JSONContent[],
  after: readonly JSONContent[],
  gb: readonly number[],
  gn: readonly number[],
  opts: AlignOptions,
  mayPair: (i: number, j: number) => boolean,
  link: (i: number, j: number) => void,
) {
  const M = gb.length;
  const N = gn.length;
  if (opts.evenByPosition && M === N) {
    for (let k = 0; k < M; k++) {
      if (mayPair(gb[k], gn[k]) && family(before[gb[k]]) === family(after[gn[k]])) link(gb[k], gn[k]);
    }
    return;
  }
  if (M * N > MAX_GAP_PAIRS) return;

  // score: 2 for identical content, the similarity when it clears SIMILAR, else 0 (no pair).
  const score = new Float64Array(M * N);
  for (let k = 0; k < M; k++) {
    for (let l = 0; l < N; l++) {
      const a = before[gb[k]];
      const b = after[gn[l]];
      if (a.type !== b.type || !mayPair(gb[k], gn[l])) continue;
      if (nodeKey(cx, a) === nodeKey(cx, b)) {
        score[k * N + l] = 2;
      } else {
        const s = opts.similarity(cx, a, b);
        if (s >= SIMILAR) score[k * N + l] = s;
      }
    }
  }
  // best[k][l]: the highest total score pairing gb[k..] with gn[l..] in order.
  const W = N + 1;
  const best = new Float64Array((M + 1) * W);
  for (let k = M - 1; k >= 0; k--) {
    for (let l = N - 1; l >= 0; l--) {
      const s = score[k * N + l];
      best[k * W + l] = Math.max(best[(k + 1) * W + l], best[k * W + l + 1], s > 0 ? s + best[(k + 1) * W + l + 1] : 0);
    }
  }
  let k = 0;
  let l = 0;
  while (k < M && l < N) {
    const s = score[k * N + l];
    if (s > 0 && best[k * W + l] === s + best[(k + 1) * W + l + 1]) {
      link(gb[k], gn[l]);
      k++;
      l++;
    } else if (best[k * W + l] === best[(k + 1) * W + l]) {
      k++;
    } else {
      l++;
    }
  }
}

/** Flags the members of one longest strictly increasing subsequence (patience sorting, n log n). */
function increasingRun(seq: readonly number[]): boolean[] {
  const tails: number[] = [];
  const prev = new Int32Array(seq.length).fill(-1);
  for (let k = 0; k < seq.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[k]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const keep: boolean[] = new Array<boolean>(seq.length).fill(false);
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep[k] = true;
  return keep;
}
