import "server-only";

import { Circle, Document, Link, Page, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { Fragment, type ReactElement, type ReactNode } from "react";
import type { RenderBlock, RenderDoc, RenderTableCell, RenderTableRow } from "@/domain/render/types";
import { loadFonts, measure } from "./pdf-fonts";
import { CALLOUT, CONTENT_AREA, CONTENT_WIDTH, HAIRLINE, INK, LIST, SPACE, TABLE, TYPE, lineBox, styles, type TypeSpec } from "./pdf-styles";
import { prepareText, type PreparedInline } from "./pdf-text";

// The PDF channel: a RenderDoc becomes US Letter pages with real, selectable text and embedded
// fonts. Server-only; @react-pdf never reaches the client.
//
// Pagination, steered through react-pdf's page breaker:
//   - Top-level blocks are siblings on one wrapping <Page>, separated by spacer Views. A spacer
//     that meets a page break splits into "the rest of this page" and nothing, so every page
//     starts flush with the top margin (a block's own margin would travel with it, and a bottom
//     margin would push a block that fits onto the next page).
//   - A heading reserves room for the unbreakable start of what follows it (keep with next).
//   - Paragraphs keep at least 2 lines on each side of a break.
//   - Table rows never split, and a table's header row repeats on every page the table spans.
//     Rows have widow and orphan control: at least 2 body rows on each side of a page break, so a
//     table of 3 body rows or fewer moves whole, and a table never starts with its header and a
//     lone row at a page bottom. A sub-header row and rows joined by a rowspan keep with the next.
//   - List items up to 5 lines and callouts up to 200 pt move whole; longer ones split between
//     lines.

/** Renders a resolved document to PDF bytes. */
export async function renderPdf(doc: RenderDoc): Promise<Uint8Array> {
  await loadFonts();
  const buffer = await renderToBuffer(buildDocument(doc));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** "UC-4F7K2Q · v2", or "UC-4F7K2Q · Draft" for an unsubmitted draft. */
export function footerLabel(doc: Pick<RenderDoc, "templateId" | "versionNumber">): string {
  return `${doc.templateId} · ${doc.versionNumber === null ? "Draft" : `v${doc.versionNumber}`}`;
}

function buildDocument(doc: RenderDoc) {
  const label = footerLabel(doc);
  return (
    <Document title={doc.templateName} subject={label} creator="UCOMP" producer="UCOMP" language="en-US">
      <Page size="LETTER" style={styles.page}>
        {flow(doc.blocks)}
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
  /** List nesting depth, for markers. */
  depth: number;
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

const PAGE_CTX: Ctx = { width: CONTENT_WIDTH, spec: TYPE.body, depth: 0 };
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
function flow(blocks: readonly RenderBlock[]): ReactNode[] {
  const laid = blocks.map((block) => lay(block, PAGE_CTX));
  const out: ReactNode[] = [];
  laid.forEach((item, i) => {
    const next = laid[i + 1];
    out.push(<Fragment key={item.block.id ?? `b${i}`}>{item.render(0, keepAheadOf(laid, i))}</Fragment>);
    if (!next) return;
    out.push(<View key={`gap${i}`} style={{ paddingTop: gapBetween(item.block, next.block) }} />);
    if (next.block.type === "table" && repeatsHeader(next.block.rows)) {
      // Never leave a table's (repeating) header row alone at a page bottom.
      out.push(<View key={`keep${i}`} minPresenceAhead={Math.min(MAX_KEEP, next.head + 2)} />);
    }
  });
  return out;
}

/** Keep with next: a heading reserves the gap and head of what follows (through a run of headings). */
function keepAheadOf(laid: readonly Laid[], i: number): number {
  if (laid[i].block.type !== "heading" || !laid[i + 1]) return 0;
  let ahead = 0;
  for (let j = i + 1; j < laid.length; j += 1) {
    ahead += gapBetween(laid[j - 1].block, laid[j].block) + laid[j].head;
    if (laid[j].block.type !== "heading") break;
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
    if (item.href) {
      return (
        <Link key={i} src={item.href} style={[styles.link, marks]}>
          {item.text}
        </Link>
      );
    }
    if (!item.bold && !item.italic && !item.underline) return item.text;
    return (
      <Text key={i} style={marks}>
        {item.text}
      </Text>
    );
  });
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
  const { inlines, lines } = prepareText(content, spec, ctx.width);
  return {
    block,
    // Orphans and widows are 2, so a paragraph of 3 lines or fewer moves as a whole.
    head: (lines <= 3 ? lines : 2) * lineBox(spec),
    height: lines * lineBox(spec),
    render: (above) => (
      <Text style={[textStyle(spec), { marginTop: above }]} orphans={2} widows={2} hyphenationPenalty={NEVER_BREAK}>
        {inlines.length === 0 ? " " : inlineNodes(inlines)}
      </Text>
    ),
  };
}

function layHeading(block: Extract<RenderBlock, { type: "heading" }>, ctx: Ctx): Laid {
  const spec = HEADING_SPEC[block.level];
  const { inlines, lines } = prepareText(block.content, spec, ctx.width);
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
        {inlines.length === 0 ? " " : inlineNodes(inlines)}
      </Text>
    ),
  };
}

// ── Lists ────────────────────────────────────────────────────────────────────

const BULLETS = ["•", "◦", "▪"]; // • ◦ ▪, like the editor's disc, circle, square

function marker(ordered: boolean, depth: number, n: number): string {
  if (!ordered) return BULLETS[depth % 3];
  if (depth % 3 === 1) return `${alpha(n)}.`;
  if (depth % 3 === 2) return `${roman(n)}.`;
  return `${n}.`;
}

function alpha(n: number): string {
  let s = "";
  for (let x = Math.max(1, n); x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
  return s;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function roman(n: number): string {
  let x = Math.max(1, n);
  let s = "";
  for (const [value, digits] of ROMAN) {
    for (; x >= value; x -= value) s += digits;
  }
  return s;
}

/** Items up to this many lines move to the next page whole instead of splitting. */
const KEEP_ITEM_LINES = 5;

function layList(block: Extract<RenderBlock, { type: "list" }>, ctx: Ctx): Laid {
  const spec = ctx.spec;
  const markers = block.items.map((_, i) => marker(block.ordered, ctx.depth, block.start + i));
  const widest = Math.max(0, ...markers.map((m) => measure(m, { family: spec.family, weight: 400, italic: false }, spec.size)));
  // Hanging indent: markers right-aligned in their own column, text aligned after it.
  const column = Math.max(LIST.minMarker, Math.ceil(widest + LIST.markerGap));
  const inner: Ctx = { width: ctx.width - column, spec, depth: ctx.depth + 1 };

  const items = block.items.map((item) => {
    const laid = item.content.map((b) => lay(b, inner));
    const height = stackHeight(laid);
    const nested = item.content.some((b) => b.type === "list");
    return { laid, height, keep: !nested && height <= KEEP_ITEM_LINES * lineBox(spec) + 1 };
  });
  const first = items[0];

  return {
    block,
    head: first ? (first.keep ? first.height : first.laid[0]?.head ?? 0) : 0,
    height: items.reduce((h, item, i) => h + item.height + (i > 0 ? SPACE.listItem : 0), 0),
    render: (above) => (
      <View style={{ marginTop: above }}>
        {items.map((item, i) => (
          <View key={i} style={[styles.listItem, { marginTop: i > 0 ? SPACE.listItem : 0 }]} wrap={!item.keep}>
            <Text style={[textStyle(spec), styles.marker, { width: column, paddingRight: LIST.markerGap }]}>{markers[i]}</Text>
            <View style={styles.listBody}>{stack(item.laid)}</View>
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

/**
 * Places cells on a column grid. Colspan widens a cell. Rowspan is approximated: the cell's
 * content sits in its first row, and the rows it spans get a blank cell with no rule between.
 */
function grid(rows: readonly RenderTableRow[]): { columns: number; rows: GridCell[][] } {
  const covered: number[] = []; // per column: rows still covered by a rowspan from above
  const out: GridCell[][] = [];
  let columns = 0;
  for (const row of rows) {
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
      const span = Math.max(1, cell.colspan);
      const rowspan = Math.max(1, cell.rowspan);
      for (let k = 0; k < span; k += 1) covered[col + k] = rowspan - 1;
      cells.push({ cell, span, open: rowspan > 1 });
      col += span;
    }
    skipCovered();
    columns = Math.max(columns, col);
    out.push(cells);
  }
  return { columns: Math.max(1, columns), rows: out };
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
  const { columns, rows } = grid(block.rows);
  const unit = ctx.width / columns; // equal columns, like the editor's fixed table layout
  const repeat = repeatsHeader(block.rows);

  const laidRows = rows.map((cells, r) => {
    const laidCells = cells.map((g, k) => {
      const width = unit * g.span;
      const rules = HAIRLINE * (k === 0 ? 2 : 1);
      const cellCtx: Ctx = { width: width - 2 * TABLE.padX - rules, spec, depth: 0 };
      const header = g.cell?.header === true;
      const laid = (g.cell?.content ?? []).map((b) => (header && b.type === "paragraph" ? layParagraph(b, cellCtx, true) : lay(b, cellCtx)));
      return { g, width, header, laid, height: stackHeight(laid) };
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
              { width: c.width },
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
  const inner: Ctx = { width: ctx.width - CALLOUT.padLeft - CALLOUT.padRight - 2 * HAIRLINE, spec, depth: 0 };
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
