// The import's pure rules (Phase 7a): what a converted .docx, .pdf or .txt becomes as a new draft.
// Placeholders → Text chips, the content type's required sections found or added, the template's
// name, plain text and PDF lines → blocks, and the report as short lines. Pure TypeScript: the
// converters (src/server/import/*) hand over schema JSON; block ids come after (ensureBlockIds).
// The contract, with every rule spelled out, is src/domain/import-types.ts.

import { sectionTitleKey } from "@/editor/model/section-title";
import { isValidKey, labelFromKey, toKey } from "@/editor/model/variables";
import {
  IMPORT_LIMITS,
  type ImportRefusalCode,
  type DetectedPlaceholder,
  type FinishImportInput,
  type FinishedImport,
  type ImportDrop,
  type ImportReport,
  type ImportReportLines,
  type SectionFit,
  type SkippedPlaceholder,
} from "./import-types";
import { UNTITLED_TEMPLATE_NAME } from "./lifecycle";
import { plural, pluralWord } from "./plural";
import type { JSONContent, RequiredSection, Variable } from "./types";

/** Template names are 1 to 120 characters (the name field's rule). */
const MAX_NAME_LENGTH = 120;

/** Stands in for an inline atom (a chip, a line break) when a block's text runs are joined. */
const ATOM = "￼";

// ── Placeholders ─────────────────────────────────────────────────────────────

/** What a `{{inner}}` token is: a key (it becomes a chip), template logic, or something else. */
export type PlaceholderClass = { kind: "key"; key: string } | { kind: "logic" } | { kind: "invalid" };

const LOGIC_START = /^[#/^>!&]/;
const LOGIC_ELSE = /^else\b/;
const LOGIC_CHARS = /[|()=]/;
const NAME = /^[A-Za-z][A-Za-z0-9 _.-]*$/;
const MAX_NAME_PLACEHOLDER = 64;

/**
 * The contract's rules, in order: template logic (`{{#if member}}`, `{{/if}}`, `{{else}}`,
 * `{{x | upper}}`) stays text; a valid key is itself; a name ("First Name", "OfferEndDate") becomes
 * `toKey(name)`; anything else stays text.
 */
export function classifyPlaceholder(inner: string): PlaceholderClass {
  const text = inner.trim();
  if (LOGIC_START.test(text) || LOGIC_ELSE.test(text) || LOGIC_CHARS.test(text)) return { kind: "logic" };
  if (isValidKey(text)) return { kind: "key", key: text };
  if (text.length <= MAX_NAME_PLACEHOLDER && NAME.test(text)) {
    const key = toKey(text);
    if (isValidKey(key)) return { kind: "key", key };
  }
  return { kind: "invalid" };
}

export interface PlaceholderToken {
  /** As written, braces included. */
  raw: string;
  inner: string;
  /** Offset of the first brace in the scanned text. */
  index: number;
  class: PlaceholderClass;
}

/** Every `{{…}}` token in a run of text (no braces inside; an inline atom ends a token). */
export function scanPlaceholders(text: string): PlaceholderToken[] {
  const tokens: PlaceholderToken[] = [];
  for (const match of text.matchAll(/\{\{([^{}￼]*)\}\}/g)) {
    tokens.push({ raw: match[0], inner: match[1], index: match.index ?? 0, class: classifyPlaceholder(match[1]) });
  }
  return tokens;
}

export interface AppliedPlaceholders {
  body: JSONContent;
  placeholders: DetectedPlaceholder[];
  skipped: SkippedPlaceholder[];
}

/**
 * Turns each key placeholder into a `variable` chip. A block's text runs are joined first, so a
 * placeholder split by formatting is still one token; the chip takes the marks of the run it starts
 * in. Keys are deduped in order of first use, with every spelling listed; logic and invalid tokens
 * stay as text and are reported.
 */
export function applyPlaceholders(body: JSONContent): AppliedPlaceholders {
  const detected = new Map<string, DetectedPlaceholder>();
  const skipped = new Map<string, SkippedPlaceholder>();

  const visit = (node: JSONContent): JSONContent => {
    const content = node.content;
    if (!content?.length) return node;
    if (content.some((child) => child.type === "text")) {
      const next = chipInline(content, detected, skipped);
      return next === content ? node : { ...node, content: next };
    }
    let changed = false;
    const next = content.map((child) => {
      const out = visit(child);
      if (out !== child) changed = true;
      return out;
    });
    return changed ? { ...node, content: next } : node;
  };

  return { body: visit(body), placeholders: [...detected.values()], skipped: [...skipped.values()] };
}

function chipInline(
  content: JSONContent[],
  detected: Map<string, DetectedPlaceholder>,
  skipped: Map<string, SkippedPlaceholder>,
): JSONContent[] {
  const starts: number[] = [];
  let joined = "";
  for (const child of content) {
    starts.push(joined.length);
    joined += child.type === "text" ? (child.text ?? "") : ATOM;
  }
  if (!joined.includes("{{")) return content;

  const chips: { start: number; end: number; key: string }[] = [];
  for (const token of scanPlaceholders(joined)) {
    if (token.class.kind === "key") {
      const key = token.class.key;
      const entry = detected.get(key) ?? { key, label: labelFromKey(key), raw: [], count: 0 };
      if (!entry.raw.includes(token.raw)) entry.raw.push(token.raw);
      entry.count += 1;
      detected.set(key, entry);
      chips.push({ start: token.index, end: token.index + token.raw.length, key });
    } else {
      const entry = skipped.get(token.raw) ?? { raw: token.raw, reason: token.class.kind, count: 0 };
      entry.count += 1;
      skipped.set(token.raw, entry);
    }
  }
  if (!chips.length) return content;

  const out: JSONContent[] = [];
  content.forEach((child, i) => {
    if (child.type !== "text") {
      out.push(child);
      return;
    }
    const text = child.text ?? "";
    const start = starts[i];
    const end = start + text.length;
    const piece = (from: number, to: number) => {
      if (to > from) out.push(withMarks({ type: "text", text: text.slice(from - start, to - start) }, child.marks));
    };
    let at = start;
    for (const chip of chips) {
      if (chip.end <= start || chip.start >= end) continue;
      if (chip.start >= start) {
        piece(at, chip.start);
        out.push(withMarks({ type: "variable", attrs: { key: chip.key } }, child.marks));
      }
      at = Math.max(at, Math.min(chip.end, end));
    }
    piece(at, end);
  });
  return out;
}

function withMarks(node: JSONContent, marks: JSONContent["marks"]): JSONContent {
  return marks?.length ? { ...node, marks } : node;
}

/** The variables an import creates: Text, required, no sample (sample sets fill it). */
export function importedVariables(placeholders: readonly DetectedPlaceholder[]): Variable[] {
  return placeholders.map((p) => ({ key: p.key, label: p.label, type: "text", required: true, sample: "" }));
}

// ── Required sections ────────────────────────────────────────────────────────

export interface FittedSections {
  body: JSONContent;
  fit: SectionFit;
}

/**
 * Finds the content type's sections by text, in order: a top-level heading (any level) or an
 * all-bold paragraph whose normalized text is the section's title, after the previous section's
 * match. A match becomes the required H2 with the canonical title; a section not found is added
 * empty right before the next matched one, or at the end. The result has every section once, in order.
 */
export function fitRequiredSections(body: JSONContent, sections: readonly RequiredSection[]): FittedSections {
  const blocks = body.content ?? [];
  const keys = sections.map((s) => sectionTitleKey(s.title));
  const matchedAt = new Map<number, number>();
  let next = 0;
  blocks.forEach((block, i) => {
    if (next >= sections.length || !isSectionCandidate(block)) return;
    const text = sectionTitleKey(plainText(block));
    if (!text) return;
    for (let j = next; j < sections.length; j++) {
      if (keys[j] === text) {
        matchedAt.set(i, j);
        next = j + 1;
        return;
      }
    }
  });

  const fit: SectionFit = { matched: [], added: [] };
  const out: JSONContent[] = [];
  let emitted = 0;
  const addMissing = (upTo: number) => {
    for (; emitted < upTo; emitted++) {
      const s = sections[emitted];
      out.push(requiredHeading(s));
      fit.added.push({ key: s.key, title: s.title });
    }
  };

  blocks.forEach((block, i) => {
    const j = matchedAt.get(i);
    if (j === undefined) {
      out.push(clearRequiredKey(block));
      return;
    }
    addMissing(j);
    const s = sections[j];
    const id = typeof block.attrs?.id === "string" ? block.attrs.id : undefined;
    out.push(requiredHeading(s, id));
    fit.matched.push({ key: s.key, title: s.title, from: plainText(block).replace(/\s+/g, " ").trim() });
    emitted = j + 1;
  });
  addMissing(sections.length);

  return { body: { ...body, type: "doc", content: out }, fit };
}

function requiredHeading(section: RequiredSection, id?: string): JSONContent {
  return {
    type: "heading",
    attrs: { ...(id ? { id } : {}), level: 2, requiredKey: section.key },
    content: [{ type: "text", text: section.title }],
  };
}

function clearRequiredKey(block: JSONContent): JSONContent {
  if (block.type !== "heading" || block.attrs?.requiredKey == null) return block;
  return { ...block, attrs: { ...block.attrs, requiredKey: null } };
}

function isSectionCandidate(block: JSONContent): boolean {
  if (block.type === "heading") return true;
  if (block.type !== "paragraph" || !block.content?.length) return false;
  const texts = block.content.filter((c) => c.type === "text" && (c.text ?? "").trim());
  return (
    texts.length > 0 &&
    block.content.every((c) => c.type === "text") &&
    texts.every((c) => c.marks?.some((m) => m.type === "bold"))
  );
}

/** The text of a node and its descendants (chips as `{{key}}`, line breaks as spaces). */
export function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") return `{{${String(node.attrs?.key ?? "")}}}`;
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(plainText).join("");
}

// ── The template's name ──────────────────────────────────────────────────────

export interface TakenTitle {
  body: JSONContent;
  /** The leading H1's text; null when the document doesn't start with one. */
  title: string | null;
}

/**
 * When the first non-empty block is an H1 (Word's Title or Heading 1), its text is the name and the
 * block goes. An H1 that is itself one of `sections` is a section, not a title.
 */
export function takeTitle(body: JSONContent, sections: readonly RequiredSection[] = []): TakenTitle {
  const blocks = body.content ?? [];
  const first = blocks.findIndex((b) => !isEmptyBlock(b));
  const block = blocks[first];
  if (!block || block.type !== "heading" || Number(block.attrs?.level) !== 1) return { body, title: null };
  const text = clampName(plainText(block));
  if (!text) return { body, title: null };
  const key = sectionTitleKey(text);
  if (sections.some((s) => sectionTitleKey(s.title) === key)) return { body, title: null };
  return { body: { ...body, content: blocks.slice(first + 1) }, title: text };
}

function isEmptyBlock(block: JSONContent): boolean {
  return block.type === "paragraph" && !plainText(block).trim();
}

/**
 * The name when the document has no title: the file name without its extension, `_` and `-` as
 * spaces, the first letter capitalized, at most 120 characters. "spring_offer-2027.docx" → "Spring offer 2027".
 */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "");
  const stem = base.replace(/\.[^.]*$/, "") || base;
  const words = clampName(stem.replace(/[_-]+/g, " "));
  if (!words) return UNTITLED_TEMPLATE_NAME;
  return words[0].toUpperCase() + words.slice(1);
}

function clampName(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
}

/**
 * Which refusal a file gets when its bytes are none of the importable kinds, by what its name
 * claims: a legacy .doc (there is a way forward), a "PDF" or "Word file" that isn't one, or a kind
 * we don't take at all. The browser makes the same call from the first bytes, before sending.
 */
export function refusalForUnreadableKind(filename: string): ImportRefusalCode {
  const name = filename.trim();
  if (/\.doc$/i.test(name)) return "legacyDoc";
  if (/\.pdf$/i.test(name)) return "notPdf";
  if (/\.docx$/i.test(name)) return "notWord";
  return "type";
}

/**
 * The client's file name as display text: no folders, no control characters, whitespace collapsed,
 * at most 120 characters (the extension kept). Never used in a path.
 */
export function sanitizeFilename(name: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "file";
  const max = IMPORT_LIMITS.maxFilenameLength;
  if (base.length <= max) return base;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(base)?.[0] ?? "";
  return base.slice(0, max - ext.length).trimEnd() + ext;
}

// ── Plain text ───────────────────────────────────────────────────────────────

/**
 * A .txt as paragraphs: a blank line separates paragraphs (the lines inside one are joined); with
 * no blank line anywhere, each line is one paragraph. A BOM and Windows line ends are fine.
 */
export function textToBody(text: string): JSONContent {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  const blank = /\n[ \t]*\n/;
  const chunks = blank.test(clean) ? clean.split(/\n(?:[ \t]*\n)+/) : clean.split("\n");
  const content = chunks
    .map((chunk) => chunk.split("\n").map((line) => line.trim()).filter(Boolean).reduce(joinLine, ""))
    .filter(Boolean)
    .map(paragraph);
  return { type: "doc", content };
}

/** Joins a wrapped line: with a space, or with none when the text so far ends inside a `{{`. */
export function joinLine(text: string, line: string): string {
  if (!text) return line;
  if (!line) return text;
  return insidePlaceholder(text) ? text + line : `${text} ${line}`;
}

function insidePlaceholder(text: string): boolean {
  return text.lastIndexOf("{{") > text.lastIndexOf("}}");
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

// ── PDF lines ────────────────────────────────────────────────────────────────

/** One text item from pdf.js, in page units: `y` is the baseline measured from the top of the page. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  /** Width of the run. */
  w: number;
  /** Font size (the item's height). */
  h: number;
}

export interface PdfPageText {
  items: PdfTextItem[];
}

export interface PdfBody {
  body: JSONContent;
  /** Distinct lines dropped for repeating at the top or bottom of most pages. */
  repeatedLines: number;
}

interface Line {
  page: number;
  text: string;
  y: number;
  h: number;
}

const BULLET = /^[•·▪◦‣∙●○■□–—*-]\s+(.*)$/;
const NUMBERED = /^\d{1,3}[.)]\s+(.*)$/;
/** Lines this many times the body size or more are headings (H1 from 1.6×). */
const HEADING_RATIO = 1.25;
const TITLE_RATIO = 1.6;

/**
 * PDF text as blocks. Lines come from the items' y; a gap between baselines of more than 1.5× the
 * line height starts a new paragraph; `•` / `-` / `1.` lines become lists; lines repeated at the
 * top or bottom of most pages (running headers, page numbers) go; a line ending inside `{{` joins
 * the next with no space. Lines set clearly larger than the body text become headings.
 */
export function pdfLinesToBody(pages: readonly PdfPageText[]): PdfBody {
  const perPage = pages.map((page, i) => linesOf(page.items, i));
  const { kept, repeated } = dropRepeatedLines(perPage);
  const lines = kept.flat();
  if (!lines.length) return { body: { type: "doc", content: [] }, repeatedLines: repeated };

  const bodySize = bodyFontSize(lines);
  const level = (line: Line): 0 | 1 | 2 =>
    line.h >= bodySize * TITLE_RATIO ? 1 : line.h >= bodySize * HEADING_RATIO ? 2 : 0;

  type Block =
    | { kind: "heading"; level: 1 | 2; text: string; last: Line }
    | { kind: "paragraph"; text: string; last: Line }
    | { kind: "item"; ordered: boolean; text: string; last: Line };

  const blocks: Block[] = [];
  for (const line of lines) {
    const prev = blocks[blocks.length - 1];
    const lineLevel = level(line);
    const bullet = lineLevel === 0 ? BULLET.exec(line.text) : null;
    const numbered = lineLevel === 0 && !bullet ? NUMBERED.exec(line.text) : null;

    if (bullet || numbered) {
      blocks.push({ kind: "item", ordered: Boolean(numbered), text: (bullet ?? numbered)![1], last: line });
      continue;
    }
    if (prev && continues(prev.last, line, prev.text) && (prev.kind === "heading" ? prev.level === lineLevel : lineLevel === 0)) {
      prev.text = joinLine(prev.text, line.text);
      prev.last = line;
      continue;
    }
    blocks.push(lineLevel ? { kind: "heading", level: lineLevel, text: line.text, last: line } : { kind: "paragraph", text: line.text, last: line });
  }

  const content: JSONContent[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      content.push({ type: "heading", attrs: { level: block.level }, content: [{ type: "text", text: block.text }] });
    } else if (block.kind === "paragraph") {
      content.push(paragraph(block.text));
    } else {
      const type = block.ordered ? "orderedList" : "bulletList";
      const item: JSONContent = { type: "listItem", content: [paragraph(block.text)] };
      const last = content[content.length - 1];
      if (last?.type === type) last.content = [...(last.content ?? []), item];
      else content.push({ type, content: [item] });
    }
  }
  return { body: { type: "doc", content }, repeatedLines: repeated };
}

/** Whether `line` carries on the block that ended with `last` (no paragraph break between them). */
function continues(last: Line, line: Line, text: string): boolean {
  if (Math.abs(line.h - last.h) > Math.max(line.h, last.h) * 0.15) return false;
  if (line.page !== last.page) {
    // A paragraph running over a page break: it didn't end a sentence, and the next line goes on.
    return insidePlaceholder(text) || (!/[.!?:;]$/.test(text) && /^[a-z{]/.test(line.text));
  }
  const gap = line.y - last.y;
  return gap > 0 && gap <= 1.5 * Math.max(line.h, last.h);
}

function linesOf(items: readonly PdfTextItem[], page: number): Line[] {
  const sorted = items.filter((it) => it.str.length > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(item.y - ref.y) <= Math.max(ref.h, item.h) * 0.4) row.push(item);
    else rows.push([item]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let prev: PdfTextItem | null = null;
    for (const item of row) {
      if (prev) {
        const gap = item.x - (prev.x + prev.w);
        if (gap > Math.max(prev.h, item.h) * 0.2 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      }
      text += item.str;
      prev = item;
    }
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean) lines.push({ page, text: clean, y: row[0].y, h: Math.max(...row.map((it) => it.h)) });
  }
  return lines;
}

/** Lines within this many of a page's top or bottom are checked for repeats. */
const EDGE = 2;

/**
 * A line repeats when the same text (digits ignored, so page numbers match) sits in the same edge
 * slot (first, second, last or second-to-last line) on more than half of the pages.
 */
function dropRepeatedLines(pages: Line[][]): { kept: Line[][]; repeated: number } {
  if (pages.length < 2) return { kept: pages, repeated: 0 };
  const shape = (line: Line) => line.text.toLowerCase().replace(/\d+/g, "#");
  const slots = (lines: Line[]): [string, Line][] => {
    const out: [string, Line][] = [];
    for (let i = 0; i < Math.min(EDGE, lines.length); i++) {
      out.push([`t${i}`, lines[i]], [`b${i}`, lines[lines.length - 1 - i]]);
    }
    return out;
  };
  const seen = new Map<string, number>();
  for (const lines of pages) {
    for (const key of new Set(slots(lines).map(([slot, line]) => `${slot}|${shape(line)}`))) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const repeated = new Set([...seen].filter(([, n]) => n > pages.length / 2).map(([key]) => key));
  if (!repeated.size) return { kept: pages, repeated: 0 };
  const kept = pages.map((lines) => {
    const drop = new Set(slots(lines).filter(([slot, line]) => repeated.has(`${slot}|${shape(line)}`)).map(([, line]) => line));
    return lines.filter((line) => !drop.has(line));
  });
  return { kept, repeated: new Set([...repeated].map((key) => key.slice(key.indexOf("|") + 1))).size };
}

/** The font size most of the text is set in: the median weighted by characters. */
function bodyFontSize(lines: readonly Line[]): number {
  const sorted = [...lines].sort((a, b) => a.h - b.h);
  const total = sorted.reduce((sum, l) => sum + l.text.length, 0);
  let seen = 0;
  for (const line of sorted) {
    seen += line.text.length;
    if (seen * 2 >= total) return line.h;
  }
  return sorted[sorted.length - 1]?.h ?? 0;
}

// ── Finishing ────────────────────────────────────────────────────────────────

/**
 * The shared finishing step for every kind: the name (a leading H1, else the file name), the
 * placeholders as chips and Text variables, the required sections fitted, and the report.
 */
export function finishImport(input: FinishImportInput): FinishedImport {
  const { file, requiredSections } = input;
  const filename = sanitizeFilename(input.filename);
  const titled = takeTitle(file.body, requiredSections);
  const applied = applyPlaceholders(titled.body);
  const fitted = fitRequiredSections(applied.body, requiredSections);

  const report: ImportReport = {
    kind: file.kind,
    filename,
    size: input.size,
    ...(file.pages !== undefined ? { pages: file.pages } : {}),
    nameFrom: titled.title ? "title" : "filename",
    placeholders: applied.placeholders,
    skippedPlaceholders: applied.skipped,
    sections: fitted.fit,
    counts: countBlocks(fitted.body),
    dropped: file.dropped,
  };
  return {
    name: titled.title ?? nameFromFilename(filename),
    body: fitted.body,
    variables: importedVariables(applied.placeholders),
    report,
  };
}

/** Top-level blocks by kind (required section headings and empty paragraphs not counted). */
export function countBlocks(body: JSONContent): ImportReport["counts"] {
  const counts = { headings: 0, paragraphs: 0, lists: 0, tables: 0 };
  for (const block of body.content ?? []) {
    if (block.type === "heading" && block.attrs?.requiredKey == null) counts.headings++;
    else if (block.type === "paragraph" && plainText(block).trim()) counts.paragraphs++;
    else if (block.type === "bulletList" || block.type === "orderedList") counts.lists++;
    else if (block.type === "table") counts.tables++;
  }
  return counts;
}

// ── The report as lines ──────────────────────────────────────────────────────

function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function describeDrop(drop: ImportDrop): string {
  switch (drop.kind) {
    case "images":
      // The Original tab still draws a .docx's images.
      return `${plural(drop.count, "image")} (still shown in Original)`;
    case "comments":
      return plural(drop.count, "comment");
    case "footnotes":
      return plural(drop.count, "footnote");
    case "headers_footers":
      return "Headers and footers";
    case "styles":
      // "Quote formatting", "Quote and Caption formatting": what the author sees in the file, not "Word style".
      return `${andList(drop.names)} formatting`;
    case "pdf_layout":
      return "Layout and images (PDF text only)";
    case "repeated_lines":
      return `${plural(drop.count, "repeated header or footer line")}`;
  }
}

/** The name a block token carries: `{{#if member}}` and `{{/if}}` are both "if". */
function blockName(raw: string): { sigil: string; name: string } | null {
  const match = /^\{\{\s*([#^/])\s*([^\s}]+)/.exec(raw);
  return match ? { sigil: match[1], name: match[2] } : null;
}

const AS_WRITTEN = "shows to customers as written.";

/**
 * Template logic and other braces left in the text, one line per conditional: a `{{#if x}}` is
 * paired with the `{{/if}}` that closes it (and the `{{else}}` between them), so "{{#if member}} …
 * {{/if}} shows to customers as written." is one line, not three. Anything that doesn't pair (a
 * lone `{{x | upper}}`, an unclosed opener, braces that aren't a name) is a line of its own.
 */
export function keptLines(skipped: readonly SkippedPlaceholder[]): string[] {
  const closersLeft = new Map<string, number>();
  const closerRaw = new Map<string, string>();
  for (const s of skipped) {
    const block = blockName(s.raw);
    if (block?.sigil !== "/") continue;
    closersLeft.set(block.name, (closersLeft.get(block.name) ?? 0) + s.count);
    if (!closerRaw.has(block.name)) closerRaw.set(block.name, s.raw);
  }

  type Opener = { raw: string; closer: string | null; hasElse: boolean };
  const openers: Opener[] = [];
  const alone: string[] = [];
  let latest: Opener | null = null;
  for (const s of skipped) {
    const block = blockName(s.raw);
    if (block?.sigil === "/") continue;
    if (block) {
      // Each opener takes one closer of its name, in order.
      const left = closersLeft.get(block.name) ?? 0;
      if (left > 0) closersLeft.set(block.name, left - 1);
      latest = { raw: s.raw, closer: left > 0 ? (closerRaw.get(block.name) ?? null) : null, hasElse: false };
      openers.push(latest);
    } else if (latest && /^\{\{\s*else\b/.test(s.raw)) {
      latest.hasElse = true;
    } else {
      alone.push(s.raw);
    }
  }
  // A closer with no opener to take it is its own line.
  for (const [name, left] of closersLeft) if (left > 0) alone.push(closerRaw.get(name)!);

  const blocks = openers.map((o) => {
    const middle = o.hasElse ? "{{else}} … " : "";
    return o.closer ? `${o.raw} … ${middle}${o.closer} ${AS_WRITTEN}` : `${o.raw} ${middle ? `… ${middle}` : ""}${AS_WRITTEN}`;
  });
  return [...blocks, ...alone.map((raw) => `${raw} ${AS_WRITTEN}`)];
}

/**
 * The report as short, calm lines for the Original view. Detected: the variables (with labels, and
 * that they are all Text and required), pages, headings, lists and tables, the sections that were
 * added, and where the text sits when no section was found. Dropped: what didn't come across.
 * Kept as text: template logic that stays in the document as written.
 */
export function describeImport(report: ImportReport): ImportReportLines {
  const detected: string[] = [];
  const vars = report.placeholders;
  // An import makes every variable Text and required; the author sees that once, here.
  if (vars.length) {
    const kind = vars.length === 1 ? "Text and required" : "all Text and required";
    detected.push(`${plural(vars.length, "variable")}, ${kind}: ${vars.map((p) => p.label).join(", ")}`);
  }
  if (report.pages) detected.push(plural(report.pages, "page"));
  const { headings, paragraphs, lists, tables } = report.counts;
  if (headings) detected.push(plural(headings, "heading"));
  if (lists) detected.push(plural(lists, "list"));
  if (tables) detected.push(plural(tables, "table"));
  const added = report.sections.added;
  if (added.length) detected.push(`Added empty ${pluralWord(added.length, "section")}: ${andList(added.map((s) => s.title))}`);
  // No section was found in the file, so the sections are all new and the text sits above the first.
  if (report.sections.matched.length === 0 && headings === 0 && paragraphs + lists + tables > 0) {
    detected.push("The text stays above the first section");
  }

  return { detected, dropped: report.dropped.map(describeDrop), kept: keptLines(report.skippedPlaceholders) };
}
