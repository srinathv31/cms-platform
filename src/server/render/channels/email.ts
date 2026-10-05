// Email channel: { subject, preheader, html, text }.
//
// HTML: the conservative layout mail clients still need. A table-based 600px card, inline styles on
// every element (clients strip <style>; the one media query only tightens padding on phones), and
// the standard hidden preheader at the top of the body. Text: a plain-text alternative that reads
// well on its own (headings underlined, lists marked, tables as rows, links as "text (url)").
//
// The email <title> is the subject, as mail tools expect. The template name never appears.

import type { EmailFields, EmailRender, RenderBlock, RenderDoc, RenderInline } from "@/domain/render/types";
import {
  FONT_STACK,
  blocksHtml,
  escapeHtml,
  groupByLink,
  isBlankInline,
  type HtmlFlavor,
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
  ul: `padding:0 0 0 24px;${BODY_TEXT}`,
  ol: `padding:0 0 0 24px;${BODY_TEXT}`,
  li: BODY_TEXT,
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
  ul: [0, 16],
  ol: [0, 16],
  li: [0, 6],
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

function preheaderHtml(preheader: string): string {
  if (!preheader) return "";
  return `<span class="preheader" style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}${PREHEADER_FILL}</span>`;
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

const RULE = "-".repeat(40);
const FRAME = `+${"-".repeat(39)}`;

const width = (line: string) => [...line].length;

/** "text (url)", or just the text when it already is the address. mailto: and tel: show bare. */
function linkText(text: string, href: string): string {
  const address = href.replace(/^(?:mailto:|tel:)/i, "");
  const shown = text.trim();
  if (!shown) return address;
  const same = (a: string, b: string) => a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();
  if (same(shown, href) || same(shown, address)) return text;
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

const indent = (text: string, first: string, rest: string) =>
  text
    .split("\n")
    .map((line, i) => (line === "" ? "" : (i === 0 ? first : rest) + line))
    .join("\n");

function underline(text: string, mark: "=" | "-"): string {
  const longest = Math.max(...text.split("\n").map(width));
  return `${text}\n${mark.repeat(Math.max(longest, 3))}`;
}

/** Each block as one chunk; chunks are separated by a blank line. */
function blockChunks(blocks: readonly RenderBlock[]): string[] {
  const chunks: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        if (!isBlankInline(block.content)) chunks.push(inlineText(block.content).trim());
        break;
      case "heading": {
        const text = inlineText(block.content).trim();
        if (!text) break;
        chunks.push(block.level === 1 ? underline(text, "=") : block.level === 2 ? underline(text, "-") : text);
        break;
      }
      case "list": {
        const items = block.items.map((item, i) => {
          const marker = block.ordered ? `${block.start + i}. ` : "- ";
          const body = blockChunks(item.content).join("\n");
          return indent(body || "", marker, " ".repeat(marker.length));
        });
        chunks.push(items.join("\n"));
        break;
      }
      case "table": {
        const lines: string[] = [];
        block.rows.forEach((row, i) => {
          const line = row.cells
            .map((cell) => blockChunks(cell.content).join(" ").replace(/\s*\n\s*/g, " "))
            .join(" | ");
          lines.push(line);
          const isHead = row.cells.length > 0 && row.cells.every((c) => c.header);
          if (isHead && i < block.rows.length - 1) lines.push("-".repeat(Math.max(width(line), 3)));
        });
        chunks.push(lines.join("\n"));
        break;
      }
      case "callout": {
        const inner = blockChunks(block.content).join("\n\n");
        const framed = inner
          .split("\n")
          .map((line) => (line === "" ? "|" : `| ${line}`))
          .join("\n");
        chunks.push(`${FRAME}\n${framed}\n${FRAME}`);
        break;
      }
      case "rule":
        chunks.push(RULE);
        break;
    }
  }
  return chunks;
}

function emailText(doc: RenderDoc): string {
  return `${blockChunks(doc.blocks).join("\n\n")}\n`;
}

// ── The adapter ──────────────────────────────────────────────────────────────

/** Subject and preheader are single lines: any newline or run of whitespace becomes one space. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function renderEmail(doc: RenderDoc, fields: EmailFields): EmailRender {
  const subject = oneLine(fields.subject);
  const preheader = oneLine(fields.preheader);
  return { subject, preheader, html: emailHtml(doc, subject, preheader), text: emailText(doc) };
}
