// Resolves a version's TipTap JSON and its canonical values into a channel-neutral RenderDoc body.
// A pure walk over the JSON: no TipTap runtime here, so it ports to the Java API as is.
// docs/render-spec.md section 8 ("Resolution") is the specification; resolve.test.ts pins it.
//
// It handles exactly the editor schema's nodes and marks (HANDLED_NODES, HANDLED_MARKS; a server
// test keeps them in step with src/editor/schema.ts). The server checks every document first, so
// JSON the resolver can't place (an unknown node or mark, a node in the wrong spot) or an attribute
// outside its allowed values (spec section 2) throws a ResolveError instead of being guessed at. Its
// message is one of the document check's sentences: never a node or mark name, text or a value.
//
//   text            line break characters become breaks; tabs become spaces; invisible and control
//                   characters are removed; adjacent runs with identical marks merge (never into a
//                   variable's run); each run is NFC. Spaces and hard breaks are content: kept
//                   exactly as typed, a break at the end of a paragraph included.
//   variable chip   a run holding the value's display text (formatValue), with the chip's marks and
//                   `variable: key`. A key that isn't in the list, or has no value, renders nothing.
//   link            normalizeLink, the one link rule: a link that fails it is dropped, its text kept.
//   removal         a paragraph or heading made only of variables without a value (plus blank
//                   characters and breaks) is removed; an item left empty is removed and the list
//                   renumbers; a list or callout left empty is removed; a table cell never is.
//   markers         every list item carries the marker every channel prints (list-markers.ts).
//   cells           hold paragraphs and lists only, at every depth: anything else inside a cell (in
//                   a list item in it too) is refused with the document check's sentence.
//   the document    trailing empty paragraphs (the editor's trailing line) are dropped; empty
//                   paragraphs inside the document stay (they are blank lines the author typed).

import { LINE_BREAKS, cleanCharacters } from "@/editor/model/characters";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import { INVISIBLE_CHARACTERS, normalizeLink } from "@/editor/model/links";
import {
  BULLET_GLYPHS,
  MAX_LIST_DEPTH,
  bulletStyle,
  formatMarker,
  isListStart,
  isMarkerDelimiter,
  isMarkerFormat,
  resolveNumbering,
  type MarkerDelimiter,
  type MarkerFormat,
} from "@/editor/model/list-markers";
import { CELL_BLOCKS } from "@/editor/model/normalize";
import { MAX_TABLE_COLUMNS, linesUp, spanValue, tableGrid } from "@/editor/model/table-grid";
import { formatValue } from "@/editor/model/variables";
import type { JSONContent, Variable } from "../types";
import type {
  CanonicalValues,
  RenderBlock,
  RenderCallout,
  RenderCellBlock,
  RenderHeading,
  RenderInline,
  RenderList,
  RenderParagraph,
  RenderTable,
  RenderTableCell,
  RenderTableRow,
  RenderText,
  ResolveContext,
} from "./types";

/** Every node name the resolver understands: exactly the editor schema's. */
export const HANDLED_NODES: readonly string[] = [
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "callout",
  "horizontalRule",
  "hardBreak",
  "text",
  "variable",
];

/** Every mark name the resolver understands: exactly the editor schema's. */
export const HANDLED_MARKS: readonly string[] = ["bold", "italic", "underline", "link"];

/**
 * A stored document the resolver refuses: JSON it can't place (an unknown node or mark, a known node
 * in the wrong spot, a node missing the content it needs) or an attribute outside its allowed values.
 * The message is one of the document check's sentences (DOCUMENT_MESSAGES), so a stored document is
 * refused in the same words whichever of the two finds the problem. Each is one complete sentence
 * that names nothing from the document: no text, no value, no node or mark name.
 */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

// ── Characters (spec section 4; explicit sets so the Java port matches code point for code point) ──
// The line breaks, control characters and step 4 (cleanCharacters) are save normalization's own
// (src/editor/model/characters.ts).

/**
 * "Blank characters" for the removal rule: spaces (U+0020, U+00A0, U+1680, U+2000–U+200A, U+202F,
 * U+205F, U+3000), the invisible characters (links.ts, INVISIBLE_CHARACTERS), the tab and the line
 * break characters.
 */
const BLANK_ONLY = new RegExp(
  `^[\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000${INVISIBLE_CHARACTERS}\\t\\n\\r\\u2028\\u2029]*$`,
  "u",
);
/** What a one-line field trims from its ends: JavaScript's whitespace set (String.prototype.trim). */
const FIELD_ENDS =
  /^[\t\n\u000B\u000C\r\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\t\n\u000B\u000C\r\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/g;

/** Text that must stay on one line (a variable's value, a subject): a line break reads as a space. */
function oneLineChars(text: string): string {
  return cleanCharacters(text.replace(LINE_BREAKS, " "));
}

// ── Scope ────────────────────────────────────────────────────────────────────

interface Scope {
  byKey: ReadonlyMap<string, Variable>;
  values: CanonicalValues;
  /** orderedList ancestors of the current node (picks an unstyled list's default format). */
  orderedDepth: number;
  /** bulletList ancestors of the current node (picks the bullet glyph). */
  bulletDepth: number;
  /** Inside a table cell, at any depth: only paragraphs and lists (rule 24). */
  inCell: boolean;
}

function scopeOf(ctx: ResolveContext): Scope {
  return { byKey: new Map(ctx.variables.map((v) => [v.key, v])), values: ctx.values, orderedDepth: 0, bulletDepth: 0, inCell: false };
}

// ── Public ───────────────────────────────────────────────────────────────────

/** The document's blocks, resolved. `body` must be a `doc`. */
export function resolveDocument(body: JSONContent, ctx: ResolveContext): RenderBlock[] {
  if (body?.type !== "doc") throw unsupported();
  const out = blocks(body.content, scopeOf(ctx));
  // The editor's trailing line: empty paragraphs at the very end (a paragraph of spaces is content).
  while (out.length > 0 && isEmptyParagraph(out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * The text of a one-line field (`line` or `paragraph`: the email subject and preheader, a push title,
 * subtitle or body): its text and its variables' display text, in order, with the character rules and
 * NFC. A line break or hard break becomes one space (and several paragraphs are joined by one),
 * whitespace at both ends is trimmed (a mail header can't start with it), and runs of spaces inside
 * stay as typed. There is no removal rule. `null` gives "".
 */
export function resolveInlineField(field: JSONContent | null, ctx: ResolveContext): string {
  return fieldText(field, ctx, " ");
}

/**
 * The text of a field that keeps its line breaks (an SMS message): as `resolveInlineField`, but each
 * line break or hard break is one "\n" (and several paragraphs are joined by one), so the text has the
 * lines the author typed. A value is still one line: a line break inside it reads as a space. Line
 * breaks and other whitespace at both ends are trimmed; spaces at a line's ends inside stay as typed.
 */
export function resolveLinesField(field: JSONContent | null, ctx: ResolveContext): string {
  return fieldText(field, ctx, "\n");
}

/** A field's text, each line break (in text, a hard break, between paragraphs) written as `lineBreak`. */
function fieldText(field: JSONContent | null, ctx: ResolveContext, lineBreak: " " | "\n"): string {
  if (!field) return "";
  const scope = scopeOf(ctx);
  const lines = field.type === "doc" ? (field.content ?? []) : [field];
  const text = lines.map((line) => fieldLine(line, scope, lineBreak)).join(lineBreak);
  return text.normalize("NFC").replace(FIELD_ENDS, "");
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** Resolved blocks, without the ones the removal rule took out. */
function blocks(nodes: JSONContent[] | undefined, scope: Scope): RenderBlock[] {
  const out: RenderBlock[] = [];
  for (const node of nodes ?? []) {
    const resolved = block(node, scope);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** A block, or null when the removal rule takes it out. */
function block(node: JSONContent, scope: Scope): RenderBlock | null {
  if (scope.inCell && !CELL_BLOCKS.includes(String(node?.type))) {
    throw HANDLED_NODES.includes(String(node?.type)) ? new ResolveError(DOCUMENT_MESSAGES.cell) : unsupported();
  }
  switch (node?.type) {
    case "paragraph":
      return paragraph(node, scope);
    case "heading":
      return heading(node, scope);
    case "bulletList":
    case "orderedList":
      return list(node, scope);
    case "table":
      return table(node, scope);
    case "callout":
      return callout(node, scope);
    case "horizontalRule":
      return { type: "rule", id: blockId(node) };
    default:
      throw unsupported();
  }
}

function paragraph(node: JSONContent, scope: Scope): RenderParagraph | null {
  const content = inlines(node, scope);
  return isRemoved(node, scope) ? null : { type: "paragraph", id: blockId(node), content };
}

function heading(node: JSONContent, scope: Scope): RenderHeading | null {
  const level = headingLevel(node.attrs?.level);
  const content = inlines(node, scope);
  if (isRemoved(node, scope)) return null;
  return { type: "heading", id: blockId(node), level, section: nonEmptyString(node.attrs?.requiredKey), content };
}

function callout(node: JSONContent, scope: Scope): RenderCallout | null {
  const children = node.content ?? [];
  if (children.length === 0) throw unsupported();
  const content: RenderParagraph[] = [];
  for (const child of children) {
    if (child?.type !== "paragraph") throw unsupported();
    const resolved = paragraph(child, scope);
    if (resolved) content.push(resolved);
  }
  // A callout whose paragraphs were all removed is removed.
  return content.length === 0 ? null : { type: "callout", id: blockId(node), content };
}

// ── Lists ────────────────────────────────────────────────────────────────────

/**
 * A list, or null when every item was removed. Items are numbered after removal, so an ordered list
 * renumbers like deleting a numbered paragraph in Word: item i is `start + i` among the items left.
 */
function list(node: JSONContent, scope: Scope): RenderList | null {
  if (scope.orderedDepth + scope.bulletDepth >= MAX_LIST_DEPTH) throw new ResolveError(DOCUMENT_MESSAGES.listDepth);
  const id = blockId(node);

  if (node.type === "bulletList") {
    const bullet = bulletStyle(scope.bulletDepth);
    const marker = BULLET_GLYPHS[bullet];
    const contents = itemContents(node, { ...scope, bulletDepth: scope.bulletDepth + 1 });
    if (contents.length === 0) return null;
    return { type: "list", id, ordered: false, bullet, items: contents.map((content) => ({ marker, content })) };
  }

  const attrs = node.attrs ?? {};
  const start = listStart(attrs.start);
  const { format, delimiter } = resolveNumbering(markerFormat(attrs.markerFormat), markerDelimiter(attrs.markerDelimiter), scope.orderedDepth);
  const contents = itemContents(node, { ...scope, orderedDepth: scope.orderedDepth + 1 });
  if (contents.length === 0) return null;
  return {
    type: "list",
    id,
    ordered: true,
    start,
    format,
    delimiter,
    items: contents.map((content, i) => ({ marker: formatMarker(start + i, format, delimiter), content })),
  };
}

/** The content of each item that is left; an item whose blocks were all removed is removed. */
function itemContents(node: JSONContent, scope: Scope): RenderBlock[][] {
  const children = node.content ?? [];
  if (children.length === 0) throw unsupported();
  const out: RenderBlock[][] = [];
  for (const child of children) {
    if (child?.type !== "listItem" || !child.content?.length) throw unsupported();
    const content = blocks(child.content, scope);
    if (content.length > 0) out.push(content);
  }
  return out;
}

/** `start`: absent or null is 1; otherwise an integer from 0 to 9999, exactly as stored. */
function listStart(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (!isListStart(value)) throw new ResolveError(DOCUMENT_MESSAGES.listStart);
  return value;
}

/** `markerFormat`: absent or null takes the default for the depth; anything else must be known. */
function markerFormat(value: unknown): MarkerFormat | null {
  if (value === undefined || value === null) return null;
  if (!isMarkerFormat(value)) throw new ResolveError(DOCUMENT_MESSAGES.numbering);
  return value;
}

/** `markerDelimiter`: absent or null is "period"; anything else must be known. */
function markerDelimiter(value: unknown): MarkerDelimiter | null {
  if (value === undefined || value === null) return null;
  if (!isMarkerDelimiter(value)) throw new ResolveError(DOCUMENT_MESSAGES.numbering);
  return value;
}

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * A table: every cell resolved first (content, then colspan, rowspan), then the grid checked as the
 * document check checks it (table-grid.ts, placing cells as the editor's table plugin does): the
 * cells must line up into rows and columns, then the width must be at most 12.
 */
function table(node: JSONContent, scope: Scope): RenderTable {
  const rows = (node.content ?? []).map((child) => tableRow(child, scope));
  const grid = tableGrid(node);
  if (grid.width === 0 || !linesUp(grid)) throw new ResolveError(DOCUMENT_MESSAGES.tableShape);
  if (grid.width > MAX_TABLE_COLUMNS) throw new ResolveError(DOCUMENT_MESSAGES.tableColumns);
  return { type: "table", id: blockId(node), columns: grid.width, rows };
}

function tableRow(node: JSONContent, scope: Scope): RenderTableRow {
  if (node?.type !== "tableRow") throw unsupported();
  return { cells: (node.content ?? []).map((child) => tableCell(child, scope)) };
}

/**
 * A cell is never removed: when the removal rule takes out all it holds, it stays, empty. It holds
 * only paragraphs and lists, at every depth (`inCell`).
 */
function tableCell(node: JSONContent, scope: Scope): RenderTableCell {
  if (node?.type !== "tableCell" && node?.type !== "tableHeader") throw unsupported();
  const content: RenderCellBlock[] = [];
  for (const child of node.content ?? []) {
    const resolved = block(child, { ...scope, inCell: true }) as RenderCellBlock | null;
    if (resolved) content.push(resolved);
  }
  return {
    header: node.type === "tableHeader",
    colspan: span(node.attrs?.colspan),
    rowspan: span(node.attrs?.rowspan),
    content,
  };
}

/** `colspan` / `rowspan`: absent or null is 1; otherwise an integer ≥ 1. */
function span(value: unknown): number {
  const n = spanValue(value);
  if (n === null) throw new ResolveError(DOCUMENT_MESSAGES.tableShape);
  return n;
}

// ── Attributes ───────────────────────────────────────────────────────────────

function blockId(node: JSONContent): string | null {
  return nonEmptyString(node.attrs?.id);
}

/** `level`: 1, 2 or 3. Absent is 1, the schema's default (what parsing the JSON gives). */
function headingLevel(value: unknown): 1 | 2 | 3 {
  if (value === undefined) return 1;
  if (value === 1 || value === 2 || value === 3) return value;
  throw new ResolveError(DOCUMENT_MESSAGES.heading);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isEmptyParagraph(b: RenderBlock): boolean {
  return b.type === "paragraph" && b.content.length === 0;
}

// ── Removal ──────────────────────────────────────────────────────────────────

/**
 * The removal rule (spec section 8), read from the source JSON: a paragraph or heading goes when it
 * holds at least one variable, every variable in it gives nothing, and every text node in it is
 * only blank characters. Hard breaks may appear. Text beside an empty variable keeps the paragraph.
 */
function isRemoved(node: JSONContent, scope: Scope): boolean {
  let variables = 0;
  for (const child of node.content ?? []) {
    switch (child.type) {
      case "variable":
        if (variableText(child, scope) !== null) return false;
        variables += 1;
        break;
      case "text":
        if (!BLANK_ONLY.test(typeof child.text === "string" ? child.text : "")) return false;
        break;
      case "hardBreak":
        break;
      default:
        return false;
    }
  }
  return variables > 0;
}

// ── Inline ───────────────────────────────────────────────────────────────────

type MarkSet = Pick<RenderText, "bold" | "italic" | "underline" | "href">;

/**
 * A paragraph's or heading's inline content: runs and breaks, characters cleaned, runs with identical
 * marks merged (a run left empty by the cleaning is dropped first, so the runs around it can merge),
 * each run NFC. Every hard break stays, one at the end included: it ends a line, and the empty line
 * after it shows in the editor and in every channel.
 */
function inlines(node: JSONContent, scope: Scope): RenderInline[] {
  const out: RenderInline[] = [];
  for (const child of node.content ?? []) {
    switch (child?.type) {
      case "text": {
        const marks = marksOf(child.marks);
        const text = typeof child.text === "string" ? child.text : "";
        text.split(LINE_BREAKS).forEach((part, i) => {
          if (i > 0) out.push({ type: "break" });
          pushText(out, cleanCharacters(part), marks);
        });
        break;
      }
      case "hardBreak":
        out.push({ type: "break" });
        break;
      case "variable": {
        const marks = marksOf(child.marks);
        const text = variableText(child, scope);
        if (text !== null) out.push({ type: "text", text, ...marks, variable: String(child.attrs?.key) });
        break;
      }
      default:
        throw unsupported();
    }
  }
  for (const item of out) {
    if (item.type === "text") item.text = item.text.normalize("NFC");
  }
  return out;
}

/** Plain text, merged into the previous run when the marks match (never into a variable's run). */
function pushText(out: RenderInline[], text: string, marks: MarkSet) {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last?.type === "text" && last.variable === undefined && sameMarks(last, marks)) {
    last.text += text;
  } else {
    out.push({ type: "text", text, ...marks });
  }
}

/**
 * A variable's display text (formatValue, which also turns a text value's line breaks into spaces
 * and trims it), with the character rules; null when it gives nothing: the key isn't in the list,
 * has no value, or its display text is empty once invisible and control characters are removed.
 */
function variableText(node: JSONContent, scope: Scope): string | null {
  const key = node.attrs?.key;
  if (typeof key !== "string") return null;
  const variable = scope.byKey.get(key);
  if (!variable || !Object.prototype.hasOwnProperty.call(scope.values, key)) return null;
  const text = oneLineChars(formatValue(variable.type, scope.values[key]!));
  return text === "" ? null : text;
}

function marksOf(marks: JSONContent["marks"]): MarkSet {
  const set: MarkSet = {};
  for (const mark of marks ?? []) {
    switch (mark?.type) {
      case "bold":
        set.bold = true;
        break;
      case "italic":
        set.italic = true;
        break;
      case "underline":
        set.underline = true;
        break;
      case "link": {
        // The one link rule: a link the editor shows is a link everywhere; anything else is no link.
        const href = normalizeLink(mark.attrs?.href);
        if (href !== null) set.href = href;
        break;
      }
      default:
        throw unsupported();
    }
  }
  return set;
}

function sameMarks(a: MarkSet, b: MarkSet): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.href === b.href;
}

// ── One-line fields ──────────────────────────────────────────────────────────

/** One paragraph of a one-line field as plain text (marks are read for validity, not kept). */
function fieldLine(node: JSONContent, scope: Scope, lineBreak: " " | "\n"): string {
  if (node?.type !== "paragraph" && node?.type !== "heading") throw unsupported();
  let out = "";
  for (const child of node.content ?? []) {
    switch (child?.type) {
      case "text": {
        marksOf(child.marks);
        const text = typeof child.text === "string" ? child.text : "";
        out += cleanCharacters(text.replace(LINE_BREAKS, lineBreak));
        break;
      }
      case "hardBreak":
        out += lineBreak;
        break;
      case "variable":
        marksOf(child.marks);
        out += variableText(child, scope) ?? "";
        break;
      default:
        throw unsupported();
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** JSON the resolver can't place: an unknown node or mark, a node in the wrong spot or missing its content. */
function unsupported(): ResolveError {
  return new ResolveError(DOCUMENT_MESSAGES.unsupported);
}
