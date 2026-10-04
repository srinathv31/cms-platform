// Alt+Shift+↑ / ↓ moves the current block (the selected blocks, or the current list item within its
// list) one step up or down, keeping the caret. Blocks move freely across section boundaries; a
// required heading itself never moves (the guard's note explains). One undo step per move.
//
// The move swaps the selected range with its neighbour by moving the neighbour to the other side,
// so the caret's own positions only shift, never jump.

import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { flashRequiredNote, isRequiredHeading, REQUIRED_KEY_ATTR } from "./required-sections";

export type MoveDirection = "up" | "down";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockMove: {
      /** Moves the current block (or list item) up or down one place. */
      moveBlock: (direction: MoveDirection) => ReturnType;
    };
  }
}

export type MoveResult = { tr: Transaction } | { blocked: string } | null;

interface Span {
  /** Depth of the container whose children move (0 = the document). */
  depth: number;
  container: PMNode;
  /** Start of the container's content. */
  start: number;
  first: number;
  last: number;
}

function listItemSpan(state: EditorState): Span | null {
  const { $from, $to } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "listItem") continue;
    if ($to.pos > $from.end(d)) return null; // the selection leaves the item
    return { depth: d - 1, container: $from.node(d - 1), start: $from.start(d - 1), first: $from.index(d - 1), last: $from.index(d - 1) };
  }
  return null;
}

function topLevelSpan(state: EditorState): Span {
  const { $from, $to } = state.selection;
  const first = $from.index(0);
  // A selection ending right at a block boundary doesn't include the next block.
  const last = Math.max(first, $to.depth === 0 ? $to.index(0) - 1 : $to.index(0));
  return { depth: 0, container: state.doc, start: 0, first, last };
}

function childPos(span: Span, index: number): number {
  let pos = span.start;
  for (let i = 0; i < index; i++) pos += span.container.child(i).nodeSize;
  return pos;
}

function moveSpan(state: EditorState, span: Span, direction: MoveDirection): Transaction | null {
  const neighbourIndex = direction === "up" ? span.first - 1 : span.last + 1;
  if (neighbourIndex < 0 || neighbourIndex >= span.container.childCount) return null;
  const neighbour = span.container.child(neighbourIndex);
  const neighbourPos = childPos(span, neighbourIndex);
  const rangeFrom = childPos(span, span.first);
  const rangeTo = childPos(span, span.last + 1);

  // The selection maps through both steps on its own: it only shifts by the neighbour's size.
  const tr = state.tr;
  tr.delete(neighbourPos, neighbourPos + neighbour.nodeSize);
  if (direction === "up") tr.insert(rangeTo - neighbour.nodeSize, neighbour); // [n][range] → [range][n]
  else tr.insert(rangeFrom, neighbour); // [range][n] → [n][range]
  return closeHistory(tr).scrollIntoView();
}

/** The move for the current selection: a transaction, a required heading in the way, or nothing to do. */
export function blockMove(state: EditorState, direction: MoveDirection): MoveResult {
  const item = listItemSpan(state);
  if (item) {
    const tr = moveSpan(state, item, direction);
    if (tr) return { tr };
    // At the edge of its list: the whole list moves.
  }
  const span = topLevelSpan(state);
  for (let i = span.first; i <= span.last; i++) {
    const node = state.doc.child(i);
    if (isRequiredHeading(node)) return { blocked: node.attrs[REQUIRED_KEY_ATTR] as string };
  }
  const tr = moveSpan(state, span, direction);
  return tr ? { tr } : null;
}

export const BlockMove = Extension.create({
  name: "blockMove",

  addCommands() {
    return {
      moveBlock:
        (direction) =>
        ({ state, dispatch, view }) => {
          const result = blockMove(state, direction);
          if (!result) return false;
          if ("blocked" in result) {
            if (dispatch) flashRequiredNote(view, result.blocked);
            return true;
          }
          dispatch?.(result.tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Alt-Shift-ArrowUp": () => this.editor.commands.moveBlock("up"),
      "Alt-Shift-ArrowDown": () => this.editor.commands.moveBlock("down"),
    };
  },
});
