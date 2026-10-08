// PDF -> stable, diffable data, read with pdfjs-dist in plain Node. No layout engine and no
// rendering: only what the PDF itself says (text runs with positions, link annotations, metadata).
//
// Two outputs:
//   pdfLayoutText(x)   the font-DEPENDENT golden (`node/pdf.layout.txt`): line wraps, page breaks, gaps.
//   pdfContentBlocks   the font-INDEPENDENT content (blocks of text, list markers included, and each
//                      table cell's text in reading order) that the parity test compares with the
//                      other channels.
//
// Table cells are found from the rules the adapter draws: every cell strokes its right edge (the
// first of a row its left edge too) as a vertical line the height of the row, so the vertical
// strokes of one row, left to right, bound its cells. Text inside a cell's box is that cell's.
//
// Everything that is geometry is isolated in PdfProfile, so another engine (a Java PDF library) or
// another font can be read with its own numbers.

// pdf.js has no useful types for the parts used here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface PdfProfile {
  /** A line whose baseline is below this (pt from the bottom edge) is the page footer. */
  footerBelowY: number;
  /** On a table line, two items further apart than this many font sizes are different cells. */
  cellGapEm: number;
  /** A baseline step larger than this many font sizes starts a new block (wrapped lines step ~1.45). */
  blockGapEm: number;
  /**
   * The baseline step, in font sizes, from one body paragraph's line to the next paragraph's. A blank
   * paragraph adds one more of these: k blank paragraphs between two paragraphs make (k + 1) steps.
   */
  paragraphStepEm: number;
  /** Body text size in pt. */
  bodySize: number;
  /** Table text size in pt: only on lines of this size are wide gaps column gaps (a run of typed spaces is a wide gap too). */
  tableSize: number;
  /** Heading sizes in pt (h1, h2, h3); lines at exactly these sizes are headings. */
  headingSizes: [number, number, number];
  /** Left text edge of the page, pt; indentation is reported in steps of `indentStep` from it. */
  marginX: number;
  indentStep: number;
  /** A vertical stroke at least this tall (pt) is a table cell's edge; shorter ones belong to glyphs (the callout's (i)). */
  cellEdgeMinHeight: number;
}

/** The numbers of the Node adapter (pdf-styles.ts): US Letter, 72 pt margins. */
export const NODE_PROFILE: PdfProfile = {
  footerBelowY: 68,
  cellGapEm: 0.9,
  blockGapEm: 1.6,
  paragraphStepEm: 2.12,
  bodySize: 10.5,
  tableSize: 9.5,
  headingSizes: [19, 15, 11],
  marginX: 72,
  indentStep: 6,
  cellEdgeMinHeight: 8,
};

export interface PdfLine {
  y: number;
  x: number;
  size: number;
  /** Cells on the line (usually one). */
  cells: { x: number; text: string }[];
  text: string;
  footer: boolean;
}

export interface PdfLink {
  url: string;
  text: string;
}

/** A table cell's box (pt, y up) and the text inside it, its lines joined with JOIN_MARK / WRAP_MARK. */
export interface PdfCell {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  text: string;
}

export interface PdfPage {
  lines: PdfLine[];
  links: PdfLink[];
  /** Table cells, in reading order: top to bottom by row, left to right. */
  cells: PdfCell[];
}

export interface PdfExtract {
  pageCount: number;
  /** Document info: Title, Subject, Creator, Producer, Language, CreationDate and ModDate (ISO) when present. */
  info: Record<string, string>;
  pages: PdfPage[];
  /** Number of U+0000 characters in the text: glyphs the font could not draw. */
  missingGlyphs: number;
}

interface Run {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

/** Follows a hyphen that ended a wrapped line (the hyphen may be real, or one a line breaker inserted). */
export const WRAP_MARK = "\u0001";
/** Where two wrapped lines were joined: a space in the source, or nothing (a long URL cut at a separator). */
export const JOIN_MARK = "\u0003";

const NBSP = new RegExp("\u00a0", "g");
const squash = (s: string) => s.replace(NBSP, " ").replace(/[ \t]+/g, " ").trim();

let pdfjsPromise: Promise<Any> | null = null;
function pdfjs(): Promise<Any> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/** "D:20270304120000Z" (what pdf.js reports) -> "2027-03-04T12:00:00.000Z". */
export function pdfDateToIso(raw: string): string {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:Z|([+-])(\d{2})'?(\d{2})'?)?$/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offset = sign ? (sign === "+" ? 1 : -1) * (Number(oh) * 60 + Number(om)) * 60_000 : 0;
  return new Date(utc - offset).toISOString();
}

// ── Glyph runs (positions from the operator list, to find the text under a link) ─────────────────

type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const toMatrix = (a: Any): Matrix => [a[0], a[1], a[2], a[3], a[4], a[5]];

function glyphRuns(list: Any, OPS: Any): Run[] {
  const runs: Run[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let tm: Matrix = [1, 0, 0, 1, 0, 0];
  let size = 0;
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push([...ctm] as Matrix);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(toMatrix(args), ctm);
    else if (fn === OPS.beginText) tm = [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.setTextMatrix) tm = toMatrix(args.length === 1 && typeof args[0] === "object" ? args[0] : args);
    else if (fn === OPS.setFont) size = args[1];
    else if (fn === OPS.showText) {
      const m = multiply(tm, ctm);
      let text = "";
      let advance = 0;
      for (const g of args[0]) {
        if (typeof g === "number") advance -= (g / 1000) * size;
        else {
          text += g.unicode ?? "";
          advance += (g.width / 1000) * size;
        }
      }
      runs.push({ text, x: m[4], y: m[5], size: Math.abs(m[3] * size) || size, width: advance * m[0] });
    }
  }
  return runs;
}

/** Table cell boxes on a page: per row (vertical strokes of the same height), the spans between neighbouring strokes. */
function cellBoxes(list: Any, OPS: Any, profile: PdfProfile): Omit<PdfCell, "text">[] {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const rows = new Map<string, { y1: number; y2: number; xs: number[] }>();
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push([...ctm] as Matrix);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(toMatrix(args), ctm);
    else if (fn === OPS.constructPath && (args[0] === OPS.stroke || args[0] === OPS.closeStroke) && args[2]) {
      const [minX, minY, maxX, maxY] = args[2] as number[];
      const at = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]] as const;
      const [ax, ay] = at(minX!, minY!);
      const [bx, by] = at(maxX!, maxY!);
      const y1 = Math.min(ay, by);
      const y2 = Math.max(ay, by);
      if (Math.abs(bx - ax) > 0.01 || y2 - y1 < profile.cellEdgeMinHeight) continue;
      const key = `${y1.toFixed(1)}:${y2.toFixed(1)}`;
      const row = rows.get(key) ?? { y1, y2, xs: [] };
      row.xs.push((ax + bx) / 2);
      rows.set(key, row);
    }
  }
  const boxes: Omit<PdfCell, "text">[] = [];
  for (const { y1, y2, xs } of rows.values()) {
    const edges = [...xs].sort((a, b) => a - b).filter((x, k, all) => k === 0 || x - all[k - 1]! > 0.5);
    for (let k = 0; k + 1 < edges.length; k += 1) boxes.push({ x1: edges[k]!, x2: edges[k + 1]!, y1, y2 });
  }
  return boxes.sort((a, b) => b.y2 - a.y2 || a.x1 - b.x1);
}

/** Items on one line (sorted by x) as text: a space where the gap between two is wider than a fifth of the size. */
function joinItems(list: readonly { str: string; x: number; size: number; width: number }[]): string {
  let text = "";
  let prevEnd = -Infinity;
  for (const it of list) {
    const gap = it.x - prevEnd;
    if (text && gap > 0.2 * it.size && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
    text += it.str;
    prevEnd = it.x + it.width;
  }
  return text;
}

// ── Extraction ───────────────────────────────────────────────────────────────

export async function extractPdf(bytes: Uint8Array, profile: PdfProfile = NODE_PROFILE): Promise<PdfExtract> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const meta = await doc.getMetadata();
  const info: Record<string, string> = {};
  for (const key of ["Title", "Subject", "Author", "Creator", "Producer", "Keywords"]) {
    const value = meta.info?.[key];
    if (value !== undefined && value !== "") info[key] = String(value);
  }
  for (const key of ["CreationDate", "ModDate"]) {
    const value = meta.info?.[key];
    if (value !== undefined && value !== "") info[key] = pdfDateToIso(String(value));
  }
  if (meta.info?.Language) info.Language = String(meta.info.Language);

  const pages: PdfPage[] = [];
  let missing = 0;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // pdf.js bridges gaps with a wide " " item; the positions tell the gaps instead.
    const items = (content.items as Any[])
      .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
      .map((it) => ({
        str: it.str as string,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        size: Math.abs(it.transform[3]) as number,
        width: it.width as number,
      }));
    for (const it of items) missing += (it.str.match(/\u0000/g) ?? []).length;

    // Group by baseline (0.5 pt), then split each line into cells where the gap is wide.
    const byY = new Map<number, typeof items>();
    for (const it of items) {
      const key = Math.round(it.y * 2) / 2;
      byY.set(key, [...(byY.get(key) ?? []), it]);
    }
    const lines: PdfLine[] = [...byY.entries()]
      .sort(([a], [b]) => b - a)
      .map(([y, list]) => {
        list.sort((a, b) => a.x - b.x);
        const cells: { x: number; text: string }[] = [];
        let prevEnd = -Infinity;
        for (const it of list) {
          const gap = it.x - prevEnd;
          const last = cells[cells.length - 1];
          const tableLine = Math.abs(it.size - profile.tableSize) < 0.01;
          if (last && (!tableLine || gap <= profile.cellGapEm * it.size)) {
            const needSpace = gap > 0.2 * it.size && !/\s$/.test(last.text) && !/^\s/.test(it.str);
            last.text += (needSpace ? " " : "") + it.str;
          } else cells.push({ x: it.x, text: it.str });
          prevEnd = it.x + it.width;
        }
        const size = Math.max(...list.map((i) => i.size));
        const shown = cells.map((c) => ({ x: c.x, text: squash(c.text) }));
        return { y, x: cells[0]!.x, size, cells: shown, text: shown.map((c) => c.text).join(" | "), footer: y < profile.footerBelowY };
      });

    const ops = await page.getOperatorList();
    const cells: PdfCell[] = cellBoxes(ops, lib.OPS, profile).map((box) => {
      const inside = items.filter((it) => it.x + 0.1 >= box.x1 && it.x + 0.1 < box.x2 && it.y >= box.y1 && it.y <= box.y2);
      const byBaseline = new Map<number, typeof items>();
      for (const it of inside) {
        const key = Math.round(it.y * 2) / 2;
        byBaseline.set(key, [...(byBaseline.get(key) ?? []), it]);
      }
      const cellLines = [...byBaseline.entries()].sort(([a], [b]) => b - a).map(([, list]) => squash(joinItems([...list].sort((a, b) => a.x - b.x))));
      return { ...box, text: joinLines(cellLines) };
    });
    pages.push({ lines, links: await pageLinks(page, ops, lib.OPS), cells });
  }
  await task.destroy();
  return { pageCount: pages.length, info, pages, missingGlyphs: missing };
}

/**
 * Link annotations: the URL and the text of the glyph runs under the rectangle. One logical link is
 * several annotations when its runs differ in style or it wraps: consecutive ones with the same URL
 * that touch on a line, or continue on the next line, are joined.
 */
async function pageLinks(page: Any, ops: Any, OPS: Any): Promise<PdfLink[]> {
  const annotations = ((await page.getAnnotations()) as Any[]).filter((a) => a.subtype === "Link" && a.url);
  if (annotations.length === 0) return [];
  const runs = glyphRuns(ops, OPS);
  const links: PdfLink[] = [];
  let lastRect: number[] | null = null;
  for (const a of annotations) {
    const [x1, y1, x2, y2] = a.rect as number[];
    // pdf.js normalizes `url` like a browser (lowercases the host); `unsafeUrl` is the string in the file.
    const url = (a.unsafeUrl ?? a.url) as string;
    const under = runs
      .filter((r) => r.text.trim() && r.x >= x1! - 1 && r.x + r.width <= x2! + 1 && r.y >= y1! - 1 && r.y <= y2! + 1)
      .sort((p, q) => p.x - q.x);
    const text = squash(under.map((r) => r.text).join(""));
    const last = links[links.length - 1];
    const size = under[0]?.size ?? 10;
    const sameLine = lastRect && Math.abs(lastRect[1]! - y1!) < 1 && x1! - lastRect[2]! < 0.6 * size;
    const nextLine = lastRect && lastRect[1]! > y1! && lastRect[1]! - y1! < 1.8 * size && x1! < lastRect[0]! + 1;
    if (last && last.url === url && (sameLine || nextLine)) last.text = squash(`${last.text}${JOIN_MARK}${text}`);
    else links.push({ url, text });
    lastRect = [x1!, y1!, x2!, y2!];
  }
  return links;
}

// ── The font-dependent golden: pdf.layout.txt ────────────────────────────────

/** A line of top-level body text: one cell, body size, at the left margin. */
const isMarginBody = (l: PdfLine, profile: PdfProfile) =>
  l.cells.length === 1 && Math.abs(l.size - profile.bodySize) < 0.01 && Math.abs(l.x - profile.marginX) < 1;

/**
 * How many blank paragraphs sit between two lines. Only counted between two lines of top-level body
 * text: elsewhere (lists, callouts, cells, headings) the spacing around the blank cannot be told from
 * the block's own padding.
 */
export function blanksBetween(prev: PdfLine, line: PdfLine, profile: PdfProfile): number {
  if (!isMarginBody(prev, profile) || !isMarginBody(line, profile)) return 0;
  // A leading hard break adds a line (0.7 of a step), a blank paragraph a whole step: round down from 0.85.
  const steps = (prev.y - line.y) / line.size / profile.paragraphStepEm;
  return Math.max(0, Math.floor(steps - 0.85));
}

/** U+0000 would vanish in a text file and in a diff; print it as a visible mark (U+2400). */
export const showMissing = (s: string) => s.replace(/\u0000/g, "␀");

/** Every text line with its page, indentation, heading level and footer, plus the links; no dates. */
export function pdfLayoutText(x: PdfExtract, profile: PdfProfile = NODE_PROFILE): string {
  const out: string[] = [];
  const meta = Object.entries(x.info)
    .filter(([k]) => k !== "CreationDate" && k !== "ModDate")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  out.push(`%PDF pages=${x.pageCount} ${meta.join(" ")}`.trimEnd());
  x.pages.forEach((page, n) => {
    out.push(`=== page ${n + 1}/${x.pageCount} ===`);
    let prev: PdfLine | null = null;
    for (const l of page.lines.filter((line) => !line.footer)) {
      if (prev) {
        const blanks = blanksBetween(prev, l, profile);
        for (let k = 0; k < blanks; k += 1) out.push("∅"); // a blank paragraph's gap
        if (blanks === 0 && (prev.y - l.y) / Math.max(l.size, prev.size) > profile.blockGapEm) out.push("");
      }
      const indent = " ".repeat(Math.max(0, Math.round((l.x - profile.marginX) / profile.indentStep)));
      const level = profile.headingSizes.findIndex((s) => Math.abs(s - l.size) < 0.01);
      out.push(`${indent}${level >= 0 ? "#".repeat(level + 1) + " " : ""}${showMissing(l.text)}`);
      prev = l;
    }
    const footer = page.lines.filter((l) => l.footer).map((l) => l.text).join(" | ");
    if (footer) out.push(`--- footer: ${footer}`);
    for (const k of page.links) out.push(`--- link: ${k.url}  <-  "${showMissing(k.text.replace(/[\u0001\u0003]/g, " "))}"`);
  });
  if (x.missingGlyphs) out.push(`!!! ${x.missingGlyphs} missing glyph(s) (U+0000) in this PDF`);
  return out.join("\n") + "\n";
}

// ── The font-independent content: blocks for the parity check ────────────────

export interface PdfBlock {
  heading: 0 | 1 | 2 | 3;
  /**
   * Text of the block, wrapped lines joined. Where a wrapped line ended in "-", the hyphen is followed
   * by WRAP_MARK: it may have been inserted by the line breaker (mid-word cut) or be a real hyphen.
   */
  text: string;
  /** Left edge of the first line. */
  x: number;
  blank?: true;
  /** One table cell (its text, all its lines joined). */
  table?: true;
  page: number;
}

/**
 * Lines -> blocks: paragraphs, headings and list items, blank paragraphs as gaps, and a block for
 * each table cell that holds text, in reading order. A table that continues on a new page repeats its
 * first row there (a header row): that copy is left out.
 */
export function pdfContentBlocks(x: PdfExtract, profile: PdfProfile = NODE_PROFILE): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  /** The first row of the table being read (its cells' texts), to recognize its repeat on the next page. */
  let firstRow: string[] | null = null;
  x.pages.forEach((page, pageIndex) => {
    const body = page.lines.filter((l) => !l.footer);
    const isTable = (l: PdfLine) => Math.abs(l.size - profile.tableSize) < 0.01;
    let i = 0;
    let prev: PdfLine | null = null;
    while (i < body.length) {
      const line = body[i]!;
      const blanks = prev ? blanksBetween(prev, line, profile) : 0;
      for (let k = 0; k < blanks; k += 1) blocks.push({ heading: 0, text: "", x: profile.marginX, blank: true, page: pageIndex + 1 });
      if (isTable(line)) {
        let j = i;
        while (j < body.length && isTable(body[j]!)) j += 1;
        const top = line.y;
        const bottom = body[j - 1]!.y;
        const rows = rowsOf(page.cells.filter((c) => c.y1 <= top + 0.5 && c.y2 >= bottom - 0.5));
        const continues = i === 0 && blocks.at(-1)?.table === true;
        if (continues && firstRow && rows[0] && sameTexts(rows[0], firstRow)) rows.shift();
        else if (!continues) firstRow = rows[0]?.map((c) => c.text) ?? null;
        for (const cell of rows.flat()) if (cell.text.trim() !== "") blocks.push({ heading: 0, text: cell.text, x: cell.x1, table: true, page: pageIndex + 1 });
        prev = body[j - 1]!;
        i = j;
        continue;
      }
      // Ordinary block: lines until the baseline step exceeds a wrapped line's.
      const group: PdfLine[] = [line];
      let j = i + 1;
      while (
        j < body.length &&
        (body[j - 1]!.y - body[j]!.y) / body[j]!.size <= profile.blockGapEm &&
        Math.abs(body[j]!.size - line.size) < 0.1
      ) {
        group.push(body[j]!);
        j += 1;
      }
      const level = profile.headingSizes.findIndex((s) => Math.abs(s - line.size) < 0.01);
      pushJoined(blocks, group.map((g) => g.text), (level + 1) as 0 | 1 | 2 | 3, line.x, pageIndex + 1);
      prev = group[group.length - 1]!;
      i = j;
    }
  });
  return blocks;
}

/** Cells grouped into rows by their top edge, in reading order. */
function rowsOf(cells: readonly PdfCell[]): PdfCell[][] {
  const rows: PdfCell[][] = [];
  for (const cell of cells) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y2 - cell.y2) < 0.5) row.push(cell);
    else rows.push([cell]);
  }
  return rows;
}

const sameTexts = (row: readonly PdfCell[], texts: readonly string[]) => row.length === texts.length && row.every((c, k) => c.text === texts[k]);

/** Wrapped lines as one text: WRAP_MARK after a line that ended in "-", JOIN_MARK otherwise. */
function joinLines(lines: readonly string[]): string {
  let text = "";
  lines.forEach((ln, k) => {
    if (k > 0) text += text.endsWith("-") ? WRAP_MARK : JOIN_MARK;
    text += ln;
  });
  return text;
}

function pushJoined(blocks: PdfBlock[], lines: string[], heading: 0 | 1 | 2 | 3, x: number, page: number) {
  const text = joinLines(lines);
  if (text.trim() === "") return;
  blocks.push({ heading, text: squash(text), x, page });
}
