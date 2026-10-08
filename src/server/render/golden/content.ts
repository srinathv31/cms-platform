// Content parity: what each channel shows, compared with what the RenderDoc says. This file is the
// reference implementation of the comparisons; docs/render-spec.md section 13 names it, and the Java
// build repeats the PDF one on its own PDF.
//
// THE CONTENT TEXT (`expected/content.txt`, derived from renderdoc.json alone). One logical block
// per line, in reading order:
//
//     # Heading 1    ## Heading 2    ### Heading 3
//     a paragraph's text                     one line per paragraph
//     ∅                                      a blank paragraph (any container)
//     • item   ◦ item   ▪ item               a list item: its marker, a space, its first line
//     1. item  (b) item  iv. item  12) item  (the marker is the RenderDoc's, never recomputed)
//     1.                                     an item with no text shows its marker alone
//
//   - A table is its cells' blocks in reading order (row by row, cell by cell); a callout is its
//     paragraphs; rules are omitted.
//   - Runs of whitespace (and no-break spaces) are one space; ends are trimmed.
//   - A hard break is a space. Two or more hard breaks in a row (a blank line inside a paragraph)
//     end the line: the paragraph is two lines.
//   - The first paragraph of a list item is the item's line. If it is blank, the item is its marker
//     alone and that blank paragraph is not a separate ∅.
//
// WHAT EACH CHANNEL IS COMPARED WITH.
//   - Web and email HTML show everything: the content text, line by line; and the verbatim view
//     below, which keeps what the content text collapses: every paragraph and heading with text, at
//     any depth (lists, cells, callouts), as its lines split at every hard break, every space as
//     typed.
//   - Email plain text: the text the RenderDoc dictates (docs/render-spec.md section 10, "Plain
//     text"), line for line. Every line is exact (characters, spaces, markers, link addresses, the
//     " | " between cells, blank lines) except the layout the format adds, which is compared loosely:
//     the indent of an item's further lines, the padding after a cell's line, an underline's length.
//   - The PDF: a reduced view of the content text, because its text layer can't carry the rest:
//       ∅ only for a blank paragraph that is a direct child of the document with a paragraph on
//       each side (the PDF shows a blank paragraph as a gap, and only between two body-text lines
//       at the left margin can a gap be told from the spacing around lists, callouts and cells);
//       an item's further paragraphs join the item's line (they sit close under it), and an item
//       that opens with a nested list shares its line with that list's first marker ("3. a. ...");
//       a table is one line per cell that holds text, in reading order, the cell's lines joined.
//       Cells are found by the rules each one draws (extract-pdf.ts), so a cell's text, its column
//       and row and its order are all compared; not compared are a blank paragraph inside a cell
//       and where a cell's paragraphs end (both read as wrapping).
//     Spaces and single hard breaks are not compared in the PDF: a line ends at a hard break and at
//     an automatic wrap alike, and leading spaces are set as an offset, not as text (pdf.test.ts
//     checks both directly).
// The golden files pin every channel's exact output anyway; parity only asks that no channel
// disagrees about what the content is.

import { Window } from "happy-dom";
import type { RenderBlock, RenderInline, RenderTable } from "@/domain/render/types";
import { normalizeLink } from "@/editor/model/links";
import { JOIN_MARK, WRAP_MARK, type PdfBlock } from "./extract-pdf";

export interface LinkRef {
  text: string;
  url: string;
}

export interface Content {
  lines: string[];
  links: LinkRef[];
}

/** The views of the reference; see the header. */
export interface View {
  /** "all": a ∅ for every blank paragraph. "top": only those the PDF can show. */
  blanks: "all" | "top";
  /** How a table is written: "blocks" is every cell block a line; "cells" is one line per cell that holds text (TABLE_MARK). */
  tables: "blocks" | "cells";
  /** An item's further paragraphs join the item's line. */
  joinItemParagraphs: boolean;
}

export const VIEWS = {
  /** What `content.txt` holds and the HTML channels are compared with. */
  full: { blanks: "all", tables: "blocks", joinItemParagraphs: false },
  pdf: { blanks: "top", tables: "cells", joinItemParagraphs: true },
} as const satisfies Record<string, View>;

/** Starts a reference line that is one table cell's text (it only ever matches another cell's). */
export const TABLE_MARK = "\u0004";

const NBSP = "\u00a0";
export const norm = (s: string) => s.split(NBSP).join(" ").replace(/\s+/g, " ").trim();

// ── Text of a paragraph ──────────────────────────────────────────────────────

/** A hard break, inside text being measured. */
export const BREAK = "\u0002";
const BREAK_RUN = new RegExp(`(?:\\s*${BREAK}\\s*){2,}`);

/** A paragraph's lines: split where two or more hard breaks meet, each normalized, empty ones gone. */
export function segments(raw: string): string[] {
  return raw
    .split(BREAK_RUN)
    .map((part) => norm(part.split(BREAK).join(" ")))
    .filter((part) => part !== "");
}

const rawText = (c: readonly RenderInline[]) => c.map((i) => (i.type === "break" ? BREAK : i.text)).join("");

// ── Reference: from the RenderDoc ────────────────────────────────────────────

function linksOf(content: readonly RenderInline[], out: LinkRef[]) {
  let cur = null as LinkRef | null;
  for (const i of content) {
    const href: string | null = i.type === "break" ? (cur?.url ?? null) : (i.href ?? null);
    if (href && cur && cur.url === href) cur.text += i.type === "break" ? " " : i.text;
    else {
      if (cur) out.push({ text: norm(cur.text), url: cur.url });
      cur = href ? { text: i.type === "break" ? "" : i.text, url: href } : null;
    }
  }
  if (cur) out.push({ text: norm(cur.text), url: cur.url });
}

const isBlankParagraph = (b: RenderBlock) => b.type === "paragraph" && segments(rawText(b.content)).length === 0;

/** A blank paragraph with a (non-blank) paragraph on each side, blank ones skipped. */
function betweenParagraphs(blocks: readonly RenderBlock[], i: number): boolean {
  let before = i - 1;
  while (before >= 0 && isBlankParagraph(blocks[before]!)) before -= 1;
  let after = i + 1;
  while (after < blocks.length && isBlankParagraph(blocks[after]!)) after += 1;
  return before >= 0 && after < blocks.length && blocks[before]!.type === "paragraph" && blocks[after]!.type === "paragraph";
}

export function contentFromRenderDoc(blocks: readonly RenderBlock[], view: View = VIEWS.full): Content {
  const links: LinkRef[] = [];

  /** An item: its marker with its first line, then its other lines and blocks. */
  function itemInto(item: { marker: string; content: readonly RenderBlock[] }, out: string[]) {
    const [first, ...rest] = item.content;
    // The PDF sets an item's further paragraphs (and a hard-break continuation) close under the line
    // above, so they read as part of it: of the item's line, a paragraph's or a nested list's. Not of
    // a heading's or a table cell's: those are blocks of their own.
    let joinable = true;
    const addLine = (line: string) => (view.joinItemParagraphs && joinable ? void (out[out.length - 1] += " " + line) : void out.push(line));
    let after: readonly RenderBlock[] = item.content;
    if (first?.type === "paragraph") {
      const segs = segments(rawText(first.content));
      out.push(segs.length ? `${item.marker} ${segs[0]}` : item.marker);
      segs.slice(1).forEach(addLine);
      linksOf(first.content, links);
      after = rest;
    } else out.push(item.marker);
    const markerAt = out.length - 1;
    for (const b of after) {
      if (b.type !== "paragraph") {
        const before = out.length;
        blocksInto([b], out, false);
        if (out.length > before) joinable = b.type === "list";
        continue;
      }
      const segs = segments(rawText(b.content));
      linksOf(b.content, links);
      if (segs.length) {
        segs.forEach(addLine);
        joinable = true;
      } else if (view.blanks === "all") out.push("∅");
    }
    // An item that opens with a nested list shares its line with the list's first marker.
    if (view.joinItemParagraphs && first?.type !== "paragraph" && out.length > markerAt + 1) {
      out.splice(markerAt, 2, `${out[markerAt]} ${out[markerAt + 1]}`);
    }
  }

  function blocksInto(list: readonly RenderBlock[], out: string[], topLevel: boolean) {
    list.forEach((b, i) => {
      switch (b.type) {
        case "paragraph": {
          const segs = segments(rawText(b.content));
          if (segs.length) {
            out.push(...segs);
            linksOf(b.content, links);
          } else if (view.blanks === "all" || (topLevel && betweenParagraphs(list, i))) out.push("∅");
          break;
        }
        case "heading": {
          const text = segments(rawText(b.content)).join(" ");
          if (text) {
            out.push(`${"#".repeat(b.level)} ${text}`);
            linksOf(b.content, links);
          } else if (view.blanks === "all") out.push("∅");
          break;
        }
        case "list":
          for (const item of b.items) itemInto(item, out);
          break;
        case "table":
          for (const row of b.rows) {
            for (const cell of row.cells) {
              const cellLines: string[] = [];
              blocksInto(cell.content, cellLines, false);
              if (view.tables === "blocks") out.push(...cellLines);
              else {
                const text = cellLines.filter((l) => l !== "∅").join(" ");
                if (text !== "") out.push(TABLE_MARK + text);
              }
            }
          }
          break;
        case "callout":
          blocksInto(b.content, out, false);
          break;
        case "rule":
          break;
      }
    });
  }

  const lines: string[] = [];
  blocksInto(blocks, lines, true);
  return { lines, links };
}

/** A line that starts with a list marker (• ◦ ▪, 1. a) (iv) ...) and a space, or is a marker alone. */
export const MARKER = String.raw`(?:[•◦▪]|\((?:\d{1,5}|[a-z]{1,12}|[A-Z]{1,12})\)|(?:\d{1,5}|[a-z]{1,12}|[A-Z]{1,12})[.)])`;
const ITEM_LINE = new RegExp(`^${MARKER}(?: |$)`);
const MARKER_ONLY = new RegExp(`^${MARKER}$`);

// ── HTML (web and email) ─────────────────────────────────────────────────────

type K = "text" | "item" | "head" | "blank";
interface L {
  t: string;
  k: K;
  /** Came from inline text before the first block of its container (a list marker, in a list item). */
  lead?: boolean;
}

interface Nd {
  nodeType: number;
  textContent: string | null;
  childNodes: Iterable<Nd>;
}
interface El extends Nd {
  tagName: string;
  parentElement: El | null;
  children: Iterable<El>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
}

let windowSingleton: Window | null = null;
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "UL", "OL", "TABLE", "DIV", "HR", "LI", "TR", "TD", "TH", "THEAD", "TBODY", "SECTION", "ARTICLE", "MAIN"]);

const HIDDEN_STYLE = /display:\s*none|mso-hide:\s*all|max-height:\s*0(?:px)?\b/i;
const isHidden = (e: El) => HIDDEN_STYLE.test(e.getAttribute("style") ?? "") || ["SVG", "STYLE", "SCRIPT", "HEAD", "TITLE"].includes(e.tagName);

export function contentFromHtml(html: string, roots: readonly string[]): Content {
  windowSingleton ??= new Window();
  const doc = new windowSingleton.DOMParser().parseFromString(html, "text/html");
  let top: El | null = null;
  for (const selector of roots) {
    top = doc.querySelector(selector) as unknown as El | null;
    if (top) break;
  }
  if (!top) throw new Error(`no ${roots.join(" or ")} in the HTML`);

  const textOf = (n: Nd): string => {
    if (n.nodeType === 3) return n.textContent ?? "";
    if (n.nodeType !== 1) return "";
    const e = n as El;
    if (e.tagName === "BR") return BREAK;
    if (isHidden(e)) return "";
    return [...e.childNodes].map(textOf).join("");
  };
  const isBlock = (n: Nd) => n.nodeType === 1 && BLOCK_TAGS.has((n as El).tagName);
  const isPresentationTable = (e: El) => e.tagName === "TABLE" && e.getAttribute("role") === "presentation";

  /** Content of a container (document, item, cell, callout, wrapper): inline runs become a line, blocks recurse. */
  const flow = (container: El): L[] => {
    const out: L[] = [];
    let inline = "";
    let sawBlock = false;
    const flush = () => {
      const segs = segments(inline);
      // A container whose only content is a no-break space or a break is a blank paragraph written
      // without a <p> (plain whitespace between tags is just markup).
      if (segs.length === 0 && !sawBlock && out.length === 0 && (inline.includes(NBSP) || inline.includes(BREAK))) out.push({ t: "∅", k: "blank" });
      segs.forEach((t, k) => out.push({ t, k: "text", lead: !sawBlock && k === 0 ? true : undefined }));
      inline = "";
    };
    for (const n of container.childNodes) {
      if (n.nodeType === 1 && isHidden(n as El)) continue;
      if (!isBlock(n)) {
        inline += textOf(n);
        continue;
      }
      flush();
      sawBlock = true;
      const e = n as El;
      switch (e.tagName) {
        case "P": {
          const segs = segments(textOf(e));
          if (segs.length === 0) out.push({ t: "∅", k: "blank" });
          else segs.forEach((t) => out.push({ t, k: "text" }));
          break;
        }
        case "H1":
        case "H2":
        case "H3": {
          const segs = segments(textOf(e));
          if (segs.length === 0) out.push({ t: "∅", k: "blank" });
          else out.push({ t: `${"#".repeat(Number(e.tagName[1]))} ${segs.join(" ")}`, k: "head" });
          break;
        }
        case "UL":
        case "OL":
          for (const li of e.children) if (li.tagName === "LI") out.push(...item(flow(li)));
          break;
        case "TABLE":
          if (isPresentationTable(e)) out.push(...layoutTable(e));
          else for (const tr of rowsOf(e)) for (const cell of cellsOf(tr)) out.push(...flow(cell));
          break;
        case "TR":
        case "THEAD":
        case "TBODY":
        case "TD":
        case "TH":
        case "DIV":
        case "SECTION":
        case "ARTICLE":
        case "MAIN":
          out.push(...flow(e));
          break;
        default: // HR, LI outside a list
          break;
      }
    }
    flush();
    return out;
  };

  /** An item's lines: the leading inline text is the marker; it joins the first line that follows. */
  const item = (lines: L[]): L[] => {
    const first = lines[0];
    if (first?.lead && MARKER_ONLY.test(first.t)) {
      const next = lines[1];
      if (next && (next.k === "text" || next.k === "head")) return [{ t: `${first.t} ${next.t}`, k: "item" }, ...lines.slice(2)];
      if (next?.k === "blank") return [{ t: first.t, k: "item" }, ...lines.slice(2)];
      return [{ t: first.t, k: "item" }, ...lines.slice(1)];
    }
    if (first?.lead && ITEM_LINE.test(first.t)) return [{ ...first, k: "item" }, ...lines.slice(1)];
    return lines;
  };

  /** A table used for layout (email callouts, markers beside text): a row's cells sit side by side. */
  const layoutTable = (table: El): L[] => {
    const out: L[] = [];
    for (const tr of rowsOf(table)) {
      const cells = cellsOf(tr).map((c) => flow(c));
      const [first, second] = cells;
      if (cells.length >= 2 && first!.length === 1 && MARKER_ONLY.test(first![0]!.t) && second!.length > 0) {
        out.push(...item([{ ...first![0]!, lead: true }, ...second!]));
        for (const rest of cells.slice(2)) out.push(...rest);
      } else for (const c of cells) out.push(...c);
    }
    return out;
  };
  const closestTable = (e: El): El | null => {
    for (let a = e.parentElement; a; a = a.parentElement) if (a.tagName === "TABLE") return a;
    return null;
  };
  /** The rows of this table only (not the rows of a table nested in one of its cells). */
  const rowsOf = (table: El): El[] => [...table.querySelectorAll("tr")].filter((tr) => closestTable(tr) === table);
  const cellsOf = (tr: El): El[] => [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");

  const out: Content = { lines: flow(top).map((l) => l.t), links: [] };
  // Consecutive anchors with the same href are one link (the adapters group by href; so does the editor).
  for (const a of top.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (href) out.links.push({ text: norm(textOf(a).split(BREAK).join(" ")), url: href });
  }
  return out;
}

// ── Email plain text ─────────────────────────────────────────────────────────

/** A piece of an expected plain-text line: text that must be there exactly, or loose layout. */
type Piece = { text: string } | { pattern: string; show: string };
/** An expected plain-text line; [] is an empty line. */
type TextLine = Piece[];

const exact = (text: string): Piece => ({ text });
/** Spaces the format adds for layout (an item's indent, a cell's padding): any number of them. */
const PAD: Piece = { pattern: " *", show: "" };
const underline = (mark: "=" | "-"): Piece => ({ pattern: `${mark}{3,}`, show: mark.repeat(3) });

const FRAME = `+${"-".repeat(39)}`;
const isBlank = (text: string) => text.trim() === "";
/** Ignoring case and one trailing "/". */
const sameAddress = (a: string, b: string) => a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

/** A link in plain text: "text (address)", or just the text when it is the address, or just the address when the text is blank. */
function linkAsText(text: string, href: string): string {
  const address = href.replace(/^(?:mailto:|tel:)/, "");
  if (isBlank(text)) return address;
  const shown = text.trim();
  const asLink = normalizeLink(shown);
  if ((asLink !== null && sameAddress(asLink, href)) || sameAddress(shown, address)) return text;
  return `${text} (${address})`;
}

/**
 * Inline content as plain text, a hard break as "\n". Consecutive runs with the same href are one
 * link; a break belongs to it only when the nearest runs before and after it both carry that href.
 */
function plainInline(content: readonly RenderInline[]): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const item = content[i]!;
    if (item.type === "break" || item.href === undefined) {
      out += item.type === "break" ? "\n" : item.text;
      i += 1;
      continue;
    }
    const href = item.href;
    let text = "";
    let j = i;
    while (j < content.length) {
      const next = content[j]!;
      if (next.type === "text" && next.href === href) {
        text += next.text;
        j += 1;
        continue;
      }
      let k = j;
      while (content[k]?.type === "break") k += 1;
      const after = content[k];
      if (k === j || after?.type !== "text" || after.href !== href) break;
      text += "\n".repeat(k - j);
      j = k;
    }
    out += linkAsText(text, href);
    i = j;
  }
  return out;
}

const plainLines = (content: readonly RenderInline[]): TextLine[] => plainInline(content).split("\n").map((line) => (line === "" ? [] : [exact(line)]));

/** Blocks as plain-text lines; `gap` puts an empty line between blocks (the top level, callouts). */
function textBlocks(blocks: readonly RenderBlock[], gap: boolean): TextLine[] {
  const out: TextLine[] = [];
  blocks.forEach((block, i) => {
    if (gap && i > 0) out.push([]);
    out.push(...textBlock(block));
  });
  return out;
}

function textBlock(block: RenderBlock): TextLine[] {
  switch (block.type) {
    case "paragraph":
      return plainLines(block.content);
    case "heading": {
      const lines = plainLines(block.content);
      const blank = plainInline(block.content).split("\n").every(isBlank);
      return block.level === 3 || blank ? lines : [...lines, [underline(block.level === 1 ? "=" : "-")]];
    }
    case "list":
      // The marker and a space before the first line (the marker alone when it is empty); the
      // further lines indented, empty ones empty.
      return block.items.flatMap((item) =>
        textBlocks(item.content, false).map((line, k): TextLine => {
          if (k === 0) return line.length === 0 ? [exact(item.marker)] : [exact(`${item.marker} `), ...line];
          return line.length === 0 ? [] : [PAD, ...line];
        }),
      );
    case "table":
      return textTable(block);
    case "callout":
      return [[exact(FRAME)], ...textBlocks(block.content, true).map((line): TextLine => (line.length === 0 ? [exact("|")] : [exact("| "), ...line])), [exact(FRAME)]];
    case "rule":
      return [[exact("-".repeat(40))]];
  }
}

/** Each row as lines: line j is every cell's line j (or nothing), joined by " | " (an empty last piece by " |"). */
function textTable(table: RenderTable): TextLine[] {
  const out: TextLine[] = [];
  table.rows.forEach((row, r) => {
    const cells = row.cells.map((cell): TextLine[] => (cell.content.length === 0 ? [[]] : textBlocks(cell.content, false)));
    const height = Math.max(0, ...cells.map((lines) => lines.length));
    for (let j = 0; j < height; j += 1) {
      const line: TextLine = [];
      cells.forEach((lines, k) => {
        const piece = lines[j] ?? [];
        const last = k === cells.length - 1;
        if (k > 0) line.push(exact(last && piece.length === 0 ? " |" : " | "));
        line.push(...piece);
        if (!last) line.push(PAD);
      });
      out.push(line);
    }
    const header = row.cells.length > 0 && row.cells.every((cell) => cell.header);
    if (header && r < table.rows.length - 1) out.push([underline("-")]);
  });
  return out;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ExpectedLine {
  show: string;
  pattern: RegExp;
}

/** The plain text the RenderDoc dictates, line by line (docs/render-spec.md section 10). */
export function plainTextFromRenderDoc(blocks: readonly RenderBlock[]): ExpectedLine[] {
  const lines = textBlocks(blocks, true);
  // No blocks is one empty line ("\n").
  return (lines.length ? lines : [[]]).map((line) => ({
    show: line.map((piece) => ("text" in piece ? piece.text : piece.show)).join(""),
    pattern: new RegExp(`^${line.map((piece) => ("text" in piece ? escapeRegExp(piece.text) : piece.pattern)).join("")}$`),
  }));
}

/** Problems with the email's plain text ([] when every line is the one the RenderDoc dictates). */
export function plainTextProblems(blocks: readonly RenderBlock[], text: string): string[] {
  if (!text.endsWith("\n")) return ["email.txt: does not end with a line break"];
  const expected = plainTextFromRenderDoc(blocks);
  const actual = text.slice(0, -1).split("\n");
  const d = diffBy(expected, actual, (e, a) => e.pattern.test(a), (e) => e.show);
  return d.ok ? [] : [`email.txt: content differs from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`];
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * PDF blocks -> content. The PDF does not mark where one reference line ends: a page break splits a
 * paragraph, and a blank paragraph or a second paragraph inside a list item leaves a gap that reads
 * as a new block. Walking the reference with a cursor, a block is joined with the blocks after it
 * when, together, they are the reference's next line. A block that matches as it is never joins, so
 * a real difference still shows. A table cell is never joined (its own block, whole: a table row
 * never splits across pages).
 */
export function contentFromPdf(blocks: readonly PdfBlock[], links: { text: string; url: string }[], ref: Content): Content {
  const MAX_JOIN = 12;
  const lines = ref.lines;
  const render = (b: PdfBlock) => (b.blank ? "\u2205" : b.table ? TABLE_MARK + b.text : `${b.heading ? "#".repeat(b.heading) + " " : ""}${b.text}`);
  const out: string[] = [];
  let e = 0; // the next reference line
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]!;
    let text = render(b);
    if (e < lines.length && !eq(lines[e]!, text) && !b.blank && !b.table) {
      let acc = b;
      for (let k = 1; k <= MAX_JOIN && i + k < blocks.length; k += 1) {
        const next = blocks[i + k]!;
        if (next.blank || next.table || next.heading !== b.heading) break;
        acc = { ...acc, text: acc.text + JOIN_MARK + next.text };
        if (eq(lines[e]!, render(acc))) {
          text = render(acc);
          i += k;
          break;
        }
      }
    }
    out.push(text);
    e += 1;
  }
  return { lines: out, links: links.map((l) => ({ text: norm(l.text), url: l.url })) };
}

// ── Comparison ───────────────────────────────────────────────────────────────

/**
 * expected equals actual, where actual may carry marks left by the PDF line breaker: WRAP_MARK after
 * a hyphen that ended a line (a real hyphen or an inserted one) and JOIN_MARK where two lines were
 * joined (a space, or nothing when a long URL was cut at a separator).
 */
export function eq(expected: string, actual: string): boolean {
  if (expected.startsWith(TABLE_MARK) !== actual.startsWith(TABLE_MARK)) return false;
  if (!/[\u0001\u0003]/.test(actual)) return expected === actual;
  const parts = actual.split(/([\u0001\u0003])/);
  let at = 0;
  for (let k = 0; k < parts.length; k += 2) {
    const part = parts[k]!;
    const mark = parts[k + 1];
    if (expected.startsWith(part, at)) {
      at += part.length;
      if (mark === WRAP_MARK && expected[at] === " ") at += 1; // "pre- and": the break fell on the space
    } else if (mark === WRAP_MARK && part.endsWith("-") && expected.startsWith(part.slice(0, -1), at)) {
      at += part.length - 1; // an inserted hyphen: not in the source
    } else return false;
    if (mark === JOIN_MARK && expected[at] === " ") at += 1;
  }
  return at === expected.length;
}

export interface Diff {
  ok: boolean;
  /** Unified-style lines: "- expected only", "+ actual only", two spaces for context. */
  lines: string[];
}

export function diffLines(expected: readonly string[], actual: readonly string[], same: (e: string, a: string) => boolean = (e, a) => e === a): Diff {
  return diffBy(expected, actual, same, (e) => e);
}

/** diffLines for expected lines of any kind: `same` decides a match, `show` prints an expected line. */
export function diffBy<E>(expected: readonly E[], actual: readonly string[], same: (e: E, a: string) => boolean, show: (e: E) => string): Diff {
  const n = expected.length;
  const m = actual.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = same(expected[i]!, actual[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  let context = ""; // the last line both sides agree on, shown once before a change
  const visible = (s: string) => s.replace(/\u0000/g, "␀").replace(/[\u0001\u0003]/g, "");
  while (i < n || j < m) {
    if (i < n && j < m && same(expected[i]!, actual[j]!)) {
      context = `  ${show(expected[i]!)}`;
      i += 1;
      j += 1;
    } else {
      if (context) {
        out.push(context);
        context = "";
      }
      if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!)) out.push(`+ ${visible(actual[j++]!)}`);
      else out.push(`- ${show(expected[i++]!)}`);
    }
  }
  return { ok: !out.some((l) => l[0] === "-" || l[0] === "+"), lines: out };
}

export interface CompareOptions {
  /** The PDF line breaker's marks may be in the actual text. */
  pdf?: boolean;
}

/** Problems found comparing a channel's content with the reference ([] when they agree). */
export function compareContent(channel: string, ref: Content, got: Content, opts: CompareOptions = {}): string[] {
  const problems: string[] = [];
  const d = diffLines(ref.lines, got.lines, opts.pdf ? eq : undefined);
  if (!d.ok) problems.push(`${channel}: content differs from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`);
  const key = (l: LinkRef) => `${l.url}  <-  ${l.text}`;
  const dl = diffLines(ref.links.map(key), got.links.map(key), opts.pdf ? eq : undefined);
  if (!dl.ok) problems.push(`${channel}: links differ (url <- text)\n${dl.lines.map((l) => "    " + l).join("\n")}`);
  return problems;
}

// ── Typed spaces and breaks, as typed ────────────────────────────────────────

/**
 * The content text collapses whitespace, so it cannot see rule 10 (runs of spaces and leading spaces
 * render exactly as typed) or rule 11 (every hard break is a line break). This view keeps them: every
 * paragraph and heading with visible text, at any depth (top level, list items, cells, callouts), in
 * document order, as its lines (split at every hard break) with every space exactly as typed. A
 * no-break space counts as a space: the email HTML writes some typed spaces as no-break spaces on
 * purpose. (The plain text is compared exactly by plainTextProblems.)
 */
export function verbatimFromRenderDoc(blocks: readonly RenderBlock[]): string[][] {
  const out: string[][] = [];
  const walk = (list: readonly RenderBlock[]) => {
    for (const block of list) {
      switch (block.type) {
        case "paragraph":
        case "heading":
          if (segments(rawText(block.content)).length > 0) out.push(verbatimLines(rawText(block.content)));
          break;
        case "list":
          for (const item of block.items) walk(item.content);
          break;
        case "table":
          for (const row of block.rows) for (const cell of row.cells) walk(cell.content);
          break;
        case "callout":
          walk(block.content);
          break;
        case "rule":
          break;
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * A block's lines. A last line of one space after a hard break reads as empty: the email HTML fills
 * the empty line after a final break with a no-break space (docs/render-spec.md section 10), which
 * reads the same as one typed space, so neither view tells the two apart.
 */
const verbatimLines = (raw: string) => raw.replace(new RegExp(`${BREAK}[ ${NBSP}]$`), BREAK).split(NBSP).join(" ").split(BREAK);

/** A browser makes no line of a block's final <br>: the web fills the empty line after a final break with it. */
const collapseFinalBreak = (raw: string) => (raw.endsWith(BREAK) ? raw.slice(0, -BREAK.length) : raw);

/**
 * The same view read from the web page or the email HTML: every p, h1–h3, and every table cell that
 * holds inline content itself (the email writes an item's or a cell's only paragraph straight into
 * its <td>), in document order. A list row's marker cell (the first of two cells in an email layout
 * table) is not content.
 */
export function verbatimFromHtml(html: string, roots: readonly string[]): string[][] {
  windowSingleton ??= new Window();
  const doc = new windowSingleton.DOMParser().parseFromString(html, "text/html");
  let top: El | null = null;
  for (const selector of roots) {
    top = doc.querySelector(selector) as unknown as El | null;
    if (top) break;
  }
  if (!top) throw new Error(`no ${roots.join(" or ")} in the HTML`);
  const textOf = (n: Nd): string => {
    if (n.nodeType === 3) return n.textContent ?? "";
    if (n.nodeType !== 1) return "";
    const e = n as El;
    return e.tagName === "BR" ? BREAK : isHidden(e) ? "" : [...e.childNodes].map(textOf).join("");
  };
  const tableOf = (e: El): El | null => {
    for (let a = e.parentElement; a; a = a.parentElement) if (a.tagName === "TABLE") return a;
    return null;
  };
  const isMarkerCell = (td: El) => {
    const cells = [...(td.parentElement?.children ?? [])].filter((c) => c.tagName === "TD" || c.tagName === "TH");
    return tableOf(td)?.getAttribute("role") === "presentation" && cells.length === 2 && cells[0] === td;
  };
  const out: string[][] = [];
  const take = (e: El) => {
    const raw = collapseFinalBreak(textOf(e));
    if (segments(raw).length > 0) out.push(verbatimLines(raw));
  };
  const visit = (e: El) => {
    if (isHidden(e)) return;
    if (["P", "H1", "H2", "H3"].includes(e.tagName)) return take(e);
    if ((e.tagName === "TD" || e.tagName === "TH") && ![...e.children].some((c) => BLOCK_TAGS.has(c.tagName))) {
      if (!isMarkerCell(e)) take(e);
      return;
    }
    for (const child of e.children) visit(child);
  };
  visit(top);
  return out;
}

const show = (lines: readonly string[]) => lines.map((l) => JSON.stringify(l)).join(" / ");

/** Problems with typed spaces and breaks: [] when both HTML channels keep every line as typed. */
export function verbatimProblems(ref: readonly string[][], web: readonly string[][], email: readonly string[][]): string[] {
  const problems: string[] = [];
  for (const [channel, got] of [["web", web], ["email.html", email]] as const) {
    const d = diffLines(ref.map(show), got.map(show));
    if (!d.ok) problems.push(`${channel}: typed spaces or hard breaks differ from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`);
  }
  return problems;
}

// ── Markup that would let a browser or mail client number a list itself ──────

/**
 * Web and email HTML print every marker as text (docs/render-spec.md section 7). A page that also
 * set `start`, `type` or `value` on a list, or a `list-style` other than none, would show a second
 * marker or a different one in some client; a marker hidden from assistive technology would not be
 * read at all. [] when the markup keeps clear of both.
 */
export function listMarkupProblems(channel: string, html: string): string[] {
  windowSingleton ??= new Window();
  const doc = new windowSingleton.DOMParser().parseFromString(html, "text/html");
  const problems: string[] = [];
  for (const list of doc.querySelectorAll("ol, ul") as unknown as Iterable<El>) {
    for (const attr of ["start", "type", "reversed"]) {
      if (list.getAttribute(attr) !== null) problems.push(`${channel}: <${list.tagName.toLowerCase()}> has a ${attr} attribute, so a client may number the list itself`);
    }
  }
  for (const li of doc.querySelectorAll("li") as unknown as Iterable<El>) {
    if (li.getAttribute("value") !== null) problems.push(`${channel}: <li> has a value attribute, so a client may number the item itself`);
  }
  for (const m of html.matchAll(/list-style(?:-type)?\s*:\s*([^;"'}]+)/gi)) {
    if (m[1]!.trim().toLowerCase() !== "none") problems.push(`${channel}: list-style: ${m[1]!.trim()} lets a client number a list itself`);
  }
  for (const hidden of doc.querySelectorAll("[aria-hidden]") as unknown as Iterable<El>) {
    if (hidden.getAttribute("aria-hidden") === "true" && new RegExp(`^${MARKER}$`).test(norm(hidden.textContent ?? ""))) {
      problems.push(`${channel}: the marker ${JSON.stringify(norm(hidden.textContent ?? ""))} is hidden from assistive technology`);
    }
  }
  return problems;
}
