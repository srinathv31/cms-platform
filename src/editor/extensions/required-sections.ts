// Required sections: headings that carry a `requiredKey` (from the content type).
// Phase 1: the attribute (rendered as data-required), looking like any other heading, plus an
// integrity rule: a key appears at most once (splitting a required heading mid-text or pasting a
// copy of one never yields a second required heading; the first in document order keeps it).
// Phase 2 adds the guard here: a filterTransaction that blocks deleting, renaming or reordering
// these headings, plus the inline "Required for disclosures" note.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

export interface RequiredSectionsOptions {
  /** Node types that can be required section headings. */
  types: string[];
}

export const REQUIRED_KEY_ATTR = "requiredKey";

export const requiredSectionsPluginKey = new PluginKey("requiredSections");

export const RequiredSections = Extension.create<RequiredSectionsOptions>({
  name: "requiredSections",

  addOptions() {
    return { types: ["heading"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [REQUIRED_KEY_ATTR]: {
            default: null,
            // Splitting at the end of a required heading starts a plain block.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-required") || null,
            renderHTML: (attributes) =>
              attributes[REQUIRED_KEY_ATTR] ? { "data-required": attributes[REQUIRED_KEY_ATTR] } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const types = new Set(this.options.types);
    return [
      new Plugin({
        key: requiredSectionsPluginKey,
        appendTransaction: (transactions, _oldState, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            const key = types.has(node.type.name) ? (node.attrs[REQUIRED_KEY_ATTR] as string | null) : null;
            if (key) {
              if (seen.has(key)) {
                tr ??= state.tr;
                tr.setNodeAttribute(pos, REQUIRED_KEY_ATTR, null);
              } else {
                seen.add(key);
              }
            }
            return !node.isTextblock; // headings never nest; skip inline content
          });
          return tr;
        },
      }),
    ];
  },
});
