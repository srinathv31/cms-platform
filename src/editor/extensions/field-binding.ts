// Binds one editor (the document body, or an inline field) to its <EditorRoot>:
//   • usage: tells the root when the document changed (counted on the next frame)
//   • focus: the root remembers the last-focused field for click-to-insert
//   • drop:  a variable dragged from the panel (our own MIME type) lands as a chip, one transaction
//   • chips: click, or Enter/Space on a selected chip, opens its popover; Esc closes it
//   • paste: Word / Google Docs / web HTML is normalized (paste/normalize-html.ts) and `{{key}}` in
//     pasted or dropped text becomes chips; a key the list doesn't have is created as an optional
//     Text variable (or comes back from its tombstone), in the same step
//   • consistency: a chip that comes back with a renamed key is re-pointed at the current key, and
//     a chip that undo/redo brings back for a deleted variable restores the variable
// No React here; the popover and panel subscribe to the stores this writes.

import { Extension, type KeyboardShortcutCommand } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { AttrStep, ReplaceAroundStep, ReplaceStep, dropPoint, type Step } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { NODE } from "../model/types";
import { labelFromKey } from "../model/variables";
import { chipsFromText } from "../paste/chips";
import { normalizePastedHtml } from "../paste/normalize-html";
import type { ChipPopoverStore } from "../state/chip-popover";
import type { EditorRootRuntime, FieldKind } from "../state/editor-root";

/** The drag payload of a panel row: the variable's key. */
export const VARIABLE_DRAG_TYPE = "application/x-ucomp-variable";

export interface FieldBinding {
  fieldId: string;
  kind: FieldKind;
  root: EditorRootRuntime;
  chip: ChipPopoverStore;
}

export interface FieldBindingOptions {
  binding: FieldBinding | null;
}

export const fieldBindingPluginKey = new PluginKey("fieldBinding");

export const FieldBindingExtension = Extension.create<FieldBindingOptions>({
  name: "fieldBinding",

  addOptions() {
    return { binding: null };
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    const { binding } = this.options;
    if (!binding) return {};
    const toggle = () => {
      const pos = selectedChipPos(this.editor.state);
      if (pos === null) return false;
      const popover = binding.chip.getState();
      if (popover.pos === pos) popover.close();
      else popover.open(pos);
      return true;
    };
    return {
      Enter: toggle,
      Space: toggle,
      Escape: () => {
        const popover = binding.chip.getState();
        if (popover.pos === null) return false;
        popover.close();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const { binding } = this.options;
    if (!binding) return [];
    const { root, fieldId, chip } = binding;
    const editor = this.editor;

    return [
      new Plugin({
        key: fieldBindingPluginKey,

        props: {
          transformPastedHTML: (html) => normalizePastedHtml(html),
          transformPasted: (slice, view) => chipsFromText(slice, view.state.schema),

          handleDrop: (view, event) => {
            const key = event.dataTransfer?.getData(VARIABLE_DRAG_TYPE);
            if (!key) return false;
            if (!view.editable) return true;
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!hit) return true;
            const node = view.state.schema.nodes[NODE.variable].create({ key });
            const at = dropPoint(view.state.doc, hit.pos, new Slice(Fragment.from(node), 0, 0)) ?? hit.pos;
            editor.chain().insertVariable(key, { from: at, to: at }).focus(undefined, { scrollIntoView: false }).run();
            return true;
          },

          handleClickOn: (_view, _pos, node, nodePos, _event, direct) => {
            if (direct && node.type.name === NODE.variable) chip.getState().open(nodePos);
            return false; // ProseMirror still selects the chip
          },

          handleDOMEvents: {
            focus: () => {
              root.attachEditor(fieldId, editor);
              root.noteFocus(fieldId);
              return false;
            },
            blur: (_view, event) => {
              const next = event.relatedTarget;
              const { pos, element } = chip.getState();
              if (pos !== null && !(next instanceof Node && element?.contains(next))) chip.getState().close();
              return false;
            },
          },
        },

        appendTransaction: (transactions, _oldState, state) => consistency(transactions, state, root),

        view: (view) => {
          root.attachEditor(fieldId, editor);
          root.noteDoc(fieldId, view.state.doc, true);
          return {
            update: (next: EditorView, prev: EditorState) => {
              if (next.state.doc !== prev.doc) {
                // Re-attach in case the field re-registered around this editor (a hidden route shown again).
                root.attachEditor(fieldId, editor);
                root.noteDoc(fieldId, next.state.doc);
              }
              if (next.state.selection !== prev.selection) followSelection(next.state, chip);
            },
            destroy: () => {
              // The view is going (destroy, or a hidden route torn down): nothing anchors a popover.
              chip.getState().close();
              root.detachEditor(fieldId, editor);
            },
          };
        },
      }),
    ];
  },
});

function selectedChipPos(state: EditorState): number | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === NODE.variable ? selection.from : null;
}

/** The popover stays on the selected chip (and follows it); anything else closes it. */
function followSelection(state: EditorState, chip: ChipPopoverStore) {
  const popover = chip.getState();
  if (popover.pos === null) return;
  const pos = selectedChipPos(state);
  if (pos === null) popover.close();
  else popover.open(pos);
}

function consistency(transactions: readonly Transaction[], state: EditorState, root: EditorRootRuntime): Transaction | null {
  const { byKey, forwards, tombstones } = root.variables.getState();
  let forward = false;
  let restore: Set<string> | null = null;
  let create: Set<string> | null = null;

  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    const history = isHistoryTransaction(tr);
    const uiEvent = tr.getMeta("uiEvent") as string | undefined;
    const pasted = uiEvent === "paste" || uiEvent === "drop";
    for (const step of tr.steps) {
      eachInsertedKey(step, (key) => {
        if (byKey.has(key)) return;
        const target = forwards[key];
        if (target && byKey.has(target)) forward = true;
        else if ((history || pasted) && tombstones.has(key)) (restore ??= new Set()).add(key);
        else if (pasted) (create ??= new Set()).add(key);
      });
    }
  }

  if (restore || create) {
    const restoring = [...(restore ?? [])];
    const creating = [...(create ?? [])];
    // After this dispatch settles: the store update re-renders the panel and chips.
    queueMicrotask(() => {
      restoring.forEach((key) => root.restoreVariable(key));
      // Optional, so a paste never silently adds a breaking change to the contract.
      creating.forEach((key) => root.createVariable({ key, label: labelFromKey(key), type: "text", required: false, sample: "" }));
    });
  }
  if (!forward) return null;

  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== NODE.variable) return !node.isText;
    const key = node.attrs.key as string | null;
    const target = key && !byKey.has(key) ? forwards[key] : undefined;
    if (target && byKey.has(target)) tr.setNodeAttribute(pos, "key", target);
    return false;
  });
  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

/** Keys of the chips a step puts into the document (typing never contains any, so this is cheap). */
function eachInsertedKey(step: Step, visit: (key: string) => void) {
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    step.slice.content.descendants((node) => {
      if (node.type.name === NODE.variable) {
        if (typeof node.attrs.key === "string") visit(node.attrs.key);
        return false;
      }
      return !node.isText;
    });
  } else if (step instanceof AttrStep && step.attr === "key" && typeof step.value === "string") {
    visit(step.value);
  }
}
