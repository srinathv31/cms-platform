// Pasting a document that names the required sections (Copilot's answer, a draft written elsewhere):
// a pasted top-level heading whose text matches one of the document's required headings
// (`matchesSectionTitle`: case, spacing, numbering and a trailing colon ignored) merges into that
// section instead of adding a second "Rates and fees".
//   • Blocks before the first matching heading paste where the selection starts, like any paste
//     (select-all: at the top). With the caret in a required heading they go right below it.
//   • Each matching heading is dropped; the blocks after it, up to the next matching heading, go to
//     the end of that section (a section runs to the next H2), after its last line with something
//     in it. A section that holds only empty lines is replaced.
//   • Headings that match nothing stay ordinary headings, where they are. So does a copy of a
//     required heading itself (copied in an editor, it carries its `requiredKey`): it pastes as a
//     plain heading, as before.
//   • Over a selection that spans required headings (select-all), the guard's range rule runs first:
//     everything but the headings goes, so the answer replaces the draft section by section.
//   • One transaction, closed off from the typing before it, so one undo step. It is marked as a paste, so the field binding treats it as
//     one: `{{key}}` chips (already made by the paste's chip transform) create their variables.
// A paste with no matching heading is left to the default paste (and the guard). Client only.

import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { matchesSectionTitle } from "../model/section-title";
import { NODE } from "../model/types";
import {
  REQUIRED_KEY_ATTR,
  headingsIn,
  isRequiredHeading,
  replaceAroundRequired,
  requiredHeadings,
} from "./required-sections";

export const sectionPastePluginKey = new PluginKey("sectionPaste");

interface SectionPart {
  /** The required heading's key. */
  key: string;
  /** The pasted blocks that follow the matching heading. */
  blocks: PMNode[];
}

interface SplitPaste {
  /** Blocks before the first matching heading (they paste at the selection). */
  lead: PMNode[];
  parts: SectionPart[];
}

/**
 * Splits a pasted slice at its top-level headings that match a required heading of `doc`. `copies`
 * are the indexes of top-level blocks that were required headings where they were copied from.
 */
function splitBySections(doc: PMNode, slice: Slice, copies: ReadonlySet<number>): SplitPaste | null {
  const required = requiredHeadings(doc);
  if (!required.length) return null;
  const lead: PMNode[] = [];
  const parts: SectionPart[] = [];
  slice.content.forEach((node, _offset, index) => {
    const match =
      node.type.name === NODE.heading && !copies.has(index)
        ? required.find((heading) => matchesSectionTitle(node.textContent, heading.node.textContent))
        : undefined;
    if (match) parts.push({ key: match.key, blocks: [] });
    else (parts.at(-1)?.blocks ?? lead).push(node);
  });
  return parts.length ? { lead, parts } : null;
}

const isEmptyLine = (node: PMNode) => node.type.name === "paragraph" && node.content.size === 0;

/**
 * Where a section's pasted blocks go: after its last block with something in it, or over the whole
 * body when it holds only empty lines (or nothing). Null when the heading isn't in the document.
 */
function sectionTarget(doc: PMNode, key: string): { from: number; to: number } | null {
  let headingEnd = -1;
  let contentEnd = -1;
  let sectionEnd = doc.content.size;
  doc.forEach((node, offset) => {
    if (sectionEnd !== doc.content.size) return;
    if (headingEnd < 0) {
      if (node.attrs.requiredKey === key && isRequiredHeading(node)) headingEnd = contentEnd = offset + node.nodeSize;
      return;
    }
    if (node.type.name === NODE.heading && Number(node.attrs.level) <= 2) {
      sectionEnd = offset;
      return;
    }
    if (!isEmptyLine(node)) contentEnd = offset + node.nodeSize;
  });
  if (headingEnd < 0) return null;
  return contentEnd === headingEnd ? { from: headingEnd, to: sectionEnd } : { from: contentEnd, to: contentEnd };
}

/**
 * The section-merging paste of `slice` over the current selection, as one transaction, or null when
 * no pasted top-level heading matches a required heading (the default paste applies). `copies`: the
 * top-level blocks that are copies of required headings (they never merge).
 */
export function sectionPasteTransaction(
  state: EditorState,
  slice: Slice,
  copies: ReadonlySet<number> = new Set(),
): Transaction | null {
  const split = splitBySections(state.doc, slice, copies);
  if (!split) return null;

  // Clear the selection first. Across required headings that is the guard's range rule (keep the
  // headings, clear the rest); when the selection holds nothing but heading text there is nothing to clear.
  const { selection } = state;
  let tr: Transaction = state.tr;
  if (!selection.empty) {
    if (headingsIn(state.doc, selection.from, selection.to).length) tr = replaceAroundRequired(state, selection.from, selection.to, null) ?? tr;
    else tr.deleteSelection();
  }
  // A paste is its own undo step, never merged into the typing just before it.
  closeHistory(tr);

  // The caret ends after the last pasted block: a position, and the step it was taken before.
  let caret: { pos: number; step: number } | null = null;

  // The blocks before the first match go where the selection started (for select-all, the top).
  if (split.lead.length) {
    const at = tr.mapping.map(selection.from, -1);
    const $at = tr.doc.resolve(at);
    if (isRequiredHeading($at.parent)) {
      // Not into a required heading: right below it.
      const below = $at.after(1);
      caret = { pos: below, step: tr.steps.length };
      tr.insert(below, Fragment.from(split.lead));
    } else if ($at.parent.inlineContent) {
      tr.setSelection(TextSelection.create(tr.doc, at));
      tr.replaceSelection(new Slice(Fragment.from(split.lead), slice.openStart, 0));
      caret = { pos: tr.selection.to, step: tr.steps.length };
    } else {
      // Between blocks: as blocks.
      caret = { pos: at, step: tr.steps.length };
      tr.insert(at, Fragment.from(split.lead));
    }
  }

  // Each matched heading's blocks, at the end of its section.
  for (const part of split.parts) {
    if (!part.blocks.length) continue;
    const target = sectionTarget(tr.doc, part.key);
    if (!target) continue;
    caret = { pos: target.to, step: tr.steps.length };
    tr.replaceWith(target.from, target.to, Fragment.from(part.blocks));
  }

  if (caret) {
    // Mapped forward (assoc 1): past the blocks inserted at that position, then near their end.
    const pos = tr.mapping.slice(caret.step).map(caret.pos, 1);
    tr.setSelection(Selection.near(tr.doc.resolve(pos), -1));
  }
  return tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste");
}

export const SectionPaste = Extension.create({
  name: "sectionPaste",

  // Ahead of the required-section guard (1000), whose own paste handling would insert the pasted
  // headings as duplicates. This handler applies the guard's range rule itself.
  priority: 1001,

  addProseMirrorPlugins() {
    // The top-level blocks of the paste in progress that were copied required headings. Noted while
    // the clipboard is parsed (this transform runs before the guard strips their keys; the later
    // transforms keep top-level blocks one to one) and read by handlePaste right after.
    let copies: ReadonlySet<number> = new Set();
    return [
      new Plugin({
        key: sectionPastePluginKey,
        props: {
          transformPasted: (slice) => {
            const found = new Set<number>();
            slice.content.forEach((node, _offset, index) => {
              if (node.attrs[REQUIRED_KEY_ATTR]) found.add(index);
            });
            copies = found;
            return slice;
          },
          handlePaste: (view, _event, slice) => {
            const tr = sectionPasteTransaction(view.state, slice, copies);
            copies = new Set();
            if (!tr) return false;
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
