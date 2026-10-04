// The `variable` node: an inline, atomic chip that holds only a key.
// Built by extending TipTap's Mention (inline atom + Suggestion trigger + chip-aware Backspace).
// Label and type are never stored on the node: they come from the variable list through `lookup`.
//
// JSON: { type: "variable", attrs: { key: "first_name" } }
// HTML: <span data-variable="first_name">First name</span>
// Text: {{first_name}}   (plain-text copy, and the syntax the importer turns back into chips)

import { mergeAttributes } from "@tiptap/core";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";
import { NODE, type Variable as VariableModel } from "../model/types";
import type { VariableStore } from "../state/variable-store";

export interface VariableAttrs {
  key: string | null;
  [name: string]: unknown;
}

export interface VariableOptions extends MentionOptions<VariableModel, VariableAttrs> {
  /** Resolves a key to its variable. Server: from a static list. Client: from the editor's store. */
  lookup: (key: string) => VariableModel | undefined;
  /** Client only: the editor's variable store, read by the chip NodeView. */
  store: VariableStore | null;
}

export const VARIABLE_TEXT = (key: string | null) => `{{${key ?? ""}}}`;

export const Variable = Mention.extend<VariableOptions>({
  name: NODE.variable,

  // Selectable so a click or arrow key lands a NodeSelection on the chip (ring + Phase 2 popover).
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      ...this.parent!(),
      lookup: () => undefined,
      store: null,
      // Backspace after a chip removes the whole chip and leaves nothing behind.
      deleteTriggerWithBackspace: true,
      // Phase 2 supplies `items` and `render` for the `{{` picker.
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

  addProseMirrorPlugins() {
    // Display-only until a picker renderer is configured (Phase 2), so no stray trigger plugin runs.
    if (!this.options.suggestion?.render) return [];
    return this.parent?.() ?? [];
  },
});
