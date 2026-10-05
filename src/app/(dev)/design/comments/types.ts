import type { ThreadView } from "@/domain/review-types";

export type VariantId = "a" | "b" | "c";
export type ScreenId = "author" | "review";
/** `compose=1` opens the composer on a quote; `compose=block` on a whole block; `compose=sel` shows a selection with its bubble. */
export type ComposeId = "off" | "open" | "block" | "selection";

/** What a new thread would attach to: a block, and optionally a quoted range inside it. */
export interface Anchor {
  blockId: string;
  quote: string | null;
}

/** Which side of the screen made the last request to focus a thread: the other side reacts (scrolls). */
export type FocusSource = "doc" | "list";
export interface Focus {
  id: string;
  source: FocusSource;
  nonce: number;
}

export type { ThreadView };
