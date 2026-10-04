// Positions around required sections, shared by focus("first-section") and click-to-insert.

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { NODE } from "../model/types";

export interface FirstSection {
  /** Position right after the first required heading. */
  headingEnd: number;
  /** True when a paragraph follows the heading (its content starts at headingEnd + 1). */
  hasBody: boolean;
  /**
   * Where typing continues the section: the end of its last top-level paragraph, or of its last
   * text block when it has no paragraph. Null when the section is empty.
   */
  bodyEnd: number | null;
}

/** The first top-level heading that carries a `requiredKey`, or null when there is none. */
export function firstRequiredSection(doc: PMNode): FirstSection | null {
  let headingEnd = -1;
  let hasBody = false;
  let sectionEnd = doc.content.size;
  let lastParagraphEnd: number | null = null;
  doc.forEach((node, offset, index) => {
    if (headingEnd < 0) {
      if (node.type.name !== NODE.heading || !node.attrs.requiredKey) return;
      headingEnd = offset + node.nodeSize;
      hasBody = doc.maybeChild(index + 1)?.type.name === "paragraph";
      return;
    }
    if (sectionEnd !== doc.content.size) return;
    // The section runs to the next H2 (required or not), like the usage counts' sections.
    if (node.type.name === NODE.heading && Number(node.attrs.level) <= 2) {
      sectionEnd = offset;
      return;
    }
    if (node.type.name === "paragraph") lastParagraphEnd = offset + node.nodeSize - 1;
  });
  if (headingEnd < 0) return null;

  // Prefer the end of the section's last top-level paragraph (typing then never lands inside a
  // list or a table); otherwise the end of its last text anywhere.
  let bodyEnd: number | null = lastParagraphEnd;
  if (bodyEnd === null && sectionEnd > headingEnd) {
    const found = Selection.findFrom(doc.resolve(sectionEnd), -1, true);
    if (found && found.from > headingEnd) bodyEnd = found.from;
  }
  return { headingEnd, hasBody, bodyEnd };
}

/**
 * Puts the caret at the end of the first required section's text, so typing continues it (a
 * starter's seeded sentence stays whole). If the section has no text yet (a Blank document is just
 * the required headings), adds an empty line under its heading, outside undo history.
 */
export function focusFirstSection(editor: Editor) {
  const section = firstRequiredSection(editor.state.doc);
  if (!section) {
    editor.commands.focus("start");
    return;
  }
  if (section.bodyEnd !== null) {
    editor.commands.focus(section.bodyEnd);
    return;
  }
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta("addToHistory", false);
      return true;
    })
    .insertContentAt(section.headingEnd, { type: "paragraph" }, { updateSelection: false })
    .focus(section.headingEnd + 1)
    .run();
}
