// RenderBlock → HTML, shared by the web and email adapters. The structure (escaping, links, marks,
// lists, tables, callouts) lives here once; each adapter supplies a flavor that says how elements
// are styled: the web adapter with a few class names and one <style> block, the email adapter with
// inline styles on every element because mail clients strip <style>.
//
// Customer output, not UCOMP UI: the adapters take every raw color from PALETTE (look.ts), the one
// constants block all three channels read.

import type { RenderBlock, RenderInline, RenderTableRow, RenderText } from "@/domain/render/types";

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
};

/** Escapes text for element content and for double- or single-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;
// Whitespace, controls and the invisible separators a hostile URL can hide behind.
const UNSAFE_HREF_CHARS = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/;

/**
 * Resolution already drops links that aren't http(s), mailto or tel. The adapters check again so a
 * RenderDoc from anywhere can never put `javascript:` (or anything else) in an href.
 */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!SAFE_HREF.test(trimmed) || UNSAFE_HREF_CHARS.test(trimmed)) return null;
  return trimmed;
}

// ── Flavors ──────────────────────────────────────────────────────────────────

export type HtmlRole =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "li"
  | "table"
  | "th"
  | "td"
  | "hr"
  | "a"
  | "strong"
  | "em"
  | "u";

/** Where a block sits. Email uses it for spacing; the web stylesheet gets the same from selectors. */
export interface Place {
  in: "root" | "list" | "cell" | "callout";
  /** The first block of its container (email drops its top margin). */
  first: boolean;
  /** The last block of its container (email drops its bottom margin). */
  last: boolean;
}

export interface HtmlFlavor {
  /**
   * Extra attributes for an element, with a leading space (` class="…"`, ` style="…"`, layout
   * attributes), or "". Flavors return constants only, never document text.
   */
  attrs(role: HtmlRole, place: Place): string;
  /** Wraps a table: the web scrolls it sideways on phones; email adds its spacing. */
  wrapTable(table: string, place: Place): string;
  /** Builds a callout around its rendered content. */
  callout(content: string, place: Place): string;
}

// ── Inline ───────────────────────────────────────────────────────────────────

function runHtml(run: RenderText, flavor: HtmlFlavor, place: Place): string {
  let html = escapeHtml(run.text);
  if (run.underline) html = `<u${flavor.attrs("u", place)}>${html}</u>`;
  if (run.italic) html = `<em${flavor.attrs("em", place)}>${html}</em>`;
  if (run.bold) html = `<strong${flavor.attrs("strong", place)}>${html}</strong>`;
  return html;
}

/** Consecutive pieces that share a link, so "Read **our terms**" becomes one anchor. */
interface LinkGroup {
  href: string | null;
  items: RenderInline[];
}

export function groupByLink(content: readonly RenderInline[]): LinkGroup[] {
  const groups: LinkGroup[] = [];
  for (const item of content) {
    const last = groups.at(-1);
    // A hard break stays with whatever comes before it, so it never splits a link in two.
    const href = item.type === "break" ? (last?.href ?? null) : safeHref(item.href);
    if (last && last.href === href) last.items.push(item);
    else groups.push({ href, items: [item] });
  }
  return groups;
}

export function inlineHtml(content: readonly RenderInline[], flavor: HtmlFlavor, place: Place): string {
  return groupByLink(content)
    .map(({ href, items }) => {
      const inner = items
        .map((item) => (item.type === "break" ? "<br>" : runHtml(item, flavor, place)))
        .join("");
      return href === null ? inner : `<a href="${escapeHtml(href)}"${flavor.attrs("a", place)}>${inner}</a>`;
    })
    .join("");
}

/** True when a paragraph has nothing to show (empty, whitespace, or only breaks). */
export function isBlankInline(content: readonly RenderInline[]): boolean {
  return content.every((item) => item.type === "break" || item.text.trim() === "");
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/**
 * Renders blocks in order. Blank paragraphs are dropped: in the editor they are spacing, and an
 * optional variable with no value can leave one behind.
 */
export function blocksHtml(
  blocks: readonly RenderBlock[],
  flavor: HtmlFlavor,
  container: Place["in"] = "root",
): string {
  const visible = blocks.filter((b) => !(b.type === "paragraph" && isBlankInline(b.content)));
  return visible
    .map((block, i) => blockHtml(block, flavor, { in: container, first: i === 0, last: i === visible.length - 1 }))
    .join("\n");
}

/**
 * List items and table cells that hold a single paragraph get its inline content directly, without
 * a <p>: tighter markup, and email clients add no stray paragraph margins.
 */
function flowHtml(blocks: readonly RenderBlock[], flavor: HtmlFlavor, container: "list" | "cell"): string {
  const visible = blocks.filter((b) => !(b.type === "paragraph" && isBlankInline(b.content)));
  const only = visible[0];
  if (visible.length === 1 && only?.type === "paragraph") {
    return inlineHtml(only.content, flavor, { in: container, first: true, last: true });
  }
  return blocksHtml(visible, flavor, container);
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
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start !== 1 ? ` start="${Math.trunc(block.start)}"` : "";
      const items = block.items
        .map((item, i) => {
          const itemPlace: Place = { in: "list", first: i === 0, last: i === block.items.length - 1 };
          return `<li${flavor.attrs("li", itemPlace)}>${flowHtml(item.content, flavor, "list")}</li>`;
        })
        .join("\n");
      return `<${tag}${start}${flavor.attrs(tag, place)}>\n${items}\n</${tag}>`;
    }
    case "table":
      return flavor.wrapTable(tableHtml(block.rows, flavor, place), place);
    case "callout":
      return flavor.callout(blocksHtml(block.content, flavor, "callout"), place);
    case "rule":
      return `<hr${flavor.attrs("hr", place)}>`;
  }
}

const isHeaderRow = (row: RenderTableRow) => row.cells.length > 0 && row.cells.every((c) => c.header);

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
