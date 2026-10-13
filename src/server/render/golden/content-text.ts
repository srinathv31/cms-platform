// Content parity: what each channel shows, compared with what the RenderDoc says. This file is the
// reference: it derives the content text from the RenderDoc. docs/render-spec.md section 13 names the
// content-*.ts files and diff.ts as the reference implementation of the comparisons, and the Java
// build repeats the PDF one on its own PDF.
//
// WHERE THINGS ARE.
//   content-text.ts       this file: the content text, its two views, the verbatim view of the RenderDoc
//   content-html.ts       web and email HTML read back into content, the verbatim view and the list markup check
//   content-plaintext.ts  the email's plain text, as the RenderDoc dictates it, line by line
//   content-pdf.ts        the PDF's text blocks read back into content
//   diff.ts               the line diff, the PDF-aware line equality and compareContent
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

import type { RenderBlock, RenderInline } from "@/domain/render/types";

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

export const NBSP = "\u00a0";
export const norm = (s: string) =>
  s.split(NBSP).join(" ").replace(/\s+/g, " ").trim();

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

/** A paragraph's inline content as one string, a hard break written as BREAK. */
export const rawText = (c: readonly RenderInline[]) =>
  c.map((i) => (i.type === "break" ? BREAK : i.text)).join("");

// ── Reference: from the RenderDoc ────────────────────────────────────────────

function linksOf(content: readonly RenderInline[], out: LinkRef[]) {
  let cur = null as LinkRef | null;
  for (const i of content) {
    const href: string | null =
      i.type === "break" ? (cur?.url ?? null) : (i.href ?? null);
    if (href && cur && cur.url === href)
      cur.text += i.type === "break" ? " " : i.text;
    else {
      if (cur) out.push({ text: norm(cur.text), url: cur.url });
      cur = href ? { text: i.type === "break" ? "" : i.text, url: href } : null;
    }
  }
  if (cur) out.push({ text: norm(cur.text), url: cur.url });
}

const isBlankParagraph = (b: RenderBlock) =>
  b.type === "paragraph" && segments(rawText(b.content)).length === 0;

/** A blank paragraph with a (non-blank) paragraph on each side, blank ones skipped. */
function betweenParagraphs(blocks: readonly RenderBlock[], i: number): boolean {
  let before = i - 1;
  while (before >= 0 && isBlankParagraph(blocks[before]!)) before -= 1;
  let after = i + 1;
  while (after < blocks.length && isBlankParagraph(blocks[after]!)) after += 1;
  return (
    before >= 0 &&
    after < blocks.length &&
    blocks[before]!.type === "paragraph" &&
    blocks[after]!.type === "paragraph"
  );
}

export function contentFromRenderDoc(
  blocks: readonly RenderBlock[],
  view: View = VIEWS.full,
): Content {
  const links: LinkRef[] = [];

  /** An item: its marker with its first line, then its other lines and blocks. */
  function itemInto(
    item: { marker: string; content: readonly RenderBlock[] },
    out: string[],
  ) {
    const [first, ...rest] = item.content;
    // The PDF sets an item's further paragraphs (and a hard-break continuation) close under the line
    // above, so they read as part of it: of the item's line, a paragraph's or a nested list's. Not of
    // a heading's or a table cell's: those are blocks of their own.
    let joinable = true;
    const addLine = (line: string) =>
      view.joinItemParagraphs && joinable
        ? void (out[out.length - 1] += " " + line)
        : void out.push(line);
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
    if (
      view.joinItemParagraphs &&
      first?.type !== "paragraph" &&
      out.length > markerAt + 1
    ) {
      out.splice(markerAt, 2, `${out[markerAt]} ${out[markerAt + 1]}`);
    }
  }

  function blocksInto(
    list: readonly RenderBlock[],
    out: string[],
    topLevel: boolean,
  ) {
    list.forEach((b, i) => {
      switch (b.type) {
        case "paragraph": {
          const segs = segments(rawText(b.content));
          if (segs.length) {
            out.push(...segs);
            linksOf(b.content, links);
          } else if (
            view.blanks === "all" ||
            (topLevel && betweenParagraphs(list, i))
          )
            out.push("∅");
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

// ── Typed spaces and breaks, as typed ────────────────────────────────────────

/**
 * The content text collapses whitespace, so it cannot see rule 10 (runs of spaces and leading spaces
 * render exactly as typed) or rule 11 (every hard break is a line break). This view keeps them: every
 * paragraph and heading with visible text, at any depth (top level, list items, cells, callouts), in
 * document order, as its lines (split at every hard break) with every space exactly as typed. A
 * no-break space counts as a space: the email HTML writes some typed spaces as no-break spaces on
 * purpose. (The plain text is compared exactly by plainTextProblems.)
 */
export function verbatimFromRenderDoc(
  blocks: readonly RenderBlock[],
): string[][] {
  const out: string[][] = [];
  const walk = (list: readonly RenderBlock[]) => {
    for (const block of list) {
      switch (block.type) {
        case "paragraph":
        case "heading":
          if (segments(rawText(block.content)).length > 0)
            out.push(verbatimLines(rawText(block.content)));
          break;
        case "list":
          for (const item of block.items) walk(item.content);
          break;
        case "table":
          for (const row of block.rows)
            for (const cell of row.cells) walk(cell.content);
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
export const verbatimLines = (raw: string) =>
  raw
    .replace(new RegExp(`${BREAK}[ ${NBSP}]$`), BREAK)
    .split(NBSP)
    .join(" ")
    .split(BREAK);
