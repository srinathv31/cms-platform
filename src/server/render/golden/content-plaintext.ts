// The email's plain text as the RenderDoc dictates it (docs/render-spec.md section 10, "Plain text"),
// line by line, and the comparison with what the email adapter wrote. The layout rules are written out
// again here on purpose, not imported from the adapter, so a mistake in one shows as a difference
// from the other. See the header of content-text.ts for what each channel is compared with.

import type {
  RenderBlock,
  RenderInline,
  RenderTable,
} from "@/domain/render/types";
import { normalizeLink } from "@/editor/model/links";
import { diffBy } from "./diff";

// ── Email plain text ─────────────────────────────────────────────────────────

/** A piece of an expected plain-text line: text that must be there exactly, or loose layout. */
type Piece = { text: string } | { pattern: string; show: string };
/** An expected plain-text line; [] is an empty line. */
type TextLine = Piece[];

const exact = (text: string): Piece => ({ text });
/** Spaces the format adds for layout (an item's indent, a cell's padding): any number of them. */
const PAD: Piece = { pattern: " *", show: "" };
const underline = (mark: "=" | "-"): Piece => ({
  pattern: `${mark}{3,}`,
  show: mark.repeat(3),
});

const FRAME = `+${"-".repeat(39)}`;
const isBlank = (text: string) => text.trim() === "";
/** Ignoring case and one trailing "/". */
const sameAddress = (a: string, b: string) =>
  a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

/** A link in plain text: "text (address)", or just the text when it is the address, or just the address when the text is blank. */
function linkAsText(text: string, href: string): string {
  const address = href.replace(/^(?:mailto:|tel:)/, "");
  if (isBlank(text)) return address;
  const shown = text.trim();
  const asLink = normalizeLink(shown);
  if (
    (asLink !== null && sameAddress(asLink, href)) ||
    sameAddress(shown, address)
  )
    return text;
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

const plainLines = (content: readonly RenderInline[]): TextLine[] =>
  plainInline(content)
    .split("\n")
    .map((line) => (line === "" ? [] : [exact(line)]));

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
      return block.level === 3 || blank
        ? lines
        : [...lines, [underline(block.level === 1 ? "=" : "-")]];
    }
    case "list":
      // The marker and a space before the first line (the marker alone when it is empty); the
      // further lines indented, empty ones empty.
      return block.items.flatMap((item) =>
        textBlocks(item.content, false).map((line, k): TextLine => {
          if (k === 0)
            return line.length === 0
              ? [exact(item.marker)]
              : [exact(`${item.marker} `), ...line];
          return line.length === 0 ? [] : [PAD, ...line];
        }),
      );
    case "table":
      return textTable(block);
    case "callout":
      return [
        [exact(FRAME)],
        ...textBlocks(block.content, true).map((line): TextLine =>
          line.length === 0 ? [exact("|")] : [exact("| "), ...line],
        ),
        [exact(FRAME)],
      ];
    case "rule":
      return [[exact("-".repeat(40))]];
  }
}

/** Each row as lines: line j is every cell's line j (or nothing), joined by " | " (an empty last piece by " |"). */
function textTable(table: RenderTable): TextLine[] {
  const out: TextLine[] = [];
  table.rows.forEach((row, r) => {
    const cells = row.cells.map((cell): TextLine[] =>
      cell.content.length === 0 ? [[]] : textBlocks(cell.content, false),
    );
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
    const header =
      row.cells.length > 0 && row.cells.every((cell) => cell.header);
    if (header && r < table.rows.length - 1) out.push([underline("-")]);
  });
  return out;
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ExpectedLine {
  show: string;
  pattern: RegExp;
}

/** The plain text the RenderDoc dictates, line by line (docs/render-spec.md section 10). */
export function plainTextFromRenderDoc(
  blocks: readonly RenderBlock[],
): ExpectedLine[] {
  const lines = textBlocks(blocks, true);
  // No blocks is one empty line ("\n").
  return (lines.length ? lines : [[]]).map((line) => ({
    show: line
      .map((piece) => ("text" in piece ? piece.text : piece.show))
      .join(""),
    pattern: new RegExp(
      `^${line.map((piece) => ("text" in piece ? escapeRegExp(piece.text) : piece.pattern)).join("")}$`,
    ),
  }));
}

/** Problems with the email's plain text ([] when every line is the one the RenderDoc dictates). */
export function plainTextProblems(
  blocks: readonly RenderBlock[],
  text: string,
): string[] {
  if (!text.endsWith("\n"))
    return ["email.txt: does not end with a line break"];
  const expected = plainTextFromRenderDoc(blocks);
  const actual = text.slice(0, -1).split("\n");
  const d = diffBy(
    expected,
    actual,
    (e, a) => e.pattern.test(a),
    (e) => e.show,
  );
  return d.ok
    ? []
    : [
        `email.txt: content differs from the RenderDoc\n${d.lines.map((l) => "    " + l).join("\n")}`,
      ];
}
