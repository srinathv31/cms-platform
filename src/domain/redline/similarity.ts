// How alike two blocks are: the word overlap that pairs a block with its edited self when ids can't.

import type { JSONContent } from "../types";
import type { Bag, Cx } from "./context";

/** Words, runs of whitespace, runs of punctuation. A word may hold ' ’ . , - between letters or digits. */
export const TOKEN =
  /[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*|\s+|[^\p{L}\p{N}\s]+/gu;
export const WORDISH = /[\p{L}\p{N}]/u;

/**
 * The node's words and chips, as a multiset (case ignored). Punctuation and whitespace don't count:
 * "Gamma." and "Delta." share nothing.
 */
function bag(cx: Cx, node: JSONContent): Bag {
  const hit = cx.bags.get(node);
  if (hit) return hit;
  const counts = new Map<string, number>();
  let size = 0;
  const add = (token: string) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
    size++;
  };
  const walk = (x: JSONContent) => {
    if (x.type === "text") {
      for (const piece of (typeof x.text === "string" ? x.text : "").match(
        TOKEN,
      ) ?? []) {
        if (WORDISH.test(piece)) add(piece.toLowerCase());
      }
    } else if (x.type === "variable") {
      add(`{{${String(x.attrs?.key)}}}`);
    } else {
      x.content?.forEach(walk);
    }
  };
  walk(node);
  const out = { counts, size };
  cx.bags.set(node, out);
  return out;
}

/** Dice coefficient of two multisets: 1 = the same words, 0 = none in common. */
function dice(a: Bag, b: Bag): number {
  if (a.size + b.size === 0) return 1;
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let shared = 0;
  for (const [token, count] of small.counts)
    shared += Math.min(count, large.counts.get(token) ?? 0);
  return (2 * shared) / (a.size + b.size);
}

export function textSimilarity(cx: Cx, a: JSONContent, b: JSONContent): number {
  return dice(bag(cx, a), bag(cx, b));
}

/** Rows compare cell by cell, so one edited cell leaves a row recognisable. */
export function rowSimilarity(cx: Cx, a: JSONContent, b: JSONContent): number {
  const ac = a.content ?? [];
  const bc = b.content ?? [];
  const width = Math.max(ac.length, bc.length);
  if (width === 0) return 1;
  let sum = 0;
  for (let k = 0; k < Math.min(ac.length, bc.length); k++)
    sum += dice(bag(cx, ac[k]), bag(cx, bc[k]));
  return sum / width;
}
