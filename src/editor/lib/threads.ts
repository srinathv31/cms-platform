// Review threads in a document: where a thread's highlight goes, and what a selection would quote.
// Pure ProseMirror (server-safe): the live editor's decorations (extensions/review-threads.ts), the
// static first paint (components/static-document.tsx) and the comment request all use these, so a
// quote taken from a selection always finds its way back to the same text.
//
// A thread anchors to a block id (`attrs.id`, normally a top-level block) and, optionally, a quote:
// - the quote is looked up in the block's text (first match; whitespace runs count as one space);
// - no quote, or a quote that isn't there any more: the whole block is the anchor.
// Chips read as their label in a quote ("Hi First name, you're pre-approved").

import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { NODE, type Variable } from "../model/types";
import type { CommentRequest, ThreadAnchor } from "../types";

/** How an inline atom (a variable chip) reads in a quote. */
export type LeafText = (node: PMNode) => string;

/** Chips read as their variable's label (the key when the list doesn't have it); a line break as a space. */
export function variableLeafText(lookup: (key: string) => Pick<Variable, "label"> | undefined): LeafText {
  return (node) => {
    if (node.type.name !== NODE.variable) return node.type.spec.leafText?.(node) ?? " ";
    const key = (node.attrs.key as string | null) ?? "";
    return (key && lookup(key)?.label) || key;
  };
}

export interface BlockRef {
  node: PMNode;
  /** Position before the block. */
  pos: number;
}

/** The block with `attrs.id === blockId`: top-level blocks first, then nested ones (list items…). */
export function findBlock(doc: PMNode, blockId: string): BlockRef | null {
  if (!blockId) return null;
  let found: BlockRef | null = null;
  doc.forEach((node, offset) => {
    if (!found && node.attrs.id === blockId) found = { node, pos: offset };
  });
  if (found) return found;
  doc.descendants((node, pos) => {
    if (found || node.isInline) return false;
    if (node.attrs.id === blockId) {
      found = { node, pos };
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

/** The quote as it's matched: trimmed, whitespace runs as one space. */
export function normalizeQuote(quote: string | null | undefined): string {
  return quote ? quote.replace(/\s+/g, " ").trim() : "";
}

/**
 * A block's text, normalized like a quote, with the document range behind every character:
 * `from[i]`..`to[i]` (a chip's characters all map to the whole chip; the space between two
 * textblocks maps to the boundary).
 */
export interface TextIndex {
  text: string;
  from: number[];
  to: number[];
}

const WHITESPACE = /\s/;

export function textIndex(block: PMNode, blockPos: number, leafText: LeafText): TextIndex {
  const chars: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const push = (ch: string, a: number, b: number) => {
    if (WHITESPACE.test(ch)) {
      if (!chars.length || chars[chars.length - 1] === " ") return;
      ch = " ";
    }
    chars.push(ch);
    from.push(a);
    to.push(b);
  };
  const visit = (node: PMNode, pos: number) => {
    if (node.isText) {
      const text = node.text ?? "";
      for (let i = 0; i < text.length; i++) push(text[i], pos + i, pos + i + 1);
      return;
    }
    if (node.isInline && node.isLeaf) {
      for (const ch of leafText(node)) push(ch, pos, pos + node.nodeSize);
      return;
    }
    // A new textblock reads as a space after the one before it.
    if (node.isTextblock) push(" ", pos, pos);
    node.forEach((child, offset) => visit(child, pos + 1 + offset));
  };
  visit(block, blockPos);
  // The leading space a first textblock adds is never part of a quote.
  if (chars[0] === " ") {
    chars.shift();
    from.shift();
    to.shift();
  }
  return { text: chars.join(""), from, to };
}

export type ThreadRange = { kind: "text" | "block"; from: number; to: number };

/** Where a thread's highlight goes in `doc`, or null when its block isn't there. */
export function locateThread(doc: PMNode, thread: Pick<ThreadAnchor, "blockId" | "quote">, leafText: LeafText): ThreadRange | null {
  const block = findBlock(doc, thread.blockId);
  if (!block) return null;
  const quote = normalizeQuote(thread.quote);
  if (quote) {
    const index = textIndex(block.node, block.pos, leafText);
    const at = index.text.indexOf(quote);
    if (at >= 0) return { kind: "text", from: index.from[at], to: index.to[at + quote.length - 1] };
  }
  return { kind: "block", from: block.pos, to: block.pos + block.node.nodeSize };
}

/** The text runs of [from, to] (chips and other atoms left out), adjacent text nodes merged. */
export function textSegments(doc: PMNode, from: number, to: number): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a >= b) return false;
    const last = segments[segments.length - 1];
    if (last && last[1] === a) last[1] = b;
    else segments.push([a, b]);
    return false;
  });
  return segments;
}

/**
 * What a comment on the current selection would anchor to: text selected inside one top-level
 * block (a drag that runs on into the start of the next block, taking no text from it, still
 * counts), with something to quote. Null for a caret, a selected chip or block, a table cell
 * selection, select-all, or text across blocks.
 */
export function commentTarget(state: EditorState, leafText: LeafText): Required<CommentRequest> | null {
  const { selection, doc } = state;
  if (selection.empty || !(selection instanceof TextSelection)) return null;
  const { $from } = selection;
  if ($from.depth < 1) return null;
  const blockPos = $from.before(1);
  const block = doc.child($from.index(0));
  const blockEnd = blockPos + block.nodeSize;
  const blockId = block.attrs.id as string | null | undefined;
  if (!blockId) return null;
  const from = selection.from;
  let to = selection.to;
  if (to > blockEnd) {
    if (doc.textBetween(blockEnd, to, " ", leafText).trim()) return null;
    to = blockEnd;
  }
  const index = textIndex(block, blockPos, leafText);
  let start = 0;
  while (start < index.text.length && index.from[start] < from) start++;
  let end = start;
  while (end < index.text.length && index.to[end] <= to) end++;
  const quote = normalizeQuote(index.text.slice(start, end));
  return quote ? { blockId, quote } : null;
}

/** The top-level block a position sits in, as a block-level comment request. */
export function blockRequestAt(state: EditorState, pos: number): CommentRequest | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  if ($pos.depth < 1) return null;
  const blockId = $pos.node(1).attrs.id as string | null | undefined;
  return blockId ? { blockId } : null;
}
