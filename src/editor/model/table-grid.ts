// A table's grid, read from TipTap JSON: where each cell sits, the table's width, and what doesn't
// line up. Pure TypeScript, shared by save normalization (normalize.ts: padding ragged rows,
// splitting wide tables) and the document check (src/server/render/schema-check.ts).
//
// Cells are placed the way the editor's table plugin (prosemirror-tables' TableMap) places them, so
// the editor, the check and every channel agree on the grid:
//   - the width is the most columns any row covers: its cells' colspans plus the columns that
//     rowspans from rows above carry into it;
//   - row by row, each cell takes the next free column (one a rowspan from above doesn't hold) and
//     covers `colspan` columns of this row and the `rowspan - 1` rows below.
// What doesn't line up: a colspan or rowspan that isn't an integer ≥ 1, a cell running past the last
// column, a rowspan running past the last row, two cells covering the same slot, and a row that
// leaves slots empty ("missing": a ragged row, which normalization pads).

import type { JSONContent } from "./types";

/** Tables have at most this many columns (docs/render-spec.md, "Limits"). */
export const MAX_TABLE_COLUMNS = 12;

export interface GridCell {
  node: JSONContent;
  /** The row the cell starts in, and its first column. */
  row: number;
  column: number;
  colspan: number;
  rowspan: number;
}

export interface TableGrid {
  /** Columns: the most any row covers. */
  width: number;
  /** Rows (tableRow nodes). */
  height: number;
  /** Per row: the cells that start in it, in column order. */
  rows: GridCell[][];
  /** Per row: how many of its slots no cell covers (ragged rows). */
  missing: number[];
  /** A colspan or rowspan that isn't an integer ≥ 1 (absent or null means 1). */
  badSpan: boolean;
  /** Two cells cover the same slot, or a cell runs past the last column. */
  collision: boolean;
  /** A rowspan runs past the last row. */
  overlongRowspan: boolean;
}

/** A span attribute: absent or null is 1 (docs/render-spec.md §2); anything but an integer ≥ 1 is invalid (null). */
export function spanValue(value: unknown): number | null {
  if (value === undefined || value === null) return 1;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function rowsOf(table: JSONContent): JSONContent[][] {
  return (table.content ?? []).map((row) => (Array.isArray(row?.content) ? row.content : []));
}

export function tableGrid(table: JSONContent): TableGrid {
  const rows = rowsOf(table);
  const height = rows.length;
  let badSpan = false;
  const spans = rows.map((cells) =>
    cells.map((cell) => {
      const colspan = spanValue(cell?.attrs?.colspan);
      const rowspan = spanValue(cell?.attrs?.rowspan);
      if (colspan === null || rowspan === null) badSpan = true;
      return { colspan: colspan ?? 1, rowspan: rowspan ?? 1 };
    }),
  );

  // The width, as TableMap's findWidth: each row's own colspans plus what rowspans carry into it.
  const carried = new Array<number>(height).fill(0);
  let width = 0;
  spans.forEach((cells, r) => {
    let covered = carried[r]!;
    for (const { colspan, rowspan } of cells) {
      covered += colspan;
      for (let below = 1; below < rowspan && r + below < height; below++) carried[r + below]! += colspan;
    }
    width = Math.max(width, covered);
  });

  // Per row, the column ranges taken so far (by rowspans from above, then by the row's own cells),
  // as merged [start, end) ranges rather than one slot per column, so a colspan of a billion costs
  // no more than a colspan of 2.
  const taken: Range[][] = rows.map(() => []);
  const placed: GridCell[][] = [];
  const missing: number[] = [];
  let collision = false;
  let overlongRowspan = false;

  rows.forEach((cells, r) => {
    let at = 0;
    const out: GridCell[] = [];
    cells.forEach((node, i) => {
      at = nextFree(taken[r]!, at);
      const { colspan, rowspan } = spans[r]![i]!;
      if (at + colspan > width) collision = true; // runs past the last column
      const end = Math.min(at + colspan, width);
      for (let h = 0; h < rowspan; h++) {
        if (r + h >= height) {
          overlongRowspan = true;
          break;
        }
        if (end > at && take(taken[r + h]!, at, end)) collision = true;
      }
      out.push({ node, row: r, column: at, colspan, rowspan });
      at += colspan;
    });
    placed.push(out);
    missing.push(width - taken[r]!.reduce((sum, [start, stop]) => sum + stop - start, 0));
  });

  return { width, height, rows: placed, missing, badSpan, collision, overlongRowspan };
}

/** Columns [start, end) of one row. */
type Range = [number, number];

/** The first column at or after `at` that no range holds. */
function nextFree(ranges: readonly Range[], at: number): number {
  let column = at;
  for (const [start, end] of ranges) if (start <= column && column < end) column = end;
  return column;
}

/** Marks [start, end) taken, keeping `ranges` sorted and merged. True when part of it was taken already. */
function take(ranges: Range[], start: number, end: number): boolean {
  let overlap = false;
  let from = start;
  let to = end;
  const kept: Range[] = [];
  for (const range of ranges) {
    if (range[0] < end && start < range[1]) overlap = true;
    if (range[0] <= to && from <= range[1]) {
      from = Math.min(from, range[0]);
      to = Math.max(to, range[1]);
    } else kept.push(range);
  }
  kept.push([from, to]);
  kept.sort((a, b) => a[0] - b[0]);
  ranges.splice(0, ranges.length, ...kept);
  return overlap;
}

/** Whether every row covers exactly the table's width with no overlaps or overruns. */
export function linesUp(grid: TableGrid): boolean {
  return !grid.badSpan && !grid.collision && !grid.overlongRowspan && grid.missing.every((n) => n === 0);
}
