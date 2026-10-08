// Email channel: { subject, preheader, html, text }.
//
// HTML: the conservative layout mail clients still need. A table-based 600px card, inline styles on
// every element (clients strip <style>; the one media query only tightens padding on phones), and
// the standard hidden preheader at the top of the body. Text: a plain-text alternative that reads
// well on its own (headings underlined, lists marked, tables as rows, links as "text (url)").
//
// Both print the RenderDoc as it is (docs/render-spec.md, "Email"): every list marker as text (the
// HTML lays lists out as two-cell rows Outlook keeps, never list-style numbering), blank paragraphs
// as blank lines, and spaces as typed (the HTML writes the no-break space technique, since mail
// clients collapse spaces and ignore `white-space`).
//
// The email <title> is the subject, as mail tools expect. The template name never appears.

import type { EmailFields, EmailRender, RenderBlock, RenderDoc, RenderInline, RenderListItem, RenderTable } from "@/domain/render/types";
import { normalizeLink } from "@/editor/model/links";
import {
  FONT_STACK,
  blocksHtml,
  escapeHtml,
  groupByLink,
  isHeaderRow,
  noBreakSpaces,
  type HtmlFlavor,
  type HtmlItem,
  type HtmlRole,
  type Place,
} from "./html";
import { CALLOUT_SHAPE, PALETTE } from "./look";

const C = PALETTE;

// ── HTML ─────────────────────────────────────────────────────────────────────

// Inline styles quote the font stack with single quotes so they sit inside style="…".
const FONT = `font-family:${FONT_STACK.replace(/"/g, "'")}`;
/** Body text size in px; the callout's shape (look.ts) is in ems of it. */
const TEXT_PX = 16;
const BODY_TEXT = `${FONT};font-size:${TEXT_PX}px;line-height:1.6;color:${C.text}`;

/** Each element's style, without its vertical margin (see MARGIN). */
const STYLE: Record<HtmlRole, string> = {
  p: BODY_TEXT,
  h1: `${FONT};font-size:26px;line-height:1.25;font-weight:bold;color:${C.text}`,
  h2: `${FONT};font-size:20px;line-height:1.3;font-weight:bold;color:${C.text}`,
  h3: `${FONT};font-size:17px;line-height:1.4;font-weight:bold;color:${C.text}`,
  table: `width:100%;border-collapse:collapse;border:1px solid ${C.hairline}`,
  th: `padding:8px 10px;border:1px solid ${C.hairline};background-color:${C.tableHead};text-align:left;vertical-align:top;${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:${C.text}`,
  td: `padding:8px 10px;border:1px solid ${C.hairline};text-align:left;vertical-align:top;${FONT};font-size:15px;line-height:1.5;color:${C.text}`,
  hr: `border:0;border-top:1px solid ${C.rule};height:0;line-height:0;font-size:0`,
  a: `color:${C.link};text-decoration:underline`,
  strong: "font-weight:bold",
  em: "font-style:italic",
  u: "text-decoration:underline",
};

/** [top, bottom] margins in px for block elements at the top level of the email. */
const MARGIN: Partial<Record<HtmlRole, readonly [number, number]>> = {
  p: [0, 16],
  h1: [0, 16],
  h2: [28, 10],
  h3: [22, 8],
  table: [4, 20],
  hr: [28, 28],
};

function styleFor(role: HtmlRole, place: Place): string {
  const margin = MARGIN[role];
  if (!margin) return STYLE[role];
  let [top, bottom] = margin;
  // Inside lists, cells and callouts paragraphs sit tighter.
  if (place.in !== "root" && role === "p") bottom = 8;
  // Blocks that open or close their container sit flush with it (the card's padding does the rest).
  if (place.first) top = 0;
  if (place.last) bottom = 0;
  return `margin:${top}px 0 ${bottom}px;${STYLE[role]}`;
}

const px = (em: number) => Math.round(em * TEXT_PX);

/** A list's [top, bottom] margin, and the space between its items, in px. */
const LIST_MARGIN = [0, 16] as const;
const ITEM_GAP = 6;
/** The marker column: at least this wide (it grows for a wide marker like "(viii)"), then a gap. */
const MARKER_WIDTH = 24;
const MARKER_GAP = 8;

/**
 * A list as a presentation table, one row per item: the marker, right-aligned in its own cell, then
 * the item's content. Outlook keeps this layout (it ignores list-style tricks and most CSS), the
 * marker is real text, and the item's further lines and blocks hang aligned after it.
 */
function listHtml(items: readonly HtmlItem[], place: Place): string {
  const top = place.first ? 0 : LIST_MARGIN[0];
  const bottom = place.last ? 0 : LIST_MARGIN[1];
  const rows = items.map((item) => {
    const gap = item.place.last ? 0 : ITEM_GAP;
    const marker = `width:${MARKER_WIDTH}px;padding:0 ${MARKER_GAP}px ${gap}px 0;vertical-align:top;text-align:right;white-space:nowrap;${BODY_TEXT}`;
    const content = `padding:0 0 ${gap}px;vertical-align:top;${BODY_TEXT}`;
    return `<tr><td style="${marker}">${item.marker}</td><td style="${content}">${item.content}</td></tr>`;
  });
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${top}px 0 ${bottom}px;width:100%;border-collapse:collapse;">`,
    ...rows,
    "</table>",
  ].join("\n");
}

/**
 * The callout matches the PDF's stone note: the same tint, hairline and radius, and the same
 * padding in proportion to its text. It draws no (i) glyph. Gmail and Outlook strip inline SVG; an
 * image needs hosting, and many clients block images by default; the text glyphs (ⓘ U+24D8,
 * ℹ U+2139) fall back to a different font in each client, and ℹ can render as a blue emoji on
 * iOS and Android. Without the glyph, the left side pads like the right.
 */
const CALLOUT_CELL = [
  `padding:${px(CALLOUT_SHAPE.padY)}px ${px(CALLOUT_SHAPE.padX)}px`,
  `background-color:${C.callout.fill}`,
  `border:1px solid ${C.callout.line}`,
  `border-radius:${px(CALLOUT_SHAPE.radius)}px`,
].join(";");

const EMAIL: HtmlFlavor = {
  attrs: (role, place) =>
    (role === "table" ? ' cellpadding="0" cellspacing="0" border="0" width="100%"' : "") +
    ` style="${styleFor(role, place)}"`,
  spaces: "nbsp",
  emptyLine: "&nbsp;",
  bareParagraph: true,
  list: (_ordered, items, place) => listHtml(items, place),
  wrapTable: (table) => table,
  callout: (content, place) =>
    [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${place.first ? 0 : 4}px 0 ${place.last ? 0 : 20}px;width:100%;border-collapse:separate;">`,
      `<tr><td style="${CALLOUT_CELL};${BODY_TEXT}">`,
      content,
      "</td></tr>",
      "</table>",
    ].join("\n"),
};

// Zero-width joiners and non-breaking spaces after the preheader stop clients from pulling the
// first lines of the body into the inbox preview.
const PREHEADER_FILL = "&#847;&zwnj;&nbsp;".repeat(60);

/** The hidden preheader. Its spaces use the no-break space technique, like the body's. */
function preheaderHtml(preheader: string): string {
  if (!preheader) return "";
  return `<span class="preheader" style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(noBreakSpaces(preheader))}${PREHEADER_FILL}</span>`;
}

function emailHtml(doc: RenderDoc, subject: string, preheader: string): string {
  return [
    "<!doctype html>",
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(subject)}</title>`,
    "<style>@media only screen and (max-width:620px){.email-outer{padding:12px 8px !important}.email-body{padding:24px 18px !important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">`,
    preheaderHtml(preheader),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${C.canvas};">`,
    `<tr><td class="email-outer" align="center" style="padding:24px 12px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:${C.page};border:1px solid ${C.hairline};border-radius:8px;border-collapse:separate;">`,
    `<tr><td class="email-body" style="padding:36px 40px;${BODY_TEXT};word-break:break-word;overflow-wrap:anywhere;">`,
    blocksHtml(doc.blocks, EMAIL),
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ── Plain text ───────────────────────────────────────────────────────────────
//
// The exact layout of docs/render-spec.md ("Plain text"), so a second engine writes the same bytes.
// Characters are written as typed (no-break spaces included) and nothing is trimmed; widths are
// counted in code points.

const RULE = "-".repeat(40);
const FRAME = `+${"-".repeat(39)}`;

const width = (line: string) => [...line].length;

const isBlank = (text: string) => text.trim() === "";

/** Ignoring case and one trailing "/". */
const sameAddress = (a: string, b: string) => a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

/**
 * "text (address)", where the address is the href without a leading mailto: or tel:. Just the text
 * when it already is the address (normalizeLink(text) is the href, or the text is the address);
 * just the address when the link text is blank.
 */
function linkText(text: string, href: string): string {
  const address = href.replace(/^(?:mailto:|tel:)/, "");
  if (isBlank(text)) return address;
  const shown = text.trim();
  const asLink = normalizeLink(shown);
  if ((asLink !== null && sameAddress(asLink, href)) || sameAddress(shown, address)) return text;
  return `${text} (${address})`;
}

/** Inline content as text. Hard breaks become newlines. */
export function inlineText(content: readonly RenderInline[]): string {
  return groupByLink(content)
    .map(({ href, items }) => {
      const text = items.map((item) => (item.type === "break" ? "\n" : item.text)).join("");
      return href === null ? text : linkText(text, href);
    })
    .join("");
}

/** Blocks as lines. `gap` puts an empty line between blocks (the top level, callouts); else none. */
function blocksLines(blocks: readonly RenderBlock[], gap: boolean): string[] {
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (gap && i > 0) lines.push("");
    lines.push(...blockLines(block));
  });
  return lines;
}

function blockLines(block: RenderBlock): string[] {
  switch (block.type) {
    case "paragraph":
      // An empty paragraph is one empty line; a paragraph of spaces is a line of those spaces.
      return inlineText(block.content).split("\n");
    case "heading": {
      const lines = inlineText(block.content).split("\n");
      // Level 1 is underlined with =, level 2 with -, level 3 not at all; a blank heading never is.
      if (block.level === 3 || lines.every(isBlank)) return lines;
      const mark = block.level === 1 ? "=" : "-";
      return [...lines, mark.repeat(Math.max(3, ...lines.map(width)))];
    }
    case "list":
      return block.items.flatMap(itemLines);
    case "table":
      return tableLines(block);
    case "callout":
      return [FRAME, ...blocksLines(block.content, true).map((line) => (line === "" ? "|" : `| ${line}`)), FRAME];
    case "rule":
      return [RULE];
  }
}

/**
 * The item's marker, a space and its first line; its further lines and blocks hang indented by the
 * marker's width plus one. Empty lines stay empty, and an item whose first line is empty is its
 * marker alone (no trailing space).
 */
function itemLines(item: RenderListItem): string[] {
  const indent = " ".repeat(width(item.marker) + 1);
  return blocksLines(item.content, false).map((line, i) => {
    if (i === 0) return line === "" ? item.marker : `${item.marker} ${line}`;
    return line === "" ? "" : indent + line;
  });
}

/**
 * Each row as lines. A cell's lines are its blocks' lines (an empty cell is one empty line); a row
 * has as many lines as its tallest cell. Row line j: each cell's line j (or "" when it has fewer),
 * every cell but the last padded with spaces to its longest line, joined with " | ", except that an
 * empty last piece is joined with " |". A row of header cells is underlined with -, unless it is the
 * table's last row.
 */
function tableLines(table: RenderTable): string[] {
  const out: string[] = [];
  table.rows.forEach((row, r) => {
    const cells = row.cells.map((cell) => (cell.content.length === 0 ? [""] : blocksLines(cell.content, false)));
    const widths = cells.map((lines) => Math.max(...lines.map(width)));
    const height = Math.max(0, ...cells.map((lines) => lines.length));
    const rowLines: string[] = [];
    for (let j = 0; j < height; j += 1) {
      let line = "";
      cells.forEach((lines, k) => {
        const piece = lines[j] ?? "";
        if (k === cells.length - 1) {
          line += k === 0 ? piece : piece === "" ? " |" : ` | ${piece}`;
        } else {
          const padded = piece + " ".repeat(widths[k]! - width(piece));
          line += k === 0 ? padded : ` | ${padded}`;
        }
      });
      rowLines.push(line);
    }
    out.push(...rowLines);
    if (isHeaderRow(row) && r < table.rows.length - 1) out.push("-".repeat(Math.max(3, ...rowLines.map(width))));
  });
  return out;
}

/** UTF-8 text, \n line endings, top-level blocks separated by an empty line, ending with one \n. */
function emailText(doc: RenderDoc): string {
  return `${blocksLines(doc.blocks, true).join("\n")}\n`;
}

// ── The adapter ──────────────────────────────────────────────────────────────

/**
 * Subject and preheader come resolved (resolveInlineField): one line, ends trimmed, runs of spaces
 * kept. They are returned as they are; a line break, which a resolved field never holds, would
 * become a space, so no caller can ever start a new mail header.
 */
const oneLine = (value: string) => value.replace(/\r\n|[\n\r\u2028\u2029]/g, " ").trim();

export function renderEmail(doc: RenderDoc, fields: EmailFields): EmailRender {
  const subject = oneLine(fields.subject);
  const preheader = oneLine(fields.preheader);
  return { subject, preheader, html: emailHtml(doc, subject, preheader), text: emailText(doc) };
}
