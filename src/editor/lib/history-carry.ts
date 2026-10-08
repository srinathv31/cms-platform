// Undo history that survives the editor being rebuilt. Next keeps a hidden route alive in
// <Activity> but runs its effect cleanups, so a field's editor is destroyed when its tab is hidden
// and a new one is made from the latest document when it shows again (document-editor.tsx). The
// new editor has its own schema and plugins, so the old history can't be handed over as it is.
//
// Instead, before the old editor goes, `captureHistory` walks its history on a copy of the state
// and keeps the document each undo (and each redo) leads to. `restoreHistory` replays those
// documents into the new editor's history, one event per document, so ⌘Z and the undo button
// step back through the same states. The steps are coarser than the originals (one replace per
// event, of the range that differs) but each lands on the same document. Plain ProseMirror; no
// React.

import { closeHistory, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Command, type Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface HistoryCarry {
  /** The document when the history was captured. */
  doc: PMNode;
  /** What each undo leads to, nearest first. */
  back: PMNode[];
  /** What each redo leads to, nearest first. */
  forward: PMNode[];
}

/** The undo history plugin (its key is "history$"; the module doesn't export it). */
function historyPlugin(state: EditorState): Plugin | undefined {
  return state.plugins.find((plugin) => (plugin as unknown as { key: string }).key.startsWith("history$"));
}

/** The documents `command` steps through until it has nothing left, on `state` (no side effects). */
function walk(state: EditorState, command: Command, depth: (state: EditorState) => number): PMNode[] {
  const docs: PMNode[] = [];
  let current = state;
  while (depth(current) > 0) {
    let next = null as EditorState | null;
    command(current, (tr) => {
      next = current.apply(tr);
    });
    if (!next) break;
    current = next;
    docs.push(current.doc);
  }
  return docs;
}

/** The documents this state's history leads back and forward to; null when there is no history. */
export function captureHistory(state: EditorState): HistoryCarry | null {
  const plugin = historyPlugin(state);
  if (!plugin) return null;
  // Only the history plugin: the walk must not run anything else's appendTransaction (the field
  // binding restores deleted variables when undo brings their chips back).
  const lean = state.reconfigure({ plugins: [plugin] });
  if (undoDepth(lean) === 0 && redoDepth(lean) === 0) return null;
  return { doc: state.doc, back: walk(lean, undo, undoDepth), forward: walk(lean, redo, redoDepth) };
}

/** `state` changed into `target` as one history event, its selection at the change (where undo puts the caret). */
function stepTo(state: EditorState, target: PMNode): EditorState | null {
  const start = state.doc.content.findDiffStart(target.content);
  if (start === null) return null;
  const end = state.doc.content.findDiffEnd(target.content);
  if (!end) return null;
  let { a: endA, b: endB } = end;
  // Repeated content can make the two ends cross the start: push them past it.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const at = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(start))));
  let tr = at.tr.replace(start, endA, target.slice(start, endB));
  // The slice may not fit back exactly where it came from: then the whole document is the step.
  if (!tr.doc.eq(target)) tr = at.tr.replaceWith(0, at.doc.content.size, target.content);
  return at.apply(closeHistory(tr));
}

/**
 * Rebuilds `carry` as the history of the editor in `view`, when its document is the one the carry
 * was captured at. Returns whether it did. Not an edit: the document doesn't change.
 */
export function restoreHistory(view: EditorView, carry: HistoryCarry): boolean {
  try {
    return rebuild(view, carry);
  } catch {
    // A step that doesn't apply to the new schema: the editor just starts without history, as before.
    return false;
  }
}

function rebuild(view: EditorView, carry: HistoryCarry): boolean {
  const { state } = view;
  const plugin = historyPlugin(state);
  if (!plugin) return false;
  const { schema } = state;
  // The new editor has its own schema: bring each document over.
  const convert = (doc: PMNode) => schema.nodeFromJSON(doc.toJSON());
  if (!convert(carry.doc).eq(state.doc)) return false;

  // Oldest first: back to front, then the current document, then what redo goes forward to.
  const chain = [...carry.back.map(convert).reverse(), state.doc, ...carry.forward.map(convert)];
  let lean = EditorState.create({ schema, doc: chain[0], plugins: [plugin] });
  for (const doc of chain.slice(1)) {
    const next = stepTo(lean, doc);
    if (!next) return false;
    lean = next;
  }
  // Undo the redo part again, so it waits on the redo side.
  for (let i = 0; i < carry.forward.length; i++) {
    if (!undo(lean, (tr) => (lean = lean.apply(tr)))) return false;
  }
  if (!lean.doc.eq(state.doc) || undoDepth(lean) !== carry.back.length || redoDepth(lean) !== carry.forward.length) return false;

  // The history plugin takes a transaction carrying `{ historyState }` under its key as its new state.
  view.dispatch(state.tr.setMeta(plugin, { historyState: plugin.getState(lean) }).setMeta("addToHistory", false));
  return true;
}
