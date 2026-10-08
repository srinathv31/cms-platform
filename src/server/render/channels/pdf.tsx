import "server-only";

import { Circle, Document, Link, Page, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { Fragment, type ReactElement, type ReactNode } from "react";
import type { RenderBlock, RenderDoc, RenderTable, RenderTableCell, RenderTableRow } from "@/domain/render/types";
import { MAX_TABLE_COLUMNS } from "@/editor/model/table-grid";
import { GlyphCheck, loadFonts, measure } from "./pdf-fonts";
import { CALLOUT, CONTENT_AREA, CONTENT_WIDTH, HAIRLINE, INK, LIST, SPACE, TABLE, TYPE, lineBox, styles, type TypeSpec } from "./pdf-styles";
import { faceOf, prepareText, type PreparedInline, type PreparedText } from "./pdf-text";

// The PDF channel: a RenderDoc becomes US Letter pages with real, selectable text and embedded
// fonts. Server-only; @react-pdf never reaches the client.
//
// It prints exactly the RenderDoc (docs/render-spec.md, "Channels"): every block, in order; every
// list item's `marker` as given (nothing is renumbered or recomputed here); blank paragraphs as
// blank lines of their type's height; spaces and hard breaks as typed (pdf-text.ts). Before
// layout, every character that will be drawn is checked against the face that draws it; if any
// can't be drawn, the render fails with UnrenderableCharactersError instead of printing boxes.
// The output is a function of the RenderDoc and `createdAt` alone: the same input gives the same
// bytes.
//
// Pagination, steered through react-pdf's page breaker:
//   - Top-level blocks are siblings on one wrapping <Page>, separated by spacer Views. A spacer
//     that meets a page break splits into "the rest of this page" and nothing, so every page
//     starts flush with the top margin (a block's own margin would travel with it, and a bottom
//     margin would push a block that fits onto the next page).
//   - A heading reserves room for the unbreakable start of what follows it (keep with next). A
//     heading with a short intro (3 lines or fewer) before a table, list or callout is one
//     unbreakable group that reserves the start of that block: heading, intro and table head
//     (or first item) land on the same page.
//   - Paragraphs keep at least 2 lines on each side of a break.
//   - Table rows never split, and a table's header row repeats on every page the table spans.
//     Rows have widow and orphan control: at least 2 body rows on each side of a page break, so a
//     table of 3 body rows or fewer moves whole, and a table never starts with its header and a
//     lone row at a page bottom. A sub-header row and rows joined by a rowspan keep with the next.
//   - List items up to 5 lines and callouts up to 200 pt move whole; longer ones split between
//     lines.

export interface PdfOptions {
  /** The render time (the pipeline's `at`): the PDF's creation and modification date, in whole seconds. */
  createdAt: Date;
}

/**
 * The PDF fonts can't draw some of the document's characters. `characters` lists them once each,
 * in the order they first appear. The message never quotes them: one may come from a value, and
 * error messages reach the server log.
 */
export class UnrenderableCharactersError extends Error {
  readonly characters: readonly string[];

  constructor(characters: readonly string[]) {
    super(`The PDF fonts can't draw ${characters.length} of the document's characters.`);
    this.name = "UnrenderableCharactersError";
    this.characters = characters;
  }
}

/** Renders a resolved document to PDF bytes. Throws UnrenderableCharactersError before any layout. */
export async function renderPdf(doc: RenderDoc, options: PdfOptions): Promise<Uint8Array> {
  const createdAt = wholeSeconds(options.createdAt);
  await loadFonts();
  const glyphs = new GlyphCheck();
  const tree = buildDocument(doc, createdAt, glyphs);
  if (glyphs.missing.length > 0) throw new UnrenderableCharactersError(glyphs.missing);
  const buffer = await renderToBuffer(tree);
  return withModDate(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

const REACT_PDF_MOD_KEY = "/ModificationDate";
const PDF_MOD_KEY = "/ModDate".padEnd(REACT_PDF_MOD_KEY.length, " ");

/**
 * react-pdf writes the modification date under a key of its own, /ModificationDate; PDF readers
 * read /ModDate (ISO 32000-1, 14.3.3). This renames the key inside the document information
 * dictionary, padded with spaces to the same length, so no byte offset (and no xref entry) moves.
 * The bytes are react-pdf's own buffer, changed in place.
 */
function withModDate(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const trailer = text.lastIndexOf("\ntrailer\n");
  const info = trailer < 0 ? undefined : /\/Info (\d+) 0 R/.exec(text.slice(trailer))?.[1];
  const start = info === undefined ? -1 : text.indexOf(`\n${info} 0 obj\n`);
  const end = start < 0 ? -1 : text.indexOf("\nendobj", start);
  const key = end < 0 ? -1 : text.indexOf(`\n${REACT_PDF_MOD_KEY} `, start);
  if (key < 0 || key > end) return bytes; // pdf.test.ts pins the /ModDate entry
  bytes.set(Buffer.from(PDF_MOD_KEY, "latin1"), key + 1);
  return bytes;
}

function wholeSeconds(at: Date): Date {
  const ms = at instanceof Date ? at.getTime() : Number.NaN;
  if (!Number.isFinite(ms)) throw new TypeError("renderPdf needs a valid createdAt date.");
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** "UC-4F7K2Q · v2", or "UC-4F7K2Q · Draft" for an unsubmitted draft. */
export function footerLabel(doc: Pick<RenderDoc, "templateId" | "versionNumber">): string {
  return `${doc.templateId} · ${doc.versionNumber === null ? "Draft" : `v${doc.versionNumber}`}`;
}

/** Every digit and word the footer's page numbers can use. */
const PAGE_NUMBER_TEXT = "Page 0123456789 of";

function buildDocument(doc: RenderDoc, createdAt: Date, glyphs: GlyphCheck) {
  const label = footerLabel(doc);
  const blocks = flow(doc.blocks, glyphs);
  // The footer isn't document content: its characters are checked after the body's.
  const footerFace = faceOf(TYPE.footer, PLAIN);
  glyphs.check(label, footerFace);
  glyphs.check(PAGE_NUMBER_TEXT, footerFace);
  return (
    <Document
      title={doc.templateName}
      subject={label}
      creator="Stencil"
      producer="Stencil"
      language="en-US"
      creationDate={createdAt}
      modificationDate={createdAt}
    >
      <Page size="LETTER" style={styles.page}>
        {blocks}
        <View style={styles.footer} fixed>
          <Text>{label}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ── Layout model ─────────────────────────────────────────────────────────────

interface Ctx {
  /** Width of the box the blocks are set in, in points. */
  width: number;
  /** Paragraph type here: body, table or callout. */
  spec: TypeSpec;
  /** Where every drawn character is checked. */
  glyphs: GlyphCheck;
}

/** A block measured for layout: its element and estimates of its height. */
interface Laid {
  block: RenderBlock;
  /** Height of its unbreakable start: what must fit for it to begin on a page. */
  head: number;
  /** Full height. */
  height: number;
  render: (spaceAbove: number, keepAhead: number) => ReactElement;
}

const HEADING_SPEC = { 1: TYPE.h1, 2: TYPE.h2, 3: TYPE.h3 } as const;
const HEADING_STYLE = { 1: styles.h1, 2: styles.h2, 3: styles.h3 } as const;
/** react-pdf's line-breaking "infinity": a run boundary no line may end on. */
const NEVER_BREAK = 10_000;
/**
 * Keep-with-next never reserves more than this. More could exceed a fresh page, and react-pdf would
 * then push the block on again, leaving a blank page behind.
 */
const MAX_KEEP = 0.45 * CONTENT_AREA;

/** The page's own flow. */
function flow(blocks: readonly RenderBlock[], glyphs: GlyphCheck): ReactNode[] {
  const page: Ctx = { width: CONTENT_WIDTH, spec: TYPE.body, glyphs };
  const laid = blocks.map((block) => lay(block, page));
  const out: ReactNode[] = [];
  for (let i = 0; i < laid.length; i += 1) {
    const item = laid[i];
    const key = item.block.id ?? `b${i}`;
    if (item.block.type === "heading" && introduces(laid, i + 1)) {
      // Keep-with-next chain: the heading and its short intro never part, and the pair reserves
      // the start of what the intro introduces, so neither is stranded above a block that moved.
      const intro = laid[i + 1];
      out.push(
        <View key={key} wrap={false} minPresenceAhead={keepAheadOf(laid, i + 1)}>
          {item.render(0, 0)}
          {intro.render(gapBetween(item.block, intro.block), 0)}
        </View>,
      );
      i += 1;
    } else {
      out.push(<Fragment key={key}>{item.render(0, keepAheadOf(laid, i))}</Fragment>);
    }
    const prev = laid[i];
    const next = laid[i + 1];
    if (!next) continue;
    out.push(<View key={`gap${i}`} style={{ paddingTop: gapBetween(prev.block, next.block) }} />);
    if (next.block.type === "table" && repeatsHeader(next.block.rows)) {
      // Never leave a table's (repeating) header row alone at a page bottom.
      out.push(<View key={`keep${i}`} minPresenceAhead={Math.min(MAX_KEEP, next.head + 2)} />);
    }
  }
  return out;
}

/** An intro this short (it moves whole anyway) keeps with the table, list or callout it leads into. */
const INTRO_LINES = 3;

/**
 * Block j is a short intro: a paragraph that never splits, followed by a table, list or callout.
 * A longer intro breaks the chain, so a long lead-in never drags the block after it along.
 */
function introduces(laid: readonly Laid[], j: number): boolean {
  const intro = laid[j];
  const next = laid[j + 1];
  if (!intro || !next || intro.block.type !== "paragraph") return false;
  if (intro.height > INTRO_LINES * lineBox(TYPE.body) + 1 || intro.head < intro.height) return false;
  return next.block.type === "table" || next.block.type === "list" || next.block.type === "callout";
}

/**
 * Keep with next: a heading reserves the gap and head of what follows (through a run of headings,
 * and through a short intro to the start of the table, list or callout it introduces). A short
 * intro reserves the start of what it introduces.
 */
function keepAheadOf(laid: readonly Laid[], i: number): number {
  const type = laid[i].block.type;
  if (!laid[i + 1] || !(type === "heading" || (type === "paragraph" && introduces(laid, i)))) return 0;
  let ahead = 0;
  for (let j = i + 1; j < laid.length; j += 1) {
    ahead += gapBetween(laid[j - 1].block, laid[j].block) + laid[j].head;
    if (laid[j].block.type === "heading") continue;
    if (introduces(laid, j)) ahead += gapBetween(laid[j].block, laid[j + 1].block) + laid[j + 1].head;
    break;
  }
  return Math.min(MAX_KEEP, ahead + lineBox(TYPE.body)); // a line of slack for estimate error
}

/** Space between two top-level blocks. */
function gapBetween(prev: RenderBlock, next: RenderBlock): number {
  if (prev.type === "heading") return SPACE.afterHeading[prev.level];
  if (next.type === "heading") return SPACE.beforeHeading[next.level];
  if (prev.type === "rule" || next.type === "rule") return SPACE.rule;
  if (prev.type === "paragraph" && next.type === "paragraph") return SPACE.paragraph;
  return SPACE.block;
}

function lay(block: RenderBlock, ctx: Ctx): Laid {
  switch (block.type) {
    case "paragraph":
      return layParagraph(block, ctx);
    case "heading":
      return layHeading(block, ctx);
    case "list":
      return layList(block, ctx);
    case "table":
      return layTable(block, ctx);
    case "callout":
      return layCallout(block, ctx);
    case "rule":
      return {
        block,
        head: HAIRLINE,
        height: HAIRLINE,
        render: (above) => <View style={[styles.rule, { marginTop: above }]} />,
      };
  }
}

/** Blocks inside a list item, cell or callout: tighter spacing, no keep rules of their own. */
function stack(laid: readonly Laid[]): ReactNode[] {
  return laid.map((item, i) => <Fragment key={i}>{item.render(i === 0 ? 0 : SPACE.inner, 0)}</Fragment>);
}

const stackHeight = (laid: readonly Laid[]) => laid.reduce((h, item, i) => h + item.height + (i > 0 ? SPACE.inner : 0), 0);

// ── Text ─────────────────────────────────────────────────────────────────────

function inlineNodes(inlines: readonly PreparedInline[]): ReactNode[] {
  return inlines.map((item, i) => {
    if (item.kind === "break") return "\n";
    const marks = {
      ...(item.bold ? { fontWeight: 700 as const } : {}),
      ...(item.italic ? { fontStyle: "italic" as const } : {}),
      ...(item.underline ? { textDecoration: "underline" as const } : {}),
    };
    // A line's leading spaces, indented by the width react-pdf hangs into the margin so they print
    // in place; a space the font has no glyph for, set as no-break spaces with letter spacing that
    // gives its own width (pdf-text.ts). textIndent isn't inherited, so both sit on the innermost
    // <Text> (inside a link's, too).
    const own = {
      ...(item.indent ? { textIndent: item.indent } : {}),
      ...(item.spacing ? { letterSpacing: item.spacing } : {}),
    };
    const hasOwn = Object.keys(own).length > 0;
    if (item.href) {
      return (
        <Link key={i} src={item.href} style={[styles.link, marks]}>
          {hasOwn ? <Text style={own}>{item.text}</Text> : item.text}
        </Link>
      );
    }
    if (!item.bold && !item.italic && !item.underline && !hasOwn) return item.text;
    return (
      <Text key={i} style={{ ...marks, ...own }}>
        {item.text}
      </Text>
    );
  });
}

/** What an empty last line holds: a no-break space (react-pdf sets no line for empty text). */
const LINE_HOLDER = "\u00A0";

/**
 * A paragraph's or heading's lines. react-pdf sets no line for empty text, nor for the empty line
 * after a final hard break, so an empty last line holds LINE_HOLDER: every line the author made
 * takes its line (an empty paragraph one, a paragraph ending with a break one more).
 */
function lineNodes(inlines: readonly PreparedInline[]): ReactNode {
  if (inlines.length === 0) return LINE_HOLDER;
  const nodes = inlineNodes(inlines);
  return inlines[inlines.length - 1]!.kind === "break" ? [...nodes, LINE_HOLDER] : nodes;
}

const textStyle = (spec: TypeSpec) => ({
  fontFamily: spec.family,
  fontSize: spec.size,
  fontWeight: spec.weight,
  lineHeight: spec.lineHeight,
});

function layParagraph(block: Extract<RenderBlock, { type: "paragraph" }>, ctx: Ctx, bold = false): Laid {
  const spec = ctx.spec;
  const content = bold ? block.content.map((r) => (r.type === "text" ? { ...r, bold: true as const } : r)) : block.content;
  const { inlines, lines } = prepareText(content, spec, ctx.width, ctx.glyphs);
  return {
    block,
    // Orphans and widows are 2, so a paragraph of 3 lines or fewer moves as a whole.
    head: (lines <= 3 ? lines : 2) * lineBox(spec),
    height: lines * lineBox(spec),
    render: (above) => (
      <Text style={[textStyle(spec), { marginTop: above }]} orphans={2} widows={2} hyphenationPenalty={NEVER_BREAK}>
        {lineNodes(inlines)}
      </Text>
    ),
  };
}

function layHeading(block: Extract<RenderBlock, { type: "heading" }>, ctx: Ctx): Laid {
  const spec = HEADING_SPEC[block.level];
  const { inlines, lines } = prepareText(block.content, spec, ctx.width, ctx.glyphs);
  const height = lines * lineBox(spec);
  return {
    block,
    head: height,
    height,
    render: (above, keepAhead) => (
      <Text
        style={[HEADING_STYLE[block.level], { marginTop: above }]}
        minPresenceAhead={keepAhead}
        hyphenationPenalty={NEVER_BREAK}
      >
        {lineNodes(inlines)}
      </Text>
    ),
  };
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** Items up to this many lines move to the next page whole instead of splitting. */
const KEEP_ITEM_LINES = 5;
const PLAIN = { bold: false, italic: false } as const;

/** A list item's marker, set as given: whole when it fits its column, otherwise wrapped there, bare. */
function prepareMarker(marker: string, spec: TypeSpec, room: number, glyphs: GlyphCheck): PreparedText {
  const fits = measure(marker, faceOf(spec, PLAIN), spec.size) <= room;
  return prepareText([{ type: "text", text: marker }], spec, fits ? Infinity : room, glyphs);
}

function layList(block: Extract<RenderBlock, { type: "list" }>, ctx: Ctx): Laid {
  const spec = ctx.spec;
  const width = Math.max(0, ctx.width);
  const widest = Math.max(0, ...block.items.map((item) => measure(item.marker, faceOf(spec, PLAIN), spec.size)));
  // Hanging indent: markers right-aligned in their own column, text aligned after it. The column
  // never takes more than half the box (a deep list in a narrow cell keeps room for its text).
  const column = Math.min(Math.max(LIST.minMarker, Math.ceil(widest + LIST.markerGap)), width / 2);
  const gap = Math.min(LIST.markerGap, column / 3);
  // The body gets an explicit width, not flex-grow: nested flex rows that size from their content
  // make react-pdf's layout (Yoga) exponential in the nesting depth.
  const inner: Ctx = { ...ctx, width: width - column };

  const items = block.items.map((item) => {
    const marker = prepareMarker(item.marker, spec, column - gap, ctx.glyphs);
    const laid = item.content.map((b) => lay(b, inner));
    const height = Math.max(marker.lines * lineBox(spec), stackHeight(laid));
    const nested = item.content.some((b) => b.type === "list");
    return { marker, laid, height, keep: !nested && height <= KEEP_ITEM_LINES * lineBox(spec) + 1 };
  });
  const first = items[0];

  return {
    block,
    head: first ? (first.keep ? first.height : Math.max(first.marker.lines * lineBox(spec), first.laid[0]?.head ?? 0)) : 0,
    height: items.reduce((h, item, i) => h + item.height + (i > 0 ? SPACE.listItem : 0), 0),
    render: (above) => (
      <View style={{ marginTop: above }}>
        {items.map((item, i) => (
          <View key={i} style={[styles.listItem, { marginTop: i > 0 ? SPACE.listItem : 0 }]} wrap={!item.keep}>
            <Text style={[textStyle(spec), styles.marker, { width: column, paddingRight: gap }]} hyphenationPenalty={NEVER_BREAK}>
              {inlineNodes(item.marker.inlines)}
            </Text>
            <View style={{ width: inner.width }}>{stack(item.laid)}</View>
          </View>
        ))}
      </View>
    ),
  };
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** The first row is all header cells and there's more below it: it repeats across pages. */
const repeatsHeader = (rows: readonly RenderTableRow[]) =>
  rows.length > 1 && rows[0].cells.length > 0 && rows[0].cells.every((c) => c.header);

interface GridCell {
  /** null: covered by a rowspan from the row above. */
  cell: RenderTableCell | null;
  span: number;
  /** A rowspan continues into the next row: no rule below. */
  open: boolean;
}

/** `value` as an integer from `min` to `max`; anything else is `min`. */
function bounded(value: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, min), Math.max(min, max)) : min;
}

/**
 * Places cells on the table's column grid, `columns` wide. Colspan widens a cell. Rowspan is
 * approximated: the cell's content sits in its first row, and the rows it spans get a blank cell
 * with no rule between. The document check guarantees a rectangular grid of 1–12 columns; the
 * width and spans are still bounded here, so a malformed RenderDoc can't make the grid huge, and a
 * row with more cells than the width still prints every cell (the grid widens by one per cell).
 */
function grid(table: RenderTable): { columns: number; rows: GridCell[][] } {
  const width = bounded(table.columns, 1, MAX_TABLE_COLUMNS);
  const covered: number[] = []; // per column: rows still covered by a rowspan from above
  const out: GridCell[][] = [];
  let columns = 0;
  table.rows.forEach((row, r) => {
    const cells: GridCell[] = [];
    let col = 0;
    const skipCovered = () => {
      while ((covered[col] ?? 0) > 0) {
        covered[col] -= 1;
        cells.push({ cell: null, span: 1, open: covered[col] > 0 });
        col += 1;
      }
    };
    for (const cell of row.cells) {
      skipCovered();
      const span = bounded(cell.colspan, 1, width - col);
      const rowspan = bounded(cell.rowspan, 1, table.rows.length - r);
      for (let k = 0; k < span; k += 1) covered[col + k] = rowspan - 1;
      cells.push({ cell, span, open: rowspan > 1 });
      col += span;
    }
    skipCovered();
    columns = Math.max(columns, col);
    out.push(cells);
  });
  return { columns: Math.max(width, columns), rows: out };
}

/** Body rows that stay on each side of a page break inside a table. */
const TABLE_ORPHANS = 2;
const TABLE_WIDOWS = 2;
/**
 * Rows kept together, and tables that never split, move whole only up to this height. Past it they
 * may part: moving them would leave most of a page empty.
 */
const KEEP_ROWS = 0.5 * CONTENT_AREA;
/** A row taller than this has to split; every other row moves whole. */
const SPLIT_ROW = 0.6 * CONTENT_AREA;

/**
 * Groups a table's body rows into runs that never part across a page break. A break may fall
 * before row i only with TABLE_ORPHANS rows above it and TABLE_WIDOWS rows from it on, and not
 * after a row that keeps with the next. A run taller than KEEP_ROWS falls back to single rows.
 * Returns runs of row indices, in order.
 */
export function keepRuns(rows: readonly { height: number; keepWithNext: boolean }[]): number[][] {
  const n = rows.length;
  const canBreakBefore = (i: number) => i >= TABLE_ORPHANS && n - i >= TABLE_WIDOWS && !rows[i - 1].keepWithNext;
  const runs: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0 || canBreakBefore(i)) runs.push([i]);
    else runs[runs.length - 1].push(i);
  }
  return runs.flatMap((run) =>
    run.length > 1 && run.reduce((h, i) => h + rows[i].height, 0) > KEEP_ROWS ? run.map((i) => [i]) : [run],
  );
}

function layTable(block: Extract<RenderBlock, { type: "table" }>, ctx: Ctx): Laid {
  const spec = TYPE.table;
  const { columns, rows } = grid(block);
  const unit = Math.max(0, ctx.width) / columns; // equal columns, like the editor's fixed table layout
  const repeat = repeatsHeader(block.rows);

  const laidRows = rows.map((cells, r) => {
    const laidCells = cells.map((g, k) => {
      const width = unit * g.span;
      const rules = HAIRLINE * (k === 0 ? 2 : 1);
      // A narrow cell (a table in a list in a 12-column table) gives up padding before text room.
      const padX = Math.min(TABLE.padX, width / 4);
      const cellCtx: Ctx = { ...ctx, width: Math.max(0, width - 2 * padX - rules), spec };
      const header = g.cell?.header === true;
      const laid = (g.cell?.content ?? []).map((b) => (header && b.type === "paragraph" ? layParagraph(b, cellCtx, true) : lay(b, cellCtx)));
      return { g, width, padX, header, laid, height: stackHeight(laid) };
    });
    // Rows overlap by a hairline, so each adds one.
    const height = Math.max(lineBox(spec), ...laidCells.map((c) => c.height)) + 2 * TABLE.padY + HAIRLINE;
    // A sub-header row (all header cells) and a row whose rowspan continues keep with the next.
    const keepWithNext = cells.some((g) => g.open) || (r > 0 && block.rows[r].cells.length > 0 && block.rows[r].cells.every((c) => c.header));
    return { laidCells, height, keepWithNext };
  });

  const bodyStart = repeat ? 1 : 0;
  const runs = keepRuns(laidRows.slice(bodyStart)).map((run) => run.map((i) => i + bodyStart));
  const runHeight = (run: readonly number[]) => run.reduce((h, r) => h + laidRows[r].height, 0);
  const height = laidRows.reduce((h, row) => h + row.height, HAIRLINE);
  // No break is allowed between the body rows (3 or fewer, or all tied): the table never splits.
  const whole = runs.length <= 1 && height <= KEEP_ROWS;

  const rowView = (r: number, afterFirst: boolean) => {
    const row = laidRows[r];
    return (
      <View
        key={r}
        style={[styles.tableRow, afterFirst ? styles.rowAfterFirst : {}]}
        wrap={row.height > SPLIT_ROW}
        // Pass `fixed` only when true: react-pdf's page breaker skips any node that merely
        // has the prop, so fixed={false} would let a row split.
        {...(repeat && r === 0 && !whole ? { fixed: true } : {})}
      >
        {row.laidCells.map((c, k) => (
          <View
            key={k}
            style={[
              styles.cell,
              { width: c.width, paddingHorizontal: c.padX },
              k === 0 ? styles.firstCell : {},
              c.header ? styles.headerCell : {},
              c.g.cell === null ? { borderTopWidth: 0 } : {},
              c.g.open ? { borderBottomWidth: 0 } : {},
            ]}
          >
            {stack(c.laid)}
          </View>
        ))}
      </View>
    );
  };

  return {
    block,
    // What must fit for the table to start on a page: the header row and the first run of rows.
    head: whole ? height : (repeat ? laidRows[0].height : 0) + runHeight(runs[0] ?? []) + HAIRLINE,
    height,
    render: (above) => (
      <View style={{ marginTop: above }} wrap={!whole}>
        {repeat && rowView(0, false)}
        {runs.map((run) =>
          run.length === 1 ? (
            rowView(run[0], run[0] > 0)
          ) : (
            // A run moves to the next page whole, under the repeated header.
            <View key={`run${run[0]}`} wrap={false} style={run[0] > 0 ? styles.rowAfterFirst : {}}>
              {run.map((r, i) => rowView(r, i > 0))}
            </View>
          ),
        )}
      </View>
    ),
  };
}

// ── Callouts ─────────────────────────────────────────────────────────────────

/** Callouts up to this tall (points) move to the next page whole. */
const KEEP_CALLOUT = 200;

function layCallout(block: Extract<RenderBlock, { type: "callout" }>, ctx: Ctx): Laid {
  const spec = TYPE.callout;
  const inner: Ctx = { ...ctx, width: Math.max(0, ctx.width - CALLOUT.padLeft - CALLOUT.padRight - 2 * HAIRLINE), spec };
  const laid = block.content.map((b) => lay(b, inner));
  const height = stackHeight(laid) + CALLOUT.padTop + CALLOUT.padBottom + 2 * HAIRLINE;
  const keep = height <= KEEP_CALLOUT;
  const iconTop = CALLOUT.padTop + (lineBox(spec) - CALLOUT.iconSize) / 2;
  return {
    block,
    head: keep ? height : CALLOUT.padTop + 2 * lineBox(spec),
    height,
    render: (above) => (
      <View style={[styles.callout, { marginTop: above }]} wrap={!keep}>
        {infoGlyph(iconTop)}
        {stack(laid)}
      </View>
    ),
  };
}

/** Lucide's "info" glyph as vectors, like the editor's callout (the web callout draws the same). */
function infoGlyph(top: number) {
  return (
    <Svg viewBox="0 0 24 24" style={[styles.calloutIcon, { top }]}>
      <Circle cx="12" cy="12" r="10" stroke={INK.calloutGlyph} strokeWidth={1.9} fill="none" />
      <Path d="M12 16v-4" stroke={INK.calloutGlyph} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M12 8h.01" stroke={INK.calloutGlyph} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
