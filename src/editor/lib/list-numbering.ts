// The block menu's numbering: which numbered list it acts on, what each style looks like, and the
// two edits (style, start). Pure ProseMirror; the menu itself is components/block-menu.tsx.
//
// Target: the numbered list the caret is in, when the caret is inside the block the menu was
// opened for (so a nested list is reached by putting the caret in it); otherwise the block itself
// when it is a numbered list, else the first numbered list inside it (a numbered list nested in a
// bulleted list, or in a table).
// Edits write `markerFormat` / `markerDelimiter` / `start` on that orderedList node, each as one
// undo step of its own; the host autosaves them like any edit (they change the document).

import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { listStart, orderedDepthAt, storedNumbering } from "../extensions/list-markers";
import {
  NUMBERING_STYLES,
  ORDERED_LIST_ATTRS,
  formatMarker,
  isListStart,
  resolveNumbering,
  type NumberingStyle,
} from "../model/list-markers";

export interface NumberingTarget {
  /** The orderedList's position. */
  pos: number;
  node: PMNode;
  /** orderedList ancestors (0 for a list that isn't inside another numbered list). */
  orderedDepth: number;
}

function target(doc: PMNode, pos: number): NumberingTarget | null {
  const node = doc.nodeAt(pos);
  return node?.type.name === "orderedList" ? { pos, node, orderedDepth: orderedDepthAt(doc, pos) } : null;
}

/** The innermost numbered list around the caret, or null. With `stopAtTable`, null when a table is nearer. */
function listAround(state: EditorState, stopAtTable: boolean): NumberingTarget | null {
  const { $head } = state.selection;
  for (let d = $head.depth; d > 0; d--) {
    const name = $head.node(d).type.name;
    if (name === "orderedList") return target(state.doc, $head.before(d));
    if (stopAtTable && name === "table") return null;
  }
  return null;
}

/** The numbered list the block menu of the block at `blockPos` acts on, or null when it has none. */
export function numberingTarget(state: EditorState, blockPos: number): NumberingTarget | null {
  const block = state.doc.nodeAt(blockPos);
  if (!block) return null;
  const { head } = state.selection;
  if (head > blockPos && head < blockPos + block.nodeSize) {
    const around = listAround(state, false);
    if (around && around.pos >= blockPos) return around;
  }
  if (block.type.name === "orderedList") return target(state.doc, blockPos);
  let first: number | null = null;
  block.descendants((node, pos) => {
    if (first !== null) return false;
    if (node.type.name === "orderedList") first = blockPos + 1 + pos;
    return first === null && !node.isTextblock;
  });
  return first === null ? null : target(state.doc, first);
}

/**
 * Where the keyboard opens the block menu (Alt+F10): the caret's top-level block, unless the caret
 * is in a table and not in a numbered list inside it (there Alt+F10 is the table control's).
 */
export function keyboardBlockAt(state: EditorState): { blockPos: number; target: NumberingTarget | null } | null {
  const { $head } = state.selection;
  if ($head.depth < 1) return null;
  let inTable = false;
  for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === "table") inTable = true;
  if (inTable && !listAround(state, true)) return null;
  const blockPos = $head.before(1);
  return { blockPos, target: numberingTarget(state, blockPos) };
}

// ── Styles ───────────────────────────────────────────────────────

/** The first three markers of a style, as the menu previews it: "1. 2. 3.", "(a) (b) (c)". */
export function numberingPreview(style: NumberingStyle): string {
  return [1, 2, 3].map((n) => formatMarker(n, style.format, style.delimiter)).join(" ");
}

/** The style a list nobody styled has at this ordered depth (what "Default" means there). */
export function defaultNumbering(orderedDepth: number): NumberingStyle {
  return resolveNumbering(null, null, orderedDepth);
}

/** A menu value for a style: "decimal/period"; "default" for none. */
export function numberingValue(style: NumberingStyle | null): string {
  return style ? `${style.format}/${style.delimiter}` : "default";
}

/** The style the list's menu shows as chosen: "default" when unstyled, a menu style's value, or null (a stored pair the menu doesn't offer). */
export function currentNumberingValue(list: PMNode): string | null {
  const { format, delimiter } = storedNumbering(list);
  if (format === null && delimiter === null) return "default";
  const match = NUMBERING_STYLES.find((s) => s.format === format && s.delimiter === delimiter);
  return match ? numberingValue(match) : null;
}

/** The style a menu value stands for (null: back to the default). */
export function styleFromValue(value: string): NumberingStyle | null {
  return NUMBERING_STYLES.find((s) => numberingValue(s) === value) ?? null;
}

/** The list's first number, as the "Start at" field shows it. */
export { listStart };

/** A "Start at" entry as a number, or null when it isn't one a list can start at (0 to 9999). */
export function parseListStart(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return isListStart(n) ? n : null;
}

// ── Edits ────────────────────────────────────────────────────────

/** Writes attributes on the orderedList at `pos` as one undo step. False when there's nothing to change. */
function writeList(view: EditorView, pos: number, attrs: Record<string, unknown>): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== "orderedList") return false;
  const changed = Object.entries(attrs).filter(([name, value]) => node.attrs[name] !== value);
  if (changed.length === 0) return false;
  let tr = view.state.tr;
  for (const [name, value] of changed) tr = tr.setNodeAttribute(pos, name, value);
  view.dispatch(closeHistory(tr));
  return true;
}

/** Sets the list's numbering style; null clears it back to the default for its depth. */
export function setListNumbering(view: EditorView, pos: number, style: NumberingStyle | null): boolean {
  return writeList(view, pos, {
    [ORDERED_LIST_ATTRS.format]: style?.format ?? null,
    [ORDERED_LIST_ATTRS.delimiter]: style?.delimiter ?? null,
  });
}

/** Sets the list's first number (0 to 9999; anything else is refused). */
export function setListStart(view: EditorView, pos: number, start: number): boolean {
  if (!isListStart(start)) return false;
  return writeList(view, pos, { start });
}
