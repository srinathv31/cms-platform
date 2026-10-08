// The RenderDoc's promises (docs/render-spec.md section 9, "Invariants"), checked on every case so a
// resolver bug shows up as a named problem rather than as a puzzling difference in one channel.

import type { RenderBlock, RenderInline, RenderList, RenderTable } from "@/domain/render/types";
import { BULLET_GLYPHS, MAX_LIST_DEPTH, formatMarker, isListStart } from "@/editor/model/list-markers";
import { INVISIBLE_CHARACTERS, normalizeLink } from "@/editor/model/links";
import { MAX_TABLE_COLUMNS } from "@/editor/model/table-grid";

const INVISIBLE = new RegExp(`[${INVISIBLE_CHARACTERS}]`, "u");
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/; // includes tab, CR, LF

function inlineProblems(where: string, content: readonly RenderInline[], out: string[]) {
  for (const run of content) {
    if (run.type === "break") continue;
    if (run.text === "") out.push(`${where}: an empty text run`);
    if (run.text !== run.text.normalize("NFC")) out.push(`${where}: text is not NFC: ${JSON.stringify(run.text)}`);
    if (CONTROL.test(run.text)) out.push(`${where}: text holds a control, tab or line-break character: ${JSON.stringify(run.text)}`);
    if (INVISIBLE.test(run.text)) out.push(`${where}: text holds an invisible character: ${JSON.stringify(run.text)}`);
    if (run.href !== undefined && normalizeLink(run.href) !== run.href) out.push(`${where}: href is not normalized: ${run.href}`);
  }
  for (let i = 1; i < content.length; i += 1) {
    const a = content[i - 1]!;
    const b = content[i]!;
    if (a.type === "text" && b.type === "text" && a.variable === undefined && b.variable === undefined) {
      const same = (["bold", "italic", "underline", "href"] as const).every((k) => a[k] === b[k]);
      if (same) out.push(`${where}: two adjacent runs with the same marks were not merged`);
    }
  }
}

function listProblems(where: string, list: RenderList, depth: number, out: string[]) {
  if (depth > MAX_LIST_DEPTH) out.push(`${where}: lists nest more than ${MAX_LIST_DEPTH} deep`);
  if (list.items.length === 0) out.push(`${where}: a list with no items`);
  if (list.ordered && !isListStart(list.start)) out.push(`${where}: start ${list.start} is not an integer from 0 to 9999`);
  list.items.forEach((item, i) => {
    const at = `${where} item ${i + 1}`;
    const expected = list.ordered ? formatMarker(list.start + i, list.format, list.delimiter) : BULLET_GLYPHS[list.bullet];
    if (item.marker !== expected) out.push(`${at}: marker ${JSON.stringify(item.marker)}, expected ${JSON.stringify(expected)}`);
    if (item.content.length === 0) out.push(`${at}: an item with no blocks`);
    blocksProblems(at, item.content, depth, out);
  });
}

/** A cell holds paragraphs and lists only, at every depth (its lists' items too). */
function cellContentProblems(where: string, blocks: readonly RenderBlock[], out: string[]) {
  for (const block of blocks) {
    if (block.type === "list") for (const item of block.items) cellContentProblems(where, item.content, out);
    else if (block.type !== "paragraph") out.push(`${where}: a ${block.type} inside a cell`);
  }
}

/** Every row covers `columns` columns, counting cells that rowspans from rows above carry into it. */
function tableProblems(where: string, table: RenderTable, out: string[]) {
  if (table.columns < 1 || table.columns > MAX_TABLE_COLUMNS) out.push(`${where}: ${table.columns} columns (1 to ${MAX_TABLE_COLUMNS} allowed)`);
  if (table.rows.length === 0) out.push(`${where}: a table with no rows`);
  const carried: number[] = new Array<number>(table.columns).fill(0); // rows still covered by a rowspan above, per column
  table.rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row.cells) {
      while (col < table.columns && carried[col]! > 0) col += 1;
      if (col + cell.colspan > table.columns) out.push(`${where} row ${r + 1}: a cell runs past the last column`);
      if (r + cell.rowspan > table.rows.length) out.push(`${where} row ${r + 1}: a cell runs past the last row`);
      for (let k = 0; k < cell.colspan && col + k < table.columns; k += 1) carried[col + k] = cell.rowspan;
      col += cell.colspan;
      cellContentProblems(`${where} row ${r + 1}`, cell.content, out);
      blocksProblems(`${where} row ${r + 1}`, cell.content, 0, out);
    }
    while (col < table.columns && carried[col]! > 0) col += 1;
    if (col !== table.columns) out.push(`${where} row ${r + 1}: covers ${col} of ${table.columns} columns`);
    // this row is done: every column's remaining span shrinks by one (the cells just placed already count themselves)
    for (let c = 0; c < carried.length; c += 1) carried[c] = Math.max(0, carried[c]! - 1);
  });
}

function blocksProblems(where: string, blocks: readonly RenderBlock[], listDepth: number, out: string[]) {
  blocks.forEach((block, i) => {
    const at = `${where} > ${block.type} ${i + 1}`;
    switch (block.type) {
      case "paragraph":
      case "heading":
        inlineProblems(at, block.content, out);
        if (block.type === "heading" && ![1, 2, 3].includes(block.level)) out.push(`${at}: level ${String(block.level)}`);
        break;
      case "list":
        listProblems(at, block, listDepth + 1, out);
        break;
      case "table":
        tableProblems(at, block, out);
        break;
      case "callout":
        if (block.content.length === 0) out.push(`${at}: a callout with no paragraphs`);
        blocksProblems(at, block.content, listDepth, out);
        break;
      case "rule":
        break;
    }
  });
}

/** [] when the blocks keep every invariant of section 9. */
export function renderDocProblems(blocks: readonly RenderBlock[]): string[] {
  const out: string[] = [];
  blocksProblems("document", blocks, 0, out);
  const last = blocks.at(-1);
  if (last?.type === "paragraph" && last.content.length === 0) out.push("document: ends with an empty paragraph (the editor's trailing line must be dropped)");
  // "Paragraphs made only of variables without a value are gone" cannot be told from a typed blank
  // paragraph here; the optional-variables case pins that rule.
  return out;
}
