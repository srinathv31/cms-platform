// What the diff carries from one step to the next: the per-call caches, and what a node diff returns.

import type { JSONContent } from "../types";

export interface Bag {
  counts: Map<string, number>;
  size: number;
}

export interface Cx {
  /** Content keys (ids ignored), by node. */
  keys: WeakMap<JSONContent, string>;
  /** Word multisets for similarity, by node. */
  bags: WeakMap<JSONContent, Bag>;
}

export function createCx(): Cx {
  return { keys: new WeakMap(), bags: new WeakMap() };
}

export interface Diffed {
  node: JSONContent;
  changed: boolean;
}
