// Document transforms on variable chips. Each returns one transaction for one field (or null when
// the field has no matching chip), so the root can apply them field by field.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { NODE } from "../model/types";

/** Every chip of `key`, as [pos, node] in document order. */
export function findChips(doc: PMNode, key: string): Array<{ pos: number; node: PMNode }> {
  const found: Array<{ pos: number; node: PMNode }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === NODE.variable) {
      if (node.attrs.key === key) found.push({ pos, node });
      return false;
    }
    return !node.isText;
  });
  return found;
}

/**
 * Points every chip of `from` at `to` (a key renamed in the panel). Not an undo step: the rename
 * lives in the variable list, and undoing only the chips would strand them on the old key.
 */
export function rewriteChipKeys(state: EditorState, from: string, to: string): Transaction | null {
  const chips = findChips(state.doc, from);
  if (!chips.length) return null;
  const tr = state.tr;
  for (const { pos } of chips) tr.setNodeAttribute(pos, "key", to);
  return tr.setMeta("addToHistory", false);
}

/**
 * Removes every chip of `key` as one undo step. A space left doubled by the removal goes too, so
 * "fee of {{x}} applies" becomes "fee of applies", not "fee of  applies".
 */
export function removeChips(state: EditorState, key: string): Transaction | null {
  const chips = findChips(state.doc, key);
  if (!chips.length) return null;
  const tr = closeHistory(state.tr);
  for (let i = chips.length - 1; i >= 0; i--) {
    const { pos, node } = chips[i];
    const $pos = state.doc.resolve(pos);
    let from = pos;
    const before = $pos.nodeBefore;
    const after = state.doc.resolve(pos + node.nodeSize).nodeAfter;
    const spaceBefore = before?.isText && before.text?.endsWith(" ");
    const nextChar = after?.isText ? (after.text?.[0] ?? "") : after ? "x" : "";
    if (spaceBefore && (nextChar === "" || nextChar === " " || /[.,;:!?)]/.test(nextChar))) from -= 1;
    tr.delete(from, pos + node.nodeSize);
  }
  return tr;
}
