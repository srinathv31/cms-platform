// `{{key}}` in pasted, dropped or imported content becomes a variable chip. Valid keys only:
// `{{first_name}}` and `{{ first_name }}` become chips, `{{First name}}` or `{{9x}}` stay text.
// chipsFromText works on a ProseMirror slice (the editor's paste), chipsInJSON on TipTap JSON (an
// import). Creating variables for keys the list doesn't have is the caller's job (the editor does
// it in field-binding.ts).

import { Fragment, Slice, type Node as PMNode, type NodeType, type Schema } from "@tiptap/pm/model";
import { LINE_BREAKS } from "../model/characters";
import { NODE, type JSONContent } from "../model/types";
import { isValidKey } from "../model/variables";

const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** The slice with every valid `{{key}}` in its text turned into a chip (marks kept). */
export function chipsFromText(slice: Slice, schema: Schema): Slice {
  const type = schema.nodes[NODE.variable];
  if (!type) return slice;
  const content = mapFragment(slice.content, type, true);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/**
 * The same on TipTap JSON (an imported document): every valid `{{key}}` in a text node becomes a
 * `variable` node, marks kept. Returns the document unchanged when there is nothing to convert.
 * Code that imports also creates variables for keys the list doesn't have; `variableKeys` lists them.
 */
export function chipsInJSON(doc: JSONContent): JSONContent {
  if (!doc.content) return doc;
  let changed = false;
  const content: JSONContent[] = [];
  for (const node of doc.content) {
    if (node.type === "text" && node.text?.includes("{{")) {
      const parts = splitJSONText(node);
      if (parts) {
        content.push(...parts);
        changed = true;
        continue;
      }
    }
    const next = chipsInJSON(node);
    if (next !== node) changed = true;
    content.push(next);
  }
  return changed ? { ...doc, content } : doc;
}

/** The distinct variable keys used in a TipTap JSON document, in order of first use. */
export function variableKeys(doc: JSONContent): string[] {
  const keys = new Set<string>();
  const walk = (node: JSONContent) => {
    const key = node.attrs?.key;
    if (node.type === NODE.variable && typeof key === "string" && key) keys.add(key);
    node.content?.forEach(walk);
  };
  walk(doc);
  return [...keys];
}

function splitJSONText(node: JSONContent): JSONContent[] | null {
  const text = node.text ?? "";
  const parts: JSONContent[] = [];
  const piece = (value: string): JSONContent => (node.marks?.length ? { type: "text", text: value, marks: node.marks } : { type: "text", text: value });
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const key = match[1];
    if (!isValidKey(key)) continue;
    const at = match.index ?? 0;
    if (at > last) parts.push(piece(text.slice(last, at)));
    parts.push(node.marks?.length ? { type: NODE.variable, attrs: { key }, marks: node.marks } : { type: NODE.variable, attrs: { key } });
    last = at + match[0].length;
  }
  if (!parts.length) return null;
  if (last < text.length) parts.push(piece(text.slice(last)));
  return parts;
}

function mapFragment(fragment: Fragment, type: NodeType, allowsChip: boolean): Fragment {
  let changed = false;
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      const parts = allowsChip ? splitText(node, type) : null;
      if (parts) {
        out.push(...parts);
        changed = true;
      } else {
        out.push(node);
      }
      return;
    }
    if (node.isLeaf || node.content.size === 0) {
      out.push(node);
      return;
    }
    const inner = mapFragment(node.content, type, node.type.contentMatch.matchType(type) !== null);
    if (inner !== node.content) {
      out.push(node.copy(inner));
      changed = true;
    } else {
      out.push(node);
    }
  });
  return changed ? Fragment.fromArray(out) : fragment;
}

function splitText(node: PMNode, type: NodeType): PMNode[] | null {
  const text = node.text ?? "";
  if (!text.includes("{{")) return null;
  const parts: PMNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const key = match[1];
    if (!isValidKey(key)) continue;
    const at = match.index ?? 0;
    if (at > last) parts.push(node.type.schema.text(text.slice(last, at), node.marks));
    parts.push(type.create({ key }, null, node.marks));
    last = at + match[0].length;
  }
  if (!parts.length) return null;
  if (last < text.length) parts.push(node.type.schema.text(text.slice(last), node.marks));
  return parts;
}

/**
 * Flattens a slice to the inline content of one line (a one-line field): blocks are joined with a
 * space, line breaks become spaces.
 */
export function flattenToLine(slice: Slice, schema: Schema): Slice {
  const inline: PMNode[] = [];
  let pendingSpace = false;
  slice.content.descendants((node) => {
    if (node.isTextblock) {
      if (inline.length) pendingSpace = true;
      return true;
    }
    if (node.isInline) {
      if (node.type.name === "hardBreak") {
        pendingSpace = inline.length > 0;
        return false;
      }
      if (pendingSpace) {
        inline.push(schema.text(" "));
        pendingSpace = false;
      }
      inline.push(node);
      return false;
    }
    return true;
  });
  const paragraph = schema.nodes.paragraph.create(null, inline);
  return new Slice(Fragment.from(paragraph), 1, 1);
}

/**
 * Flattens a slice to the inline content of one paragraph that keeps its lines (a field with `lines`,
 * an SMS message): blocks are joined with a hard break, an empty one included (a blank line), and the
 * slice's own hard breaks stay.
 */
export function flattenToLines(slice: Slice, schema: Schema): Slice {
  const hardBreak = schema.nodes.hardBreak;
  if (!hardBreak) return flattenToLine(slice, schema);
  const inline: PMNode[] = [];
  let blocks = 0;
  slice.content.descendants((node) => {
    if (node.isTextblock) {
      if (blocks++ > 0) inline.push(hardBreak.create());
      return true;
    }
    if (node.isInline) {
      inline.push(node);
      return false;
    }
    return true;
  });
  const paragraph = schema.nodes.paragraph.create(null, inline);
  return new Slice(Fragment.from(paragraph), 1, 1);
}

/** Pasted plain text as one paragraph, each line break (CR LF, CR, LF, U+2028, U+2029) a hard break. */
export function linesOfText(text: string, schema: Schema): Slice {
  const hardBreak = schema.nodes.hardBreak;
  const inline: PMNode[] = [];
  text.split(LINE_BREAKS).forEach((line, i) => {
    if (i > 0) inline.push(hardBreak ? hardBreak.create() : schema.text(" "));
    if (line) inline.push(schema.text(line));
  });
  const paragraph = schema.nodes.paragraph.create(null, inline);
  return new Slice(Fragment.from(paragraph), 1, 1);
}
