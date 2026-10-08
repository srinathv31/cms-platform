// RenderBlock → HTML, shared by the web and email adapters. The structure (escaping, links, marks,
// blank lines, tables, callouts) lives here once; each adapter supplies a flavor that says how
// elements are styled and laid out: the web adapter with a few class names and one <style> block,
// the email adapter with inline styles on every element because mail clients strip <style>.
//
// Adapters print the RenderDoc as it is (docs/render-spec.md, "Channels"): every block, in order;
// every list item's marker as text (never the browser's or mail client's numbering); blank
// paragraphs as blank lines; spaces and hard breaks exactly as typed.
//
// Customer output, not Stencil UI: the adapters take every raw color from PALETTE (look.ts), the one
// constants block all three channels read.

import type { RenderBlock, RenderInline, RenderTableRow, RenderText } from "@/domain/render/types";
import { normalizeLink } from "@/editor/model/links";

// ── Type (customer output only) ──────────────────────────────────────────────

export const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

// ── Escaping ─────────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "\u00A0": "&nbsp;",
};

/**
 * Escapes text for element content and for double- or single-quoted attribute values. A no-break
 * space (U+00A0) is written `&nbsp;`; every other character is written as itself.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'\u00A0]/g, (ch) => ESCAPES[ch]!);
}

// ── Spaces (email) ───────────────────────────────────────────────────────────

/**
 * The no-break space technique for one line of text (spec section 4): mail clients collapse runs of
 * spaces and ignore `white-space`, so a U+0020 becomes U+00A0 when it is the line's first or last
 * character, or when the character written just before it is a U+0020. "a···b" → "a␠⍽␠b",
 * "··Lead" → "⍽␠Lead", "End··" → "End␠⍽", "···" → "⍽␠⍽" (⍽ = U+00A0, ␠ = U+0020).
 */
export function noBreakSpaces(line: string): string {
  let out = "";
  const last = line.length - 1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    out += ch === " " && (i === 0 || i === last || out.endsWith(" ")) ? "\u00A0" : ch;
  }
  return out;
}

/** Applies `noBreakSpaces` to each line of inline content (its runs between breaks, taken together). */
export function keepSpaces(content: readonly RenderInline[]): RenderInline[] {
  const out = content.map((item): RenderInline => (item.type === "text" ? { ...item } : item));
  let line: RenderText[] = [];
  const flush = () => {
    const spaced = noBreakSpaces(line.map((run) => run.text).join(""));
    let at = 0;
    for (const run of line) {
      const length = run.text.length;
      run.text = spaced.slice(at, at + length);
      at += length;
    }
    line = [];
  };
  for (const item of out) {
    if (item.type === "break") flush();
    else line.push(item);
  }
  flush();
  return out;
}

// ── Flavors ──────────────────────────────────────────────────────────────────

export type HtmlRole = "p" | "h1" | "h2" | "h3" | "table" | "th" | "td" | "hr" | "a" | "strong" | "em" | "u";

/** Where a block sits. Email uses it for spacing; the web stylesheet gets the same from selectors. */
export interface Place {
  in: "root" | "list" | "cell" | "callout";
  /** The first block of its container (email drops its top margin). */
  first: boolean;
  /** The last block of its container (email drops its bottom margin). */
  last: boolean;
}

/** A list item, rendered: its marker (escaped text) and its content (HTML). */
export interface HtmlItem {
  marker: string;
  content: string;
  place: Place;
}

export interface HtmlFlavor {
  /**
   * Extra attributes for an element, with a leading space (` class="…"`, ` style="…"`, layout
   * attributes), or "". Flavors return constants only, never document text.
   */
  attrs(role: HtmlRole, place: Place): string;
  /**
   * How spaces survive as typed: "pre-wrap" leaves them to the stylesheet (`white-space: pre-wrap`
   * on text containers); "nbsp" writes the no-break space technique into the text.
   */
  spaces: "pre-wrap" | "nbsp";
  /**
   * What an empty last line holds so it still takes its line: "<br>" or "&nbsp;". Browsers and mail
   * clients collapse a block's final <br>, so an empty paragraph or heading, and the line after a
   * hard break that ends one, would otherwise vanish.
   */
  emptyLine: string;
  /** Whether a list item or table cell holding a single paragraph gets its inline content without a <p>. */
  bareParagraph: boolean;
  /** Lays out a list: each item's marker as text before its content, as a hanging indent. */
  list(ordered: boolean, items: readonly HtmlItem[], place: Place): string;
  /** Wraps a table: the web scrolls it sideways on phones; email adds its spacing. */
  wrapTable(table: string, place: Place): string;
  /** Builds a callout around its rendered content. */
  callout(content: string, place: Place): string;
}

// ── Links ────────────────────────────────────────────────────────────────────

/** Consecutive pieces that share a link, so "Read **our terms**" becomes one anchor. */
export interface LinkGroup {
  href: string | null;
  items: RenderInline[];
}

/**
 * Groups inline content by link. Every href goes through normalizeLink, the one link rule, so a
 * RenderDoc from anywhere can never put `javascript:` (or anything else) in an href. A hard break
 * joins a link only when the runs on both sides of it carry that link; otherwise it stands outside.
 */
export function groupByLink(content: readonly RenderInline[]): LinkGroup[] {
  const hrefs = content.map((item) => (item.type === "text" ? normalizeLink(item.href) : null));
  // For each position, the href of the next text run at or after it.
  const ahead: (string | null)[] = new Array(content.length + 1).fill(null);
  for (let i = content.length - 1; i >= 0; i -= 1) {
    ahead[i] = content[i]!.type === "text" ? (hrefs[i] ?? null) : (ahead[i + 1] ?? null);
  }
  const groups: LinkGroup[] = [];
  content.forEach((item, i) => {
    const last = groups[groups.length - 1];
    let href: string | null = hrefs[i] ?? null;
    if (item.type === "break") {
      const before = last?.href ?? null;
      href = before !== null && before === ahead[i + 1] ? before : null;
    }
    if (last && last.href === href) last.items.push(item);
    else groups.push({ href, items: [item] });
  });
  return groups;
}

// ── Inline ───────────────────────────────────────────────────────────────────

function runHtml(run: RenderText, flavor: HtmlFlavor, place: Place): string {
  let html = escapeHtml(run.text);
  if (run.underline) html = `<u${flavor.attrs("u", place)}>${html}</u>`;
  if (run.italic) html = `<em${flavor.attrs("em", place)}>${html}</em>`;
  if (run.bold) html = `<strong${flavor.attrs("strong", place)}>${html}</strong>`;
  return html;
}

/**
 * Inline content as HTML. An empty last line (empty content, or content that ends with a hard break)
 * holds the flavor's `emptyLine`, so every line the author made takes its line.
 */
export function inlineHtml(content: readonly RenderInline[], flavor: HtmlFlavor, place: Place): string {
  if (content.length === 0) return flavor.emptyLine;
  const spaced = flavor.spaces === "nbsp" ? keepSpaces(content) : content;
  const html = groupByLink(spaced)
    .map(({ href, items }) => {
      const inner = items.map((item) => (item.type === "break" ? "<br>" : runHtml(item, flavor, place))).join("");
      return href === null ? inner : `<a href="${escapeHtml(href)}"${flavor.attrs("a", place)}>${inner}</a>`;
    })
    .join("");
  return content[content.length - 1]!.type === "break" ? html + flavor.emptyLine : html;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** Renders every block, in order. Blank paragraphs are lines the author typed: they render too. */
export function blocksHtml(
  blocks: readonly RenderBlock[],
  flavor: HtmlFlavor,
  container: Place["in"] = "root",
): string {
  return blocks
    .map((block, i) => blockHtml(block, flavor, { in: container, first: i === 0, last: i === blocks.length - 1 }))
    .join("\n");
}

/**
 * A list item's or table cell's content. With `bareParagraph` (email), a single paragraph's inline
 * content goes in directly, without a <p>: tighter markup, and no stray paragraph margins.
 */
function flowHtml(blocks: readonly RenderBlock[], flavor: HtmlFlavor, container: "list" | "cell"): string {
  const only = blocks[0];
  if (flavor.bareParagraph && blocks.length === 1 && only?.type === "paragraph") {
    return inlineHtml(only.content, flavor, { in: container, first: true, last: true });
  }
  return blocksHtml(blocks, flavor, container);
}

function blockHtml(block: RenderBlock, flavor: HtmlFlavor, place: Place): string {
  switch (block.type) {
    case "paragraph":
      return `<p${flavor.attrs("p", place)}>${inlineHtml(block.content, flavor, place)}</p>`;
    case "heading": {
      const tag = `h${block.level}` as const;
      return `<${tag}${flavor.attrs(tag, place)}>${inlineHtml(block.content, flavor, place)}</${tag}>`;
    }
    case "list": {
      const items = block.items.map(
        (item, i): HtmlItem => ({
          marker: escapeHtml(item.marker),
          content: flowHtml(item.content, flavor, "list"),
          place: { in: "list", first: i === 0, last: i === block.items.length - 1 },
        }),
      );
      return flavor.list(block.ordered, items, place);
    }
    case "table":
      return flavor.wrapTable(tableHtml(block.rows, flavor, place), place);
    case "callout":
      return flavor.callout(blocksHtml(block.content, flavor, "callout"), place);
    case "rule":
      return `<hr${flavor.attrs("hr", place)}>`;
  }
}

export const isHeaderRow = (row: RenderTableRow) => row.cells.length > 0 && row.cells.every((c) => c.header);

function tableHtml(rows: readonly RenderTableRow[], flavor: HtmlFlavor, place: Place): string {
  // Leading rows made only of header cells become <thead>, so screen readers announce columns.
  let headCount = 0;
  while (headCount < rows.length - 1 && isHeaderRow(rows[headCount]!)) headCount++;

  const rowHtml = (row: RenderTableRow, inHead: boolean) => {
    const cells = row.cells
      .map((cell) => {
        const tag = cell.header ? "th" : "td";
        const scope = cell.header ? ` scope="${inHead ? "col" : "row"}"` : "";
        const span =
          (cell.colspan > 1 ? ` colspan="${Math.trunc(cell.colspan)}"` : "") +
          (cell.rowspan > 1 ? ` rowspan="${Math.trunc(cell.rowspan)}"` : "");
        return `<${tag}${scope}${span}${flavor.attrs(tag, { in: "cell", first: true, last: true })}>${flowHtml(cell.content, flavor, "cell")}</${tag}>`;
      })
      .join("");
    return `<tr>${cells}</tr>`;
  };

  const head = rows.slice(0, headCount).map((r) => rowHtml(r, true));
  const body = rows.slice(headCount).map((r) => rowHtml(r, false));
  return (
    `<table${flavor.attrs("table", place)}>\n` +
    (head.length ? `<thead>\n${head.join("\n")}\n</thead>\n` : "") +
    `<tbody>\n${body.join("\n")}\n</tbody>\n</table>`
  );
}
