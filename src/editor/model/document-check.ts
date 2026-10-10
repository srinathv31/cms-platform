// The document check's rules beyond the schema's node and mark names (docs/render-spec.md §3, "The
// document check"). Pure TypeScript on TipTap JSON, so the editor, the autosave and the render
// engine (src/server/render/schema-check.ts, which adds the schema parse) refuse the same documents
// with the same sentences. Run it on a normalized document (normalize.ts): what normalization fixes
// (heading levels 4–6, ragged rows, wide tables, content in cells) is refused here when it wasn't.
// A save runs both through `normalizeAndCheckBody` / `normalizeAndCheckField`.

import {
  LIST_START_MAX,
  LIST_START_MIN,
  MAX_LIST_DEPTH,
  isListStart,
  isMarkerDelimiter,
  isMarkerFormat,
} from "./list-markers";
import type { CharacterRules } from "./characters";
import { CELL_BLOCKS, HEADING_LEVELS, MAX_HEADING_LEVEL, normalizeDocument, normalizeField, type FieldLines } from "./normalize";
import { MAX_TABLE_COLUMNS, linesUp, tableGrid } from "./table-grid";
import { isNode, type JSONContent } from "./types";

/** Why a document is refused, worded for the author (save status) and the render error alike. */
export const DOCUMENT_MESSAGES = {
  unsupported: "This document has content Stencil doesn't support.",
  cell: "Table cells can hold only paragraphs and lists.",
  heading: `Headings can only be levels 1 to ${MAX_HEADING_LEVEL}.`,
  listStart: `A numbered list can start at ${LIST_START_MIN} to ${LIST_START_MAX}.`,
  numbering: "This list's numbering style isn't one Stencil knows.",
  listDepth: `Lists can nest at most ${MAX_LIST_DEPTH} levels deep.`,
  tableShape: "This table's cells don't line up into rows and columns.",
  tableColumns: `Tables can have at most ${MAX_TABLE_COLUMNS} columns.`,
  field: "The email subject and preheader can hold only one line of text and variables.",
  pushField: "The push title, subtitle and body can hold only text and variables, with no line breaks.",
  smsField: "The SMS message can hold only text, line breaks and variables.",
} as const;

export type DocumentProblem = keyof typeof DOCUMENT_MESSAGES;

const LISTS = new Set(["bulletList", "orderedList"]);
const CELLS = new Set(["tableCell", "tableHeader"]);

/** Absent or null, or a value the guard accepts. */
const optional = (value: unknown, guard: (value: unknown) => boolean) => value === undefined || value === null || guard(value);

/**
 * The first rule the document breaks, in document order, or null. Node and mark names, and where
 * each node may go otherwise, are the schema's to check (schema-check.ts).
 */
export function documentProblem(doc: JSONContent): DocumentProblem | null {
  return walk(doc, 0, false);
}

/** `inCell`: the node sits inside a table cell, at any depth. */
function walk(node: unknown, listDepth: number, inCell: boolean): DocumentProblem | null {
  if (!isNode(node)) return null; // not a node: the schema parse refuses it
  const attrs = isNode(node.attrs) ? (node.attrs as Record<string, unknown>) : {};
  let depth = listDepth;

  switch (node.type) {
    case "heading":
      // Absent is the schema's default, 1 (as the resolver reads it); null or anything else is refused.
      if (attrs.level !== undefined && !(HEADING_LEVELS as readonly unknown[]).includes(attrs.level)) return "heading";
      break;
    case "orderedList":
      if (!optional(attrs.start, isListStart)) return "listStart";
      if (!optional(attrs.markerFormat, isMarkerFormat) || !optional(attrs.markerDelimiter, isMarkerDelimiter)) return "numbering";
      break;
    case "table": {
      const grid = tableGrid(node);
      if (grid.width === 0 || !linesUp(grid)) return "tableShape";
      if (grid.width > MAX_TABLE_COLUMNS) return "tableColumns";
      break;
    }
  }
  if (LISTS.has(node.type ?? "") && ++depth > MAX_LIST_DEPTH) return "listDepth";
  // A cell holds paragraphs and lists, and so does every list item inside it, at any depth.
  const cell = CELLS.has(node.type ?? "");
  if ((cell || (inCell && node.type === "listItem")) && !(node.content ?? []).every((child) => isNode(child) && CELL_BLOCKS.includes(child.type ?? ""))) {
    return "cell";
  }

  if (!Array.isArray(node.content)) return null;
  for (const child of node.content) {
    const problem = walk(child, depth, inCell || cell);
    if (problem) return problem;
  }
  return null;
}

/** A document as a save takes it: normalized, and the first rule the normalized document breaks. */
export interface Checked {
  doc: JSONContent;
  problem: DocumentProblem | null;
}

/**
 * A body as every save takes it (docs/render-spec.md §3): normalized, then checked. The editor's
 * autosave pre-check and the server's (src/server/documents/prepare.ts, which adds the schema parse
 * and the block ids) both start here, so they refuse the same bodies with the same sentence.
 */
export function normalizeAndCheckBody(doc: JSONContent): Checked {
  const normalized = normalizeDocument(doc);
  return { doc: normalized, problem: documentProblem(normalized) };
}

/** The sentences a channel field's check can refuse with: the email's, a push's, an SMS's. */
export type FieldProblem = Extract<DocumentProblem, "field" | "pushField" | "smsField">;

/**
 * How a field is checked: whether it keeps its line breaks (`lines`, default `"line"`), the problem it
 * is refused with (`problem`, default `"field"`, the email's sentence), and which characters its text
 * keeps (`characters`, default `"document"`; a push's or an SMS's field is `"message"`, characters.ts).
 * The caller, which knows the field's channel, picks them (`normalizeAndCheckChannelField` in
 * src/domain/channel-fields.ts).
 */
export interface FieldCheck {
  lines?: FieldLines;
  problem?: FieldProblem;
  characters?: CharacterRules;
}

/** A channel field as every save takes it: normalized for its lines and characters, then the field check. */
export function normalizeAndCheckField(doc: JSONContent, check: FieldCheck = {}): Checked {
  const normalized = normalizeField(doc, check.lines, check.characters);
  return { doc: normalized, problem: fieldProblem(normalized, check) };
}

/**
 * A channel field: one paragraph of text and variables, no marks; hardBreaks only when it keeps its
 * line breaks (`lines: "lines"`). Null when it is one; `check.problem` when it isn't (the body rules
 * don't apply to it).
 */
export function fieldProblem(doc: JSONContent, check: FieldCheck = {}): FieldProblem | null {
  const problem = check.problem ?? "field";
  const breaks = check.lines === "lines";
  if (!isNode(doc) || doc.type !== "doc" || !Array.isArray(doc.content) || doc.content.length !== 1) return problem;
  const paragraph = doc.content[0];
  if (!isNode(paragraph) || paragraph.type !== "paragraph" || paragraph.marks?.length) return problem;
  for (const child of paragraph.content ?? []) {
    if (!isNode(child) || child.marks?.length) return problem;
    if (child.type !== "text" && child.type !== "variable" && !(breaks && child.type === "hardBreak")) return problem;
  }
  return null;
}
