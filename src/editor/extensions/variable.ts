// The `variable` node: an inline, atomic chip that holds only a key.
// Built by extending TipTap's Mention (inline atom + Suggestion trigger + chip-aware Backspace).
// Label and type are never stored on the node: they come from the variable list through `lookup`.
//
// JSON: { type: "variable", attrs: { key: "first_name" } }
// HTML: <span data-variable="first_name">First name</span>
// Text: {{first_name}}   (plain-text copy, and the syntax the importer turns back into chips)
//
// Deleting: Backspace right after a chip and Delete right before one remove the whole chip
// (Mention's Backspace with `deleteTriggerWithBackspace`, which inserts nothing in its place, so
// the two-character `{{` trigger never comes back as text). A selected chip goes with either key.
// Typing `{{first_name}}` in full turns into the chip when the key is in the list.

import { InputRule, mergeAttributes, type Range } from "@tiptap/core";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";
import type { Node as PMNode, ResolvedPos, Schema } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { NODE, type Variable as VariableModel } from "../model/types";
import type { VariableStore } from "../state/variable-store";
import type { PickerItem } from "./variable-picker";

export interface VariableOptions extends MentionOptions<PickerItem, PickerItem> {
  /** Resolves a key to its variable. Server: from a static list. Client: from the root's store. */
  lookup: (key: string) => VariableModel | undefined;
  /** Client only: the variable store, read by the chip NodeView. */
  store: VariableStore | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    variable: {
      /**
       * Inserts a chip for `key` over `range` (default: the selection; a selected node is kept and
       * the chip goes after it). Adds a space where the chip would touch a word. One undo step.
       */
      insertVariable: (key: string, range?: Range) => ReturnType;
    };
  }
}

const VARIABLE_TEXT = (key: string | null) => `{{${key ?? ""}}}`;

/** `{{key}}` typed in full (spaces inside the braces allowed). */
const TYPED_KEY = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/;

export const Variable = Mention.extend<VariableOptions>({
  name: NODE.variable,

  // Selectable so a click or arrow key lands a NodeSelection on the chip (ring + popover).
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      ...this.parent!(),
      lookup: () => undefined,
      store: null,
      // Backspace after a chip removes the whole chip and leaves nothing behind.
      deleteTriggerWithBackspace: true,
      // The client supplies `items`, `render` and the rest of the `{{` picker (schema.ts).
      suggestion: { char: "{{" },
    };
  },

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-variable"),
        renderHTML: (attributes) => (attributes.key ? { "data-variable": attributes.key } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const key = node.attrs.key as string | null;
    const label = (key && this.options.lookup(key)?.label) || key || "";
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), label];
  },

  renderText({ node }) {
    return VARIABLE_TEXT(node.attrs.key);
  },

  addCommands() {
    return {
      insertVariable:
        (key, range) =>
        ({ tr, dispatch }) => {
          if (!key) return false;
          if (dispatch) {
            insertChip(tr.doc.type.schema, tr, this.name, key, range);
            closeHistory(tr);
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Delete right before a chip removes the whole chip.
      Delete: () =>
        this.editor.commands.command(({ tr }) => {
          const { selection } = tr;
          if (!selection.empty) return false;
          const after = selection.$from.nodeAfter;
          if (after?.type.name !== this.name) return false;
          tr.delete(selection.from, selection.from + after.nodeSize);
          return true;
        }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: TYPED_KEY,
        handler: ({ state, range, match }) => {
          const key = match[1];
          if (!key || !this.options.lookup(key)) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ key }));
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    // The `{{` picker runs only when a renderer is configured (client, editable).
    if (!this.options.suggestion?.render) return [];
    return this.parent?.() ?? [];
  },
});

// ── Insertion ────────────────────────────────────────────────────

/**
 * A chip gets a space only where it would otherwise touch a word: before it when the previous
 * character is a letter or digit, after it when the next one is. Never before punctuation or a space,
 * and never at either end of a line, so typing "," or " until " right after a chip reads naturally.
 * An adjacent chip counts as a word.
 */
const WORD_BEFORE = /[\p{L}\p{N}]$/u;
const WORD_AFTER = /^[\p{L}\p{N}]/u;

function insertChip(schema: Schema, tr: Transaction, typeName: string, key: string, range?: Range) {
  const type = schema.nodes[typeName];
  let { from, to } = range ?? tr.selection;
  // A selected node (another chip, a divider) stays: the chip goes after it.
  if (!range && !(tr.selection instanceof TextSelection)) from = to = tr.selection.to;

  const $from = tr.doc.resolve(from);
  const $to = tr.doc.resolve(to);
  const marks = $from.marks();
  const chip = type.create({ key }, null, marks);

  if ($from.parent.inlineContent && $from.sameParent($to) && $from.parent.type.contentMatch.matchType(type)) {
    const lead = wantsSpace($from, "before", typeName) ? schema.text(" ", marks) : null;
    const trail = wantsSpace($to, "after", typeName) ? schema.text(" ", marks) : null;
    const nodes = [lead, chip, trail].filter((n): n is PMNode => n !== null);
    tr.replaceWith(from, to, nodes);
    // The caret lands right after the chip.
    tr.setSelection(TextSelection.create(tr.doc, from + (lead ? lead.nodeSize : 0) + chip.nodeSize));
    return;
  }

  // Between blocks (a gap cursor, a dropped chip beside a table…): the chip gets its own line.
  tr.replaceRangeWith(from, to, chip);
  let end = from;
  tr.mapping.maps[tr.mapping.maps.length - 1]?.forEach((_from, _to, _newFrom, newTo) => {
    end = newTo;
  });
  tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
}

function wantsSpace($pos: ResolvedPos, side: "before" | "after", typeName: string): boolean {
  const node = side === "before" ? $pos.nodeBefore : $pos.nodeAfter;
  if (!node) return false;
  if (node.type.name === typeName) return true;
  if (!node.isText || !node.text) return false;
  return side === "before" ? WORD_BEFORE.test(node.text) : WORD_AFTER.test(node.text);
}
