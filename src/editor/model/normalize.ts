// Save normalization (docs/render-spec.md §3): the one function that turns what paste, import or
// JSON delivered into a document the editor and every channel see the same way. Pure TypeScript on
// TipTap JSON, used by the editor's paste (extensions/content-limits.ts), the import
// (src/server/import/convert.ts) and the autosave (src/server/drafts/apply-patch.ts).
//
//   heading level 4, 5 or 6                → 3
//   table cell `align` / `colwidth`         → removed
//   orderedList `type` (TipTap's own)       → removed (numbering is markerFormat / markerDelimiter)
//   orderedList `start`, on paste only      → brought into 0–9999 (below 0 → 0, above → 9999), so the
//                                             editor shows the number every channel will print; a
//                                             stored or API document's out-of-range start is refused
//   a tab                                   → one space
//   CR LF, CR, LF, U+2028, U+2029 in text   → a hardBreak
//   other control characters                → removed (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F–U+009F)
//   invisible characters                    → removed (links.ts, INVISIBLE_CHARACTERS: soft hyphen,
//                                             zero-width and bidirectional marks, variation selectors, …)
//   a link mark                             → its href normalized (links.ts), or the mark removed (text kept)
//   a heading in a table cell               → a paragraph with the same content
//   a callout in a table cell               → its paragraphs
//   a rule in a table cell                  → an empty paragraph (it held no text)
//   a table in a table cell                 → its cells' content, in reading order
//     (in a cell, or in a list item anywhere inside a cell: a cell holds paragraphs and lists at
//     every depth; the editor applies the same conversion, `cellBlocks`, as soon as a drop or any
//     other change leaves one of these in a cell)
//   a ragged table                          → empty cells added at row ends (as the editor's table plugin does)
//   a table wider than 12 columns           → consecutive tables of at most 12 columns (1–12, 13–24, …),
//                                             every row in each; nothing is cut (up to 1,000 columns:
//                                             a wider one is left for the check)
//
// Nothing is dropped: content that can't stay where it is is moved or converted. What can't be
// fixed without guessing (an unknown node, a bad span, a list start of 20000, lists nested ten deep)
// is left for the document check (schema-check.ts), which refuses it with a message.
// Normalizing twice gives the same result.
//
// One-line fields (email subject and preheader) take `normalizeField`: the same text rules, but a
// line break (character or hardBreak) becomes one space, and marks are removed (the field has none).

import { LINE_BREAKS, cleanCharacters } from "./characters";
import { normalizeLink } from "./links";
import { LIST_START_MAX, LIST_START_MIN } from "./list-markers";
import { MAX_TABLE_COLUMNS, linesUp, tableGrid, type GridCell } from "./table-grid";
import { isNode, type JSONContent } from "./types";

/** Heading levels the editor offers; 4–6 are saved as the last of these. */
export const HEADING_LEVELS = [1, 2, 3] as const;
export const MAX_HEADING_LEVEL = 3;

/**
 * What a table cell may hold (rule 24): paragraphs and lists, at every depth (a list item inside a
 * cell holds only these too).
 */
export const CELL_BLOCKS: readonly string[] = ["paragraph", "bulletList", "orderedList"];

const CELLS = new Set(["tableCell", "tableHeader"]);

const TEXTBLOCKS = new Set(["paragraph", "heading"]);

/**
 * Where a node sits in a pasted slice. A node on an open edge continues into the document around
 * the paste, so only its text and attributes are normalized (its structure belongs to the target).
 */
interface Edges {
  openStart: number;
  openEnd: number;
}

interface Options {
  /** A one-line field: breaks become spaces, marks go. */
  field: boolean;
  /** A paste into the editor: what the author will see is brought inside the limits (a list's start). */
  paste?: boolean;
}

const CLOSED: Edges = { openStart: 0, openEnd: 0 };

/** The body document, normalized (a new object; the input is not changed). */
export function normalizeDocument(doc: JSONContent): JSONContent {
  return normalizeNode(doc, CLOSED, { field: false })[0] ?? doc;
}

/** A one-line field (email subject, preheader), normalized. */
export function normalizeField(doc: JSONContent): JSONContent {
  return normalizeNode(doc, CLOSED, { field: true })[0] ?? doc;
}

/**
 * A pasted fragment's nodes (a ProseMirror slice as JSON), normalized. `openStart` / `openEnd` are
 * the slice's: nodes on an open edge keep their structure, so the slice still fits where it lands.
 * `inCell`: the paste lands inside a table cell (at any depth), so its blocks become what a cell
 * holds. A table is the exception: the table plugin pastes it as cells into the grid.
 */
export function normalizeFragment(nodes: readonly JSONContent[], edges: Edges, field = false, inCell = false): JSONContent[] {
  const out = normalizeChildren(nodes, edges, { field, paste: true }, null, inCell);
  return inCell ? cellContent(out, edges, { keepTables: true, fill: false }) : out;
}

/**
 * One block that sits inside a table cell (in a list item there) but that a cell can't hold, as the
 * save turns it into what a cell can (rule 24): a heading → a paragraph, a callout → its paragraphs, a
 * rule → an empty paragraph, a table → its cells' content. The editor applies it to whatever a drop
 * (or any other change) leaves in a cell, so the screen shows what will be stored and rendered.
 */
export function cellBlocks(block: JSONContent): JSONContent[] {
  return cellContent(normalizeNode(block, CLOSED, { field: false }, null, true), CLOSED, { keepTables: false, fill: false });
}

// ── Nodes ────────────────────────────────────────────────────────────────────

function normalizeChildren(
  nodes: readonly JSONContent[],
  edges: Edges,
  options: Options,
  parent: string | null,
  inCell: boolean,
): JSONContent[] {
  const last = nodes.length - 1;
  const out: JSONContent[] = [];
  nodes.forEach((node, i) => {
    if (!isNode(node)) {
      out.push(node); // not a node: the check refuses it
      return;
    }
    const childEdges: Edges = {
      openStart: i === 0 ? edges.openStart : 0,
      openEnd: i === last ? edges.openEnd : 0,
    };
    out.push(...normalizeNode(node, childEdges, options, parent, inCell));
  });
  return out;
}

/**
 * One node in, zero or more out (text splits at line breaks or empties; a split table is several).
 * `inCell`: the node sits inside a table cell, at any depth.
 */
function normalizeNode(node: JSONContent, edges: Edges, options: Options, parent: string | null = null, inCell = false): JSONContent[] {
  if (!isNode(node)) return [node];
  if (node.type === "text") return normalizeText(node, options);
  if (node.type === "hardBreak" && options.field) return [{ type: "text", text: " " }];
  if (node.type === "variable") return [withMarks(node, normalizeMarks(node.marks, options))];

  const open = edges.openStart > 0 || edges.openEnd > 0;
  const inner: Edges = { openStart: Math.max(edges.openStart - 1, 0), openEnd: Math.max(edges.openEnd - 1, 0) };
  const childrenInCell = inCell || CELLS.has(node.type ?? "");
  const children = Array.isArray(node.content) ? normalizeChildren(node.content, inner, options, node.type ?? null, childrenInCell) : undefined;
  let next: JSONContent = { ...node, ...(children ? { content: children } : {}) };
  if (node.marks) next = withMarks(next, normalizeMarks(node.marks, options));

  switch (node.type) {
    case "heading":
      next = withAttrs(next, headingAttrs(next.attrs));
      break;
    case "orderedList":
      next = withAttrs(next, without(next.attrs, ["type"]));
      if (options.paste) next = withAttrs(next, pastedStart(next.attrs));
      break;
    case "tableCell":
    case "tableHeader":
      next = withAttrs(next, without(next.attrs, ["align", "colwidth"]));
      next = { ...next, content: cellContent(next.content ?? [], inner) };
      break;
    case "listItem":
      if (inCell) next = { ...next, content: cellContent(next.content ?? [], inner) };
      break;
    case "table":
      if (!open) return normalizeTable(next);
      break;
  }

  // A text block whose text was all removed (control or invisible characters) has no `content`.
  if (TEXTBLOCKS.has(node.type ?? "") && children && children.length === 0) next = withoutKey(next, "content");

  // A field's paragraphs join into one line.
  if (options.field && node.type === "doc" && parent === null) next = joinFieldParagraphs(next);
  return [next];
}

// ── Text and marks ───────────────────────────────────────────────────────────

function normalizeText(node: JSONContent, options: Options): JSONContent[] {
  if (typeof node.text !== "string") return [node]; // the check refuses it
  const marks = normalizeMarks(node.marks, options);
  let text = cleanCharacters(node.text);
  if (options.field) text = text.replace(LINE_BREAKS, " ");
  const out: JSONContent[] = [];
  text.split(LINE_BREAKS).forEach((part, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (part) out.push(withMarks({ ...node, text: part }, marks));
  });
  return out;
}

type Marks = JSONContent["marks"];

function normalizeMarks(marks: Marks, options: Options): Marks {
  if (!Array.isArray(marks)) return marks;
  if (options.field) return undefined;
  const out: NonNullable<Marks> = [];
  for (const mark of marks) {
    if (!isNode(mark) || mark.type !== "link") {
      out.push(mark);
      continue;
    }
    const href = normalizeLink(mark.attrs?.href);
    if (href !== null) out.push({ ...mark, attrs: { ...mark.attrs, href } });
  }
  return out;
}

function withMarks<T extends JSONContent>(node: T, marks: Marks): T {
  if (marks && marks.length) return { ...node, marks };
  return withoutKey(node, "marks");
}

function joinFieldParagraphs(doc: JSONContent): JSONContent {
  const blocks = doc.content ?? [];
  if (blocks.length < 2 || !blocks.every((b) => isNode(b) && b.type === "paragraph")) return doc;
  const inline: JSONContent[] = [];
  for (const block of blocks) {
    if (!block.content?.length) continue;
    if (inline.length) inline.push({ type: "text", text: " " });
    inline.push(...block.content);
  }
  const first = blocks[0];
  return { ...doc, content: [inline.length ? { ...first, content: inline } : withoutKey(first, "content")] };
}

// ── Attributes ───────────────────────────────────────────────────────────────

type Attrs = Record<string, unknown> | undefined;

function headingAttrs(attrs: Attrs): Attrs {
  const level = attrs?.level;
  return typeof level === "number" && level > MAX_HEADING_LEVEL && level <= 6 ? { ...attrs, level: MAX_HEADING_LEVEL } : attrs;
}

/**
 * A pasted list's `start` inside 0–9999 (decision D5): below → 0, above → 9999, a fraction cut to a
 * whole number, and a number that isn't one (the clipboard's `start="x"` reads as NaN) → 1, the
 * default. Absent, null and non-numbers are left as they are.
 */
function pastedStart(attrs: Attrs): Attrs {
  const start = attrs?.start;
  if (typeof start !== "number") return attrs;
  const fixed = Number.isNaN(start) ? 1 : Math.min(Math.max(Math.trunc(start), LIST_START_MIN), LIST_START_MAX);
  return Object.is(fixed, start) ? attrs : { ...attrs, start: fixed };
}

function without(attrs: Attrs, keys: readonly string[]): Attrs {
  if (!attrs || !keys.some((key) => key in attrs)) return attrs;
  const out = { ...attrs };
  for (const key of keys) delete out[key];
  return out;
}

function withAttrs(node: JSONContent, attrs: Attrs): JSONContent {
  if (attrs === node.attrs) return node;
  return attrs && Object.keys(attrs).length ? { ...node, attrs } : withoutKey(node, "attrs");
}

function withoutKey<T extends JSONContent>(node: T, key: keyof JSONContent): T {
  if (!(key in node)) return node;
  const out = { ...node };
  delete out[key];
  return out;
}

// ── Table cells: paragraphs and lists only ───────────────────────────────────

const emptyParagraph = (id?: unknown): JSONContent =>
  typeof id === "string" && id ? { type: "paragraph", attrs: { id } } : { type: "paragraph" };

interface CellContentOptions {
  /** Keep a table as it is (a paste into a cell: the table plugin pastes its cells into the grid). */
  keepTables: boolean;
  /** Give content left with nothing one empty paragraph (a cell or a list item can't be empty). */
  fill: boolean;
}

/**
 * The blocks of a cell, or of a list item inside a cell, with everything a cell can't hold converted
 * or moved into it as paragraphs and lists. A block on an open edge of a pasted slice (`edges`) is
 * kept as it is: it continues into the document where it lands. Lists are already converted inside
 * (normalizeNode does their items first).
 */
function cellContent(
  blocks: readonly JSONContent[],
  edges: Edges = CLOSED,
  options: CellContentOptions = { keepTables: false, fill: true },
): JSONContent[] {
  const out: JSONContent[] = [];
  const last = blocks.length - 1;
  for (const [i, block] of blocks.entries()) {
    if (!isNode(block) || (i === 0 && edges.openStart > 0) || (i === last && edges.openEnd > 0)) {
      out.push(block);
      continue;
    }
    switch (block.type) {
      case "heading": {
        const id = block.attrs?.id;
        out.push({
          type: "paragraph",
          ...(typeof id === "string" && id ? { attrs: { id } } : {}),
          ...(block.content?.length ? { content: block.content } : {}),
        });
        break;
      }
      case "callout":
        out.push(...cellContent(block.content ?? []));
        break;
      case "horizontalRule":
        out.push(emptyParagraph(block.attrs?.id));
        break;
      case "table":
        if (options.keepTables) {
          out.push(block);
          break;
        }
        for (const row of block.content ?? []) {
          for (const cell of row?.content ?? []) out.push(...cellContent(cell?.content ?? []));
        }
        break;
      default:
        out.push(block); // paragraphs and lists; anything unknown is the check's to refuse
    }
  }
  return out.length || !options.fill || edges.openStart > 0 || edges.openEnd > 0 ? out : [emptyParagraph()];
}

// ── Tables: ragged rows, more than 12 columns ────────────────────────────────

/**
 * The widest table normalization pads and splits. Wider ones (a colspan of a million, from a .docx
 * or JSON) would be padded and split into tables of empty cells, or never finish: they are left for
 * the check, which refuses them (at most 12 columns).
 */
export const MAX_SPLIT_COLUMNS = 1000;

function normalizeTable(table: JSONContent): JSONContent[] {
  const grid = tableGrid(table);
  // Spans that aren't integers, overlaps and overruns can't be fixed without guessing: the check refuses them.
  if (grid.badSpan || grid.collision || grid.overlongRowspan || grid.width === 0 || grid.width > MAX_SPLIT_COLUMNS) return [table];

  const rows = table.content ?? [];
  const padded = grid.missing.some((n) => n > 0)
    ? {
        ...table,
        content: rows.map((row, r) => {
          const add = grid.missing[r];
          if (!add) return row;
          const kind = row.content?.[0]?.type === "tableHeader" ? "tableHeader" : "tableCell";
          const fill = Array.from({ length: add }, (): JSONContent => ({ type: kind, content: [emptyParagraph()] }));
          return { ...row, content: [...(row.content ?? []), ...fill] };
        }),
      }
    : table;

  if (grid.width <= MAX_TABLE_COLUMNS) return [padded];
  const full = tableGrid(padded);
  if (!linesUp(full)) return [padded];
  return splitColumns(padded, full.rows, full.width);
}

/**
 * A table of more than 12 columns as consecutive tables of at most 12 (columns 1–12, 13–24, …),
 * every row in each. A cell spanning a boundary keeps its content in the first table it starts in
 * and leaves an empty cell of the remaining span in the next, so the rows still line up.
 */
function splitColumns(table: JSONContent, rows: readonly GridCell[][], width: number): JSONContent[] {
  const rowNodes = table.content ?? [];
  const tables: JSONContent[] = [];
  for (let from = 0; from < width; from += MAX_TABLE_COLUMNS) {
    const to = Math.min(from + MAX_TABLE_COLUMNS, width);
    const content = rows.map((cells, r) => ({
      ...rowNodes[r],
      content: cells
        .filter((cell) => cell.column < to && cell.column + cell.colspan > from)
        .map((cell): JSONContent => {
          const span = Math.min(cell.column + cell.colspan, to) - Math.max(cell.column, from);
          const starts = cell.column >= from;
          const node: JSONContent = { ...cell.node, content: starts ? cell.node.content : [emptyParagraph()] };
          return span === cell.colspan ? node : withAttrs(node, { ...cell.node.attrs, colspan: span });
        }),
    }));
    const attrs = from === 0 ? table.attrs : without(table.attrs, ["id"]);
    tables.push(withAttrs({ ...table, content }, attrs));
  }
  return tables;
}
