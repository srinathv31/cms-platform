// Markdown in pasted plain text (Copilot's answer, a README, a note) → the small HTML the editor's
// schema understands, so it pastes as headings, lists and tables rather than literal `##` and `|`.
// The document editor's paste uses it when the clipboard has only text that looks like Markdown
// (field-binding.ts); one-line fields never do.
//
// Supported: ATX headings `#`–`######` (h4–h6 become h3, as in the HTML normalizer), `-`/`*`/`+` and
// `1.`/`1)` lists nested by indent, pipe tables with a header row, `---`/`***`/`___` rules,
// blank-line paragraphs (single newlines join with a space; two trailing spaces or a trailing `\`
// make a line break), **bold**/__bold__, *italic*/_italic_, ***both***, and `[text](https://…)`
// links (http, https and mailto; any other link keeps its text only). Code spans and fences, quotes,
// strikethrough and images have no place in the schema: their text stays, the syntax goes.
//
// Text is HTML-escaped; `{{key}}` is left exactly as written (the paste's chip transform turns it
// into a chip afterwards), and its underscores never read as emphasis. Pure string work: no DOM.

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const EMPTY_HEADING = /^ {0,3}#{1,6}[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const QUOTE = /^ {0,3}>[ \t]?/;
const DIVIDER_CELL = /^[ \t]*:?-+:?[ \t]*$/;

/** Inline syntax that only Markdown writes: `**bold**` or a `[link](https://…)`. */
const INLINE_MARKDOWN = /\*\*[^*\s][^*]*\*\*|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)/;

/**
 * True when plain text reads as Markdown: a `#` heading, a list item, a pipe table, a rule between
 * lines, a code fence, or inline `**bold**` / `[text](https://…)`. Ordinary prose, and `{{key}}` on
 * its own, are not Markdown.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING.test(line) || FENCE.test(line) || (ITEM.test(line) && !RULE.test(line))) return true;
    if (isTableStart(lines, i)) return true;
    if (lines.length > 1 && RULE.test(line)) return true;
  }
  return INLINE_MARKDOWN.test(text);
}

/** Markdown → schema HTML (p, h1–h3, ul/ol/li, table/tr/th/td, strong, em, a, br, hr). */
export function markdownToHtml(markdown: string): string {
  return blocksToHtml(splitLines(markdown));
}

// ── Blocks ───────────────────────────────────────────────────────

function splitLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r\n?|\n/);
}

const isBlank = (line: string) => line.trim() === "";

/** Columns of leading whitespace (a tab counts as four). */
function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** A line that starts a block of its own (it ends a paragraph or a list). */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return HEADING.test(line) || EMPTY_HEADING.test(line) || RULE.test(line) || FENCE.test(line) || isTableStart(lines, index);
}

function blocksToHtml(lines: string[]): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) out.push(`<p>${inlineLines(paragraph)}</p>`);
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      endParagraph();
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      endParagraph();
      // A code block has no place in the schema: its lines stay, as plain paragraphs.
      const marker = fence[1];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        if (!isBlank(lines[i])) out.push(`<p>${escapeHtml(lines[i].trim())}</p>`);
        i++;
      }
      i++; // the closing fence
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading || EMPTY_HEADING.test(line)) {
      endParagraph();
      const text = heading ? heading[2].trim() : "";
      if (text) {
        const level = Math.min(heading![1].length, 3);
        out.push(`<h${level}>${inline(text)}</h${level}>`);
      }
      i++;
      continue;
    }

    if (RULE.test(line)) {
      endParagraph();
      out.push("<hr>");
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      endParagraph();
      i = table(lines, i, out);
      continue;
    }

    if (ITEM.test(line)) {
      endParagraph();
      i = list(lines, i, out);
      continue;
    }

    paragraph.push(line.replace(QUOTE, ""));
    i++;
  }
  endParagraph();
  return out.join("");
}

// ── Tables ───────────────────────────────────────────────────────

/** Cells of a pipe-table row: outer pipes optional, `\|` is a literal pipe. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isDivider(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell));
}

/** A header row (it has a pipe) directly over a `|---|---|` divider. */
function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index];
  const next = lines[index + 1];
  return line.includes("|") && next !== undefined && next.includes("|") && isDivider(next) && !isDivider(line);
}

/** Writes the table starting at `start`; returns the index after it. */
function table(lines: string[], start: number, out: string[]): number {
  const header = splitRow(lines[start]);
  const width = header.length;
  const cells = (row: string[], tag: "th" | "td") =>
    Array.from({ length: width }, (_, column) => `<${tag}><p>${inline(row[column] ?? "")}</p></${tag}>`).join("");

  const rows = [`<tr>${cells(header, "th")}</tr>`];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|") && !startsBlock(lines, i)) {
    rows.push(`<tr>${cells(splitRow(lines[i]), "td")}</tr>`);
    i++;
  }
  out.push(`<table><tbody>${rows.join("")}</tbody></table>`);
  return i;
}

// ── Lists ────────────────────────────────────────────────────────

interface ListItem {
  /** Paragraphs of the item, each a run of lines. */
  paragraphs: string[][];
  lists: List[];
}

interface List {
  ordered: boolean;
  start: number;
  indent: number;
  items: ListItem[];
}

/**
 * Writes the list (and the lists nested in it) starting at `start`; returns the index after it.
 * An item indented deeper than the one above it starts a list inside that item; a shallower one
 * goes back out to the list at its depth. A different marker kind at the same depth starts a
 * sibling list. Indented lines continue the item above (after a blank line, as a new paragraph).
 */
function list(lines: string[], start: number, out: string[]): number {
  const roots: List[] = [];
  const stack: List[] = [];
  let afterBlank = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      afterBlank = true;
      i++;
      continue;
    }

    const item = RULE.test(line) ? null : ITEM.exec(line);
    if (item) {
      const indent = indentOf(item[1]);
      const ordered = /\d/.test(item[2]);
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
      let top = stack.at(-1);
      if (top && indent < top.indent) top.indent = indent; // a shallower first level: same list
      if (!top || indent > top.indent) {
        const nested: List = { ordered, start: ordered ? parseInt(item[2], 10) : 1, indent, items: [] };
        if (top) top.items[top.items.length - 1].lists.push(nested);
        else roots.push(nested);
        stack.push(nested);
        top = nested;
      } else if (top.ordered !== ordered) {
        const sibling: List = { ordered, start: ordered ? parseInt(item[2], 10) : 1, indent, items: [] };
        stack.pop();
        const parent = stack.at(-1);
        if (parent) parent.items[parent.items.length - 1].lists.push(sibling);
        else roots.push(sibling);
        stack.push(sibling);
        top = sibling;
      }
      top.items.push({ paragraphs: [[item[3]]], lists: [] });
      afterBlank = false;
      i++;
      continue;
    }

    // Not an item: a continuation of the item above, or the end of the list.
    const top = stack.at(-1);
    if (!top || startsBlock(lines, i) || (afterBlank && indentOf(line) <= stack[0].indent)) break;
    const current = top.items[top.items.length - 1];
    if (afterBlank) current.paragraphs.push([line.trim()]);
    else current.paragraphs[current.paragraphs.length - 1].push(line.trim());
    afterBlank = false;
    i++;
  }

  out.push(roots.map(listHtml).join(""));
  // Blank lines that trailed the list belong to whatever follows.
  while (i > start && isBlank(lines[i - 1])) i--;
  return i;
}

function listHtml(list: List): string {
  const items = list.items
    .map((item) => {
      const paragraphs = item.paragraphs.map((lines) => `<p>${inlineLines(lines)}</p>`).join("");
      return `<li>${paragraphs}${item.lists.map(listHtml).join("")}</li>`;
    })
    .join("");
  if (!list.ordered) return `<ul>${items}</ul>`;
  return list.start === 1 ? `<ol>${items}</ol>` : `<ol start="${list.start}">${items}</ol>`;
}

// ── Inline ───────────────────────────────────────────────────────

/** The lines of one paragraph: joined with a space, or a line break after `  ` or `\`. */
function inlineLines(lines: string[]): string {
  return lines
    .map((line, index) => {
      const last = index === lines.length - 1;
      const hard = !last && (/ {2,}$/.test(line) || /\\$/.test(line));
      const text = inline(line.trim().replace(/\\$/, (match) => (last ? match : "")));
      return last ? text : `${text}${hard ? "<br>" : " "}`;
    })
    .join("");
}

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|>~])/g;
const SAFE_HREF = /^(?:https?:\/\/|mailto:)[^\s"<>]+$/i;
const URL_TEXT = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,:;!?)\]'*_]/g;

/**
 * One line of inline Markdown → HTML. Pieces that must come through untouched (`{{key}}`, escapes,
 * code, link tags, bare URLs) are set aside as numbered placeholders before the emphasis rules run,
 * then put back.
 */
function inline(text: string): string {
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;

  let s = text
    .replace(/\{\{[^{}\n]*\}\}/g, (match) => keep(escapeHtml(match)))
    .replace(ESCAPABLE, (_, char: string) => keep(escapeHtml(char)))
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) => keep(escapeHtml(code.trim())))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (_, label: string, href: string) =>
      SAFE_HREF.test(href) ? `${keep(`<a href="${escapeHtml(href)}">`)}${label}${keep("</a>")}` : label,
    )
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_, href: string) =>
      keep(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`),
    )
    .replace(URL_TEXT, (url) => keep(escapeHtml(url)));

  s = escapeHtml(s)
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>")
    .replace(/(^|[^*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");

  // Placeholders can nest (a `{{key}}` inside a code span): restore until none are left.
  const restore = (value: string): string => value.replace(/\u0000(\d+)\u0000/g, (_, n: string) => restore(kept[Number(n)]));
  return restore(s);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
