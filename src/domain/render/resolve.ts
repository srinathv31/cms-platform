// Resolves a version's TipTap JSON and its canonical values into a channel-neutral RenderDoc body.
// A pure walk over the JSON: no TipTap runtime here, so it ports to the Java API as is.
//
// It handles exactly the editor schema's nodes and marks (HANDLED_NODES, HANDLED_MARKS; a server
// test keeps them in step with src/editor/schema.ts). Anything else throws a ResolveError: the
// server checks every document against the editor schema first, so reaching one means drift.
//
//   variable chip   a text run of the value formatted for its type, carrying the chip's marks and
//                   `variable: key`. A key that isn't in the list, or has no value, renders nothing.
//   text            adjacent runs with identical marks merge (never into a variable's run); a "\n"
//                   in the JSON becomes a break.
//   link            only http(s), mailto and tel hrefs survive; otherwise the text stays, unlinked.
//   the document    trailing empty paragraphs (the editor's trailing line) are dropped; empty
//                   paragraphs inside the document stay.

import { formatValue } from "@/editor/model/variables";
import type { JSONContent, Variable } from "../types";
import type {
  CanonicalValues,
  RenderBlock,
  RenderInline,
  RenderListItem,
  RenderTableCell,
  RenderTableRow,
  RenderText,
  ResolveContext,
} from "./types";

/** Every node name the resolver understands: exactly the editor schema's. */
export const HANDLED_NODES: readonly string[] = [
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "callout",
  "horizontalRule",
  "hardBreak",
  "text",
  "variable",
];

/** Every mark name the resolver understands: exactly the editor schema's. */
export const HANDLED_MARKS: readonly string[] = ["bold", "italic", "underline", "link"];

/** JSON the resolver can't place: an unknown node or mark, or a known node in the wrong spot. */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

interface Scope {
  byKey: ReadonlyMap<string, Variable>;
  values: CanonicalValues;
}

function scopeOf(ctx: ResolveContext): Scope {
  return { byKey: new Map(ctx.variables.map((v) => [v.key, v])), values: ctx.values };
}

// ── Public ───────────────────────────────────────────────────────────────────

/** The document's blocks, resolved. `body` must be a `doc`. */
export function resolveDocument(body: JSONContent, ctx: ResolveContext): RenderBlock[] {
  if (body?.type !== "doc") throw new ResolveError(`Expected a "doc" node, got "${String(body?.type)}".`);
  const out = blocks(body.content, scopeOf(ctx));
  while (out.length > 0 && isEmptyParagraph(out[out.length - 1])) out.pop();
  return out;
}

/**
 * The plain text of a one-line field (email subject, preheader): its text plus resolved variables,
 * with whitespace collapsed and trimmed. `null` gives "".
 */
export function resolveInlineField(field: JSONContent | null, ctx: ResolveContext): string {
  if (!field) return "";
  const scope = scopeOf(ctx);
  const resolved = field.type === "doc" ? blocks(field.content, scope) : [block(field, scope)];
  return plainText(resolved).replace(/\s+/g, " ").trim();
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function blocks(nodes: JSONContent[] | undefined, scope: Scope): RenderBlock[] {
  return (nodes ?? []).map((node) => block(node, scope));
}

function block(node: JSONContent, scope: Scope): RenderBlock {
  const id = blockId(node);
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", id, content: inlines(node, scope) };
    case "heading":
      return {
        type: "heading",
        id,
        level: headingLevel(node.attrs?.level),
        section: nonEmptyString(node.attrs?.requiredKey),
        content: inlines(node, scope),
      };
    case "bulletList":
    case "orderedList":
      return {
        type: "list",
        id,
        ordered: node.type === "orderedList",
        start: node.type === "orderedList" && Number.isInteger(node.attrs?.start) ? (node.attrs!.start as number) : 1,
        items: (node.content ?? []).map((child) => listItem(child, scope)),
      };
    case "table":
      return { type: "table", id, rows: (node.content ?? []).map((child) => tableRow(child, scope)) };
    case "callout":
      return { type: "callout", id, content: blocks(node.content, scope) };
    case "horizontalRule":
      return { type: "rule", id };
    default:
      throw misplaced(node, "a block");
  }
}

function listItem(node: JSONContent, scope: Scope): RenderListItem {
  if (node.type !== "listItem") throw misplaced(node, "a list item");
  return { content: blocks(node.content, scope) };
}

function tableRow(node: JSONContent, scope: Scope): RenderTableRow {
  if (node.type !== "tableRow") throw misplaced(node, "a table row");
  return { cells: (node.content ?? []).map((child) => tableCell(child, scope)) };
}

function tableCell(node: JSONContent, scope: Scope): RenderTableCell {
  if (node.type !== "tableCell" && node.type !== "tableHeader") throw misplaced(node, "a table cell");
  return {
    header: node.type === "tableHeader",
    colspan: span(node.attrs?.colspan),
    rowspan: span(node.attrs?.rowspan),
    content: blocks(node.content, scope),
  };
}

function blockId(node: JSONContent): string | null {
  return nonEmptyString(node.attrs?.id);
}

function headingLevel(value: unknown): 1 | 2 | 3 {
  const n = Number(value);
  return n >= 3 ? 3 : n === 2 ? 2 : 1;
}

function span(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isEmptyParagraph(b: RenderBlock): boolean {
  return b.type === "paragraph" && b.content.length === 0;
}

// ── Inline ───────────────────────────────────────────────────────────────────

type MarkSet = Pick<RenderText, "bold" | "italic" | "underline" | "href">;

function inlines(node: JSONContent, scope: Scope): RenderInline[] {
  const out: RenderInline[] = [];
  for (const child of node.content ?? []) {
    switch (child.type) {
      case "text":
        pushText(out, typeof child.text === "string" ? child.text : "", marksOf(child.marks));
        break;
      case "hardBreak":
        out.push({ type: "break" });
        break;
      case "variable": {
        const marks = marksOf(child.marks);
        const run = variableRun(child, scope, marks);
        if (run) out.push(run);
        break;
      }
      default:
        throw misplaced(child, "inline content");
    }
  }
  return out;
}

/** Plain text, split on line breaks, merged into the previous run when the marks match. */
function pushText(out: RenderInline[], text: string, marks: MarkSet) {
  text.split(/\r\n|\r|\n/).forEach((part, i) => {
    if (i > 0) out.push({ type: "break" });
    if (part === "") return;
    const last = out[out.length - 1];
    if (last?.type === "text" && last.variable === undefined && sameMarks(last, marks)) {
      last.text += part;
    } else {
      out.push({ type: "text", text: part, ...marks });
    }
  });
}

function variableRun(node: JSONContent, scope: Scope, marks: MarkSet): RenderText | null {
  const key = node.attrs?.key;
  if (typeof key !== "string") return null;
  const variable = scope.byKey.get(key);
  if (!variable || !Object.prototype.hasOwnProperty.call(scope.values, key)) return null;
  // Values are inline: a line break inside one (a pasted address) reads as a space.
  const text = formatValue(variable.type, scope.values[key]).replace(/\s*(?:\r\n|\r|\n)\s*/g, " ").trim();
  if (text === "") return null;
  return { type: "text", text, ...marks, variable: key };
}

function marksOf(marks: JSONContent["marks"]): MarkSet {
  const set: MarkSet = {};
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        set.bold = true;
        break;
      case "italic":
        set.italic = true;
        break;
      case "underline":
        set.underline = true;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (href) set.href = href;
        break;
      }
      default:
        throw new ResolveError(`Unknown mark "${String(mark.type)}".`);
    }
  }
  return set;
}

function sameMarks(a: MarkSet, b: MarkSet): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.href === b.href;
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** http(s), mailto and tel only; anything else (javascript:, data:, relative) is dropped. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  return SAFE_HREF.test(href) && !CONTROL.test(href) ? href : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function plainText(list: readonly RenderBlock[]): string {
  return list
    .map((b): string => {
      switch (b.type) {
        case "paragraph":
        case "heading":
          return b.content.map((i) => (i.type === "text" ? i.text : " ")).join("");
        case "list":
          return b.items.map((item) => plainText(item.content)).join(" ");
        case "table":
          return b.rows.map((row) => row.cells.map((cell) => plainText(cell.content)).join(" ")).join(" ");
        case "callout":
          return plainText(b.content);
        case "rule":
          return "";
      }
    })
    .join(" ");
}

function misplaced(node: JSONContent, expected: string): ResolveError {
  const name = String(node?.type);
  return HANDLED_NODES.includes(name)
    ? new ResolveError(`A "${name}" node can't appear where ${expected} belongs.`)
    : new ResolveError(`Unknown node "${name}".`);
}
