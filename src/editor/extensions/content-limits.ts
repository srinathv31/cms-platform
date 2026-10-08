// The editor's side of the content limits (docs/render-spec.md §2 "Limits", §3):
//   • paste and drop: the pasted slice goes through the save normalization (model/normalize.ts), so
//     the editor holds what every channel will show (tabs as spaces, headings ≤ 3, no cell widths or
//     alignment, cells holding paragraphs and lists, wide tables split, links checked);
//   • Tab in a list doesn't nest past MAX_LIST_DEPTH (9) levels;
//   • inside a table cell, at any depth (a list in a cell included), `---` and `#`–`###` typed at the
//     start of a line stay text and Mod-Alt-1 to 3 do nothing: a cell holds paragraphs and lists only;
//   • `tableColumnsAt` / `canAddColumn` for the table menu, which disables "Insert column" at 12;
//   • after every change, a heading, rule, callout or table that a drop (or any other change) left in
//     a list inside a table cell is converted at once, as the save converts it (`cellBlocks`), so the
//     screen always shows what will be stored and rendered.
// The schema keeps a cell's own children to paragraphs and lists (schema.ts), but a list item may
// hold any block, so inside a cell's list it's up to this extension, the `/` menu (block-items.ts)
// and paste (normalizeSlice). The document check (src/server/render/schema-check.ts) refuses
// whatever still breaks a limit at save.

import { Extension, type KeyboardShortcutCommand } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { DOCUMENT_MESSAGES } from "../model/document-check";
import { MAX_LIST_DEPTH } from "../model/list-markers";
import { CELL_BLOCKS, HEADING_LEVELS, MAX_HEADING_LEVEL, cellBlocks, normalizeFragment } from "../model/normalize";
import { MAX_TABLE_COLUMNS } from "../model/table-grid";
import type { JSONContent } from "../model/types";

/** Shown where "Insert column" is disabled, and by the document check. */
export const TABLE_COLUMNS_MESSAGE = DOCUMENT_MESSAGES.tableColumns;

export interface ContentLimitsOptions {
  /** A one-line field (email subject, preheader): breaks become spaces, marks go. */
  field: boolean;
}

export const contentLimitsKey = new PluginKey("contentLimits");

const LISTS = new Set(["bulletList", "orderedList"]);

/** How deep the open edge of a fragment goes on one side (how far a slice can be open there). */
function edgeDepth(fragment: Fragment, side: "first" | "last"): number {
  let depth = 0;
  for (let node = fragment[side === "first" ? "firstChild" : "lastChild"]; node && !node.isLeaf; depth++) {
    node = side === "first" ? node.firstChild : node.lastChild;
  }
  return depth;
}

const isCell = (node: PMNode) => String(node.type.spec.tableRole ?? "").includes("cell");

/** Whether `$pos` is inside a table cell, at any depth. */
export function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) if (isCell($pos.node(d))) return true;
  return false;
}

/**
 * The blocks inside table cells, in the part of `doc` that changed since `before`, that a cell can't
 * hold (a heading, rule, callout or table in a list item there; the schema keeps them out of the
 * cell's own children). Outermost first, in document order; what's inside one is converted with it.
 */
function blocksCellsCantHold(before: PMNode, doc: PMNode): { node: PMNode; pos: number }[] {
  const start = before.content.findDiffStart(doc.content);
  if (start === null) return [];
  const end = before.content.findDiffEnd(doc.content);
  const from = Math.min(start, end?.b ?? start);
  const to = Math.max(start, end?.b ?? start);
  const found: { node: PMNode; pos: number }[] = [];
  doc.nodesBetween(from, Math.min(Math.max(to, from + 1), doc.content.size), (node, pos) => {
    if (node.isTextblock || node.isLeaf) return false;
    if (!isCell(node)) return true;
    node.descendants((child, offset) => {
      if (child.isTextblock || child.isLeaf) {
        if (CELL_BLOCKS.includes(child.type.name)) return false;
      } else if (CELL_BLOCKS.includes(child.type.name) || child.type.name === "listItem") {
        return true;
      }
      found.push({ node: child, pos: pos + 1 + offset });
      return false;
    });
    return false;
  });
  return found;
}

/**
 * A transaction converting every block a cell can't hold (`blocksCellsCantHold`) into what the save
 * stores (`cellBlocks`); null when there is none, or when a conversion doesn't fit the schema.
 */
function cellGuard(before: PMNode, state: EditorState): Transaction | null {
  const found = blocksCellsCantHold(before, state.doc);
  if (!found.length) return null;
  const tr = state.tr;
  try {
    for (const { node, pos } of found.reverse()) {
      tr.replaceWith(pos, pos + node.nodeSize, Fragment.fromJSON(state.schema, cellBlocks(node.toJSON() as JSONContent)));
    }
    tr.doc.check();
  } catch {
    return null; // the document check refuses it at save, with a message
  }
  return tr;
}

/**
 * A pasted slice, normalized like a saved document (and, landing in a table cell, like a cell's
 * content). Returns the slice unchanged if it can't be rebuilt.
 */
export function normalizeSlice(slice: Slice, schema: Schema, field = false, inCell = false): Slice {
  if (slice.content.size === 0) return slice;
  const json = slice.content.toJSON() as JSONContent[];
  const nodes = normalizeFragment(json, { openStart: slice.openStart, openEnd: slice.openEnd }, field, inCell);
  try {
    const content = Fragment.fromJSON(schema, nodes);
    if (content.size === 0) return Slice.empty;
    if (edgeDepth(content, "first") < slice.openStart || edgeDepth(content, "last") < slice.openEnd) return slice;
    return new Slice(content, slice.openStart, slice.openEnd);
  } catch {
    return slice;
  }
}

/** The table around the selection: its node and width. Null outside a table. */
export function tableAround(state: EditorState): { node: PMNode; pos: number; columns: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.spec.tableRole === "table") return { node, pos: $from.before(d), columns: TableMap.get(node).width };
  }
  return null;
}

/** Columns of the table around the selection, or null. */
export function tableColumnsAt(state: EditorState): number | null {
  return tableAround(state)?.columns ?? null;
}

/** Whether the table around the selection may take another column (fewer than 12 now). */
export function canAddColumn(state: EditorState): boolean {
  const columns = tableColumnsAt(state);
  return columns !== null && columns < MAX_TABLE_COLUMNS;
}

/** List levels in `node`'s subtree, counting `node` itself when it is a list. */
function listLevels(node: PMNode): number {
  let deepest = 0;
  node.forEach((child) => {
    if (!child.isTextblock && !child.isLeaf) deepest = Math.max(deepest, listLevels(child));
  });
  return deepest + (LISTS.has(node.type.name) ? 1 : 0);
}

/** Whether nesting the selected list items one level deeper (Tab) would pass MAX_LIST_DEPTH. */
export function sinkPassesLimit(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const item = state.schema.nodes.listItem;
  if (!item) return false;
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild?.type === item);
  if (!range) return false;
  let level = 0; // the list the items are in, and its list ancestors
  for (let d = range.depth; d >= 0; d--) if (LISTS.has(range.$from.node(d).type.name)) level++;
  let inner = 0;
  for (let i = range.startIndex; i < range.endIndex; i++) inner = Math.max(inner, listLevels(range.parent.child(i)));
  return level + 1 + inner > MAX_LIST_DEPTH;
}

/**
 * The Markdown shortcuts (TipTap's input rules) for blocks a cell can't hold, when they are the
 * whole line: a horizontal rule, and a heading of the levels the editor offers.
 */
const CELL_BLOCKED_SHORTCUT = new RegExp(`^(?:---|—-|___\\s|\\*\\*\\*\\s|#{1,${MAX_HEADING_LEVEL}}\\s)$`);

/**
 * Whether typing `text` at `from` would turn a line inside a table cell (in the cell itself, or in a
 * list in it) into a rule or a heading. A cell holds paragraphs and lists only, at every depth; the
 * characters are typed as text instead.
 */
function completesBlockedShortcutInCell(state: EditorState, from: number, text: string): boolean {
  const $from = state.doc.resolve(from);
  if (!inTableCell($from)) return false;
  return CELL_BLOCKED_SHORTCUT.test($from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc") + text);
}

export const ContentLimits = Extension.create<ContentLimitsOptions>({
  name: "contentLimits",
  // Ahead of the list item's own Tab (sinkListItem).
  priority: 1000,

  addOptions() {
    return { field: false };
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    if (this.options.field) return {};
    // In a cell, the heading shortcuts do nothing (as they do in a cell's own paragraphs, where the
    // schema refuses a heading); elsewhere they fall through to the heading's own.
    const headings = Object.fromEntries(
      HEADING_LEVELS.map((level) => [`Mod-Alt-${level}`, () => inTableCell(this.editor.state.selection.$from)]),
    );
    // At the limit, Tab does nothing in a list (as Word does at its ninth level); elsewhere it falls through.
    return {
      ...headings,
      Tab: () =>
        this.editor.isActive("listItem") && sinkPassesLimit(this.editor.state) && this.editor.can().sinkListItem("listItem"),
    };
  },

  addProseMirrorPlugins() {
    const { field } = this.options;
    return [
      new Plugin({
        key: contentLimitsKey,
        // A drop, or any other change, that leaves a heading, rule, callout or table in a list inside a
        // cell: converted in the same undo step, as the save would.
        appendTransaction: (transactions, oldState, state) =>
          field || !transactions.some((tr) => tr.docChanged) ? null : cellGuard(oldState.doc, state),
        props: {
          transformPasted: (slice, view) => normalizeSlice(slice, view.state.schema, field, !field && inTableCell(view.state.selection.$from)),
          // Ahead of the rule's and the heading's own input rules (this extension's plugins come first).
          handleTextInput: (view, from, to, text) => {
            if (field || !completesBlockedShortcutInCell(view.state, from, text)) return false;
            view.dispatch(view.state.tr.insertText(text, from, to));
            return true;
          },
        },
      }),
    ];
  },
});
