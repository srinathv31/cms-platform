// The runtime behind one <EditorRoot>: the variable list, the fields that show it (the document
// body and any inline fields), where each variable is used, and the actions that keep chips,
// panel and list in step. Plain TypeScript (no React), so it runs headless in tests.
//
// Fields register themselves; the body is labelled "Document". Usage is recomputed at most once
// per frame, from each field's latest document, and published per key (a panel row re-renders
// only when its own numbers change).
//
// A field the host hides for a while (the email subject while Email is off) stays registered: its
// chips still count and still follow renames and deletes. It just isn't a target: click-to-insert,
// undo and redo pass it by until it shows again.
//
// Undo and redo from outside the fields (a host's buttons) act on the last-focused field, the
// body until one has had focus: the same field ⌘Z would undo in. `history` says whether there is
// anything to undo or redo there. Unlike ⌘Z they leave the scroll position alone: a button pressed
// while reading one part of the document shouldn't carry the page off to wherever the change was.

import type { Editor } from "@tiptap/core";
import { redoDepth, redoNoScroll, undoDepth, undoNoScroll } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_REQUIRED_NOTE } from "../extensions/required-sections";
import { firstRequiredSection } from "../lib/sections";
import { removeChips, rewriteChipKeys } from "../lib/chips";
import type { JSONContent, RequiredSection, Variable } from "../model/types";
import {
  mergeUsage,
  reconcileUsage,
  usageFromDoc,
  usageFromJSON,
  type FieldUsage,
  type VariableUsage,
} from "../model/usage";
import { createVariableStore, type VariableResult, type VariableStore } from "./variable-store";

export type FieldKind = "body" | "inline";

export interface FieldInfo {
  id: string;
  /** "Document" for the body; an inline field's own label ("Email subject"). */
  label: string;
  kind: FieldKind;
}

export const BODY_FIELD_LABEL = "Document";

export interface RootConfig {
  readOnly: boolean;
  baseline: readonly Variable[] | null;
  requiredSections: readonly RequiredSection[];
  /** Shown at a required heading when an edit to it is blocked. */
  requiredNote: string;
}

export interface UsageState {
  byKey: ReadonlyMap<string, VariableUsage>;
  /**
   * True once a field has registered. Before that (e.g. the panel renders ahead of the document
   * in the tree) counts are unknown, not zero: the panel leaves them out instead of muting rows.
   */
  ready: boolean;
}

/** Whether the field undo and redo act on (the last-focused one) has anything to undo or redo. */
export interface HistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
}

export interface RootInit {
  variables: readonly Variable[];
  baseline?: readonly Variable[] | null;
  requiredSections?: readonly RequiredSection[];
  readOnly?: boolean;
  requiredNote?: string;
}

export interface EditorRootRuntime {
  readonly variables: VariableStore;
  readonly usage: StoreApi<UsageState>;
  readonly config: StoreApi<RootConfig>;
  readonly history: StoreApi<HistoryAvailability>;

  // ── Fields ──
  /** Adds a field. `content` seeds its usage before its editor exists (server paint, first frame). */
  registerField: (info: FieldInfo, content?: JSONContent | null) => void;
  unregisterField: (id: string) => void;
  /** The host hid or showed a field. Hidden, it still counts and follows list changes, but nothing targets it. */
  setFieldHidden: (id: string, hidden: boolean) => void;
  attachEditor: (id: string, editor: Editor) => void;
  detachEditor: (id: string, editor: Editor) => void;
  /** A field's document changed. Usage catches up on the next frame (`sync` computes it now). */
  noteDoc: (id: string, doc: PMNode, sync?: boolean) => void;
  /** A field received focus: click-to-insert, undo and redo target it from now on. */
  noteFocus: (id: string) => void;
  /** A field's editor state changed (its history may have): `history` catches up now. */
  noteHistory: (id: string) => void;
  /** Computes pending usage now (tests, and before reading counts synchronously). */
  flushUsage: () => void;

  // ── Variable actions (each keeps chips, panel and list consistent) ──
  createVariable: (variable: Variable, index?: number) => VariableResult;
  /** Any change, including the key: chips are re-pointed in every field, one transaction each. */
  updateVariable: (key: string, patch: Partial<Variable>) => VariableResult;
  /** Deletes a variable. `removeChips` removes its chips too: one undoable transaction per field. */
  deleteVariable: (key: string, options?: { removeChips?: boolean }) => VariableResult;
  restoreVariable: (key: string) => VariableResult;
  /**
   * Inserts a chip where the caret last was in the last-focused field (or `fieldId`), and returns
   * focus there. Before any field has had focus, it goes to the start of the first required
   * section's body.
   */
  insertVariable: (key: string, options?: { fieldId?: string }) => boolean;

  // ── Undo and redo (the last-focused field, else the body) ──
  /** One undo step, as ⌘Z, without scrolling the page to the change. False when there was nothing to undo. */
  undo: () => boolean;
  /** One redo step, as ⇧⌘Z, without scrolling. */
  redo: () => boolean;

  /** Called with the new list after every change (wired to `onVariablesChange`). */
  setListener: (listener: ((variables: Variable[]) => void) | null) => void;
  /** Once the root has rendered, fields that mount later register in an effect, not during render. */
  markCommitted: () => void;
  isCommitted: () => boolean;
  dispose: () => void;
}

interface FieldRecord extends FieldInfo {
  seq: number;
  hidden: boolean;
  editor: Editor | null;
  usage: FieldUsage;
  pendingDoc: PMNode | null;
}

const EMPTY_USAGE: FieldUsage = new Map();
const NO_SECTIONS: readonly RequiredSection[] = [];
const NO_HISTORY: HistoryAvailability = { canUndo: false, canRedo: false };

export function createEditorRootRuntime(init: RootInit): EditorRootRuntime {
  const variables = createVariableStore(init.variables);
  const usage = createStore<UsageState>()(() => ({ byKey: new Map(), ready: false }));
  const config = createStore<RootConfig>()(() => ({
    readOnly: init.readOnly ?? false,
    baseline: init.baseline ?? null,
    requiredSections: init.requiredSections ?? NO_SECTIONS,
    requiredNote: init.requiredNote ?? DEFAULT_REQUIRED_NOTE,
  }));
  const history = createStore<HistoryAvailability>()(() => NO_HISTORY);

  const fields = new Map<string, FieldRecord>();
  let seq = 0;
  let lastFocused: string | null = null;
  let listener: ((variables: Variable[]) => void) | null = null;
  let frame: number | null = null;
  let committed = false;

  const unsubscribe = variables.subscribe((state, prev) => {
    if (state.variables !== prev.variables) listener?.([...state.variables]);
  });

  /** Body first, then inline fields in the order they appeared. */
  const ordered = () =>
    [...fields.values()].sort((a, b) => (a.kind === b.kind ? a.seq - b.seq : a.kind === "body" ? -1 : 1));

  const publish = () => {
    const merged = mergeUsage(ordered().map((f) => ({ label: f.label, usage: f.usage })));
    const { byKey: prev, ready: wasReady } = usage.getState();
    const next = reconcileUsage(prev, merged);
    const ready = fields.size > 0;
    if (next !== prev || ready !== wasReady) usage.setState({ byKey: next, ready });
  };

  const flushUsage = () => {
    cancelFrame();
    let changed = false;
    for (const field of fields.values()) {
      if (!field.pendingDoc) continue;
      const next = usageFromDoc(field.pendingDoc, { sections: field.kind === "body" });
      field.pendingDoc = null;
      if (next !== field.usage) {
        field.usage = next;
        changed = true;
      }
    }
    if (changed) publish();
  };

  const schedule = () => {
    if (frame !== null) return;
    frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => {
            frame = null;
            flushUsage();
          })
        : (setTimeout(() => {
            frame = null;
            flushUsage();
          }, 16) as unknown as number);
  };

  function cancelFrame() {
    if (frame === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    else clearTimeout(frame);
    frame = null;
  }

  const liveEditors = () =>
    ordered()
      .map((f) => f.editor)
      .filter((e): e is Editor => !!e && !e.isDestroyed);

  const pickField = (fieldId?: string): FieldRecord | undefined => {
    if (fieldId) return fields.get(fieldId);
    const last = lastFocused ? fields.get(lastFocused) : undefined;
    if (last?.editor && !last.editor.isDestroyed && !last.hidden) return last;
    const shown = ordered().filter((f) => f.editor && !f.hidden);
    return shown.find((f) => f.kind === "body") ?? shown[0];
  };

  /** The live, editable editor undo and redo act on. */
  const historyEditor = (): Editor | null => {
    const editor = pickField()?.editor;
    return editor && !editor.isDestroyed && editor.isEditable && !config.getState().readOnly ? editor : null;
  };

  const publishHistory = () => {
    const editor = historyEditor();
    const canUndo = !!editor && undoDepth(editor.state) > 0;
    const canRedo = !!editor && redoDepth(editor.state) > 0;
    const prev = history.getState();
    if (prev.canUndo !== canUndo || prev.canRedo !== canRedo) history.setState({ canUndo, canRedo });
  };

  const unsubscribeConfig = config.subscribe((state, prev) => {
    if (state.readOnly !== prev.readOnly) publishHistory();
  });

  const step = (which: "undo" | "redo"): boolean => {
    const editor = historyEditor();
    if (!editor) return false;
    const { view } = editor;
    const done = (which === "undo" ? undoNoScroll : redoNoScroll)(view.state, view.dispatch);
    publishHistory();
    return done;
  };

  const runtime: EditorRootRuntime = {
    variables,
    usage,
    config,
    history,
    markCommitted: () => {
      committed = true;
    },
    isCommitted: () => committed,

    registerField(info, content) {
      const existing = fields.get(info.id);
      if (existing) {
        existing.label = info.label;
        existing.kind = info.kind;
        return;
      }
      fields.set(info.id, {
        ...info,
        seq: seq++,
        hidden: false,
        editor: null,
        usage: content ? usageFromJSON(content, { sections: info.kind === "body" }) : EMPTY_USAGE,
        pendingDoc: null,
      });
      publish();
    },

    unregisterField(id) {
      if (!fields.delete(id)) return;
      if (lastFocused === id) lastFocused = null;
      publish();
      publishHistory();
    },

    setFieldHidden(id, hidden) {
      const field = fields.get(id);
      if (!field || field.hidden === hidden) return;
      field.hidden = hidden;
      // As if it had gone: the next click-to-insert starts over, and undo and redo move to the document.
      if (hidden && lastFocused === id) lastFocused = null;
      publishHistory();
    },

    attachEditor(id, editor) {
      const field = fields.get(id);
      // (Called while the editor's view is still being built, so no isDestroyed check here.)
      if (field) field.editor = editor;
    },

    detachEditor(id, editor) {
      const field = fields.get(id);
      if (field?.editor !== editor) return;
      field.editor = null;
      publishHistory();
    },

    noteDoc(id, doc, sync = false) {
      const field = fields.get(id);
      if (!field) return;
      field.pendingDoc = doc;
      if (sync) flushUsage();
      else schedule();
    },

    noteFocus(id) {
      if (!fields.has(id)) return;
      lastFocused = id;
      publishHistory();
    },

    noteHistory(id) {
      // Only the target's history shows; any other field's changes leave it as it is.
      if (pickField()?.id === id) publishHistory();
    },

    flushUsage,

    createVariable: (variable, index) => variables.getState().create(variable, index),

    updateVariable(key, patch) {
      const result = variables.getState().update(key, patch);
      const nextKey = patch.key;
      if (result.ok && nextKey && nextKey !== key) {
        for (const editor of liveEditors()) {
          const tr = rewriteChipKeys(editor.state, key, nextKey);
          if (tr) editor.view.dispatch(tr);
        }
      }
      return result;
    },

    deleteVariable(key, { removeChips: alsoChips = false } = {}) {
      const result = variables.getState().remove(key);
      if (result.ok && alsoChips) {
        for (const editor of liveEditors()) {
          const tr = removeChips(editor.state, key);
          if (tr) editor.view.dispatch(tr);
        }
      }
      return result;
    },

    restoreVariable: (key) => variables.getState().restore(key),

    insertVariable(key, { fieldId } = {}) {
      if (config.getState().readOnly) return false;
      const field = pickField(fieldId);
      const editor = field?.editor;
      if (!field || !editor || editor.isDestroyed || !editor.isEditable) return false;

      if (lastFocused === null && !fieldId && field.kind === "body") {
        const section = firstRequiredSection(editor.state.doc);
        if (section) {
          const at = section.headingEnd + 1;
          const chain = editor.chain();
          if (!section.hasBody) chain.insertContentAt(section.headingEnd, { type: "paragraph" }, { updateSelection: false });
          return chain.insertVariable(key, { from: at, to: at }).focus(undefined, { scrollIntoView: true }).run();
        }
        return editor.chain().focus("start").insertVariable(key).run();
      }
      return editor.chain().insertVariable(key).focus(undefined, { scrollIntoView: true }).run();
    },

    undo: () => step("undo"),
    redo: () => step("redo"),

    setListener(next) {
      listener = next;
    },

    dispose() {
      cancelFrame();
      unsubscribe();
      unsubscribeConfig();
      listener = null;
      fields.clear();
    },
  };

  return runtime;
}
