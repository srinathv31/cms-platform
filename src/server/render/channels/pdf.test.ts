import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RenderBlock, RenderDoc, RenderTableRow } from "@/domain/render/types";
import {
  LONG_DOC,
  LONG_NAME_DOC,
  LONG_VALUES,
  TABLE_ORPHAN_DOC,
  TABLE_SHORT_DOC,
  TABLE_WIDOW_DOC,
  TYPICAL_DOC,
} from "./__fixtures__/pdf-docs";
import { footerLabel, keepRuns, renderPdf } from "./pdf";
import { loadFonts } from "./pdf-fonts";
import { PALETTE } from "./look";
import { CALLOUT, CONTENT_AREA, CONTENT_WIDTH, HAIRLINE, INK, PAGE, TABLE, TYPE } from "./pdf-styles";
import { prepareText } from "./pdf-text";

// The PDF adapter, read back with pdf.js (the same library the preview draws pages with).

interface Line {
  text: string;
  y: number;
  /** Left edge of the line's first run. */
  x: number;
  /** Largest font size on the line. */
  size: number;
}

interface Inspected {
  bytes: Uint8Array;
  pageCount: number;
  info: Record<string, unknown>;
  pages: { lines: Line[]; text: string; links: string[]; minX: number; maxX: number }[];
}

const normalize = (s: string) => s.replace(/ /g, " ");

async function inspect(doc: RenderDoc): Promise<Inspected> {
  const bytes = await renderPdf(doc);
  // pdf.js takes ownership of the buffer it's given; hand it a copy.
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const { info } = await pdf.getMetadata();
  const pages: Inspected["pages"] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string; size: number }[]>();
    let minX = Infinity;
    let maxX = -Infinity;
    for (const item of content.items) {
      if (!("str" in item) || item.str.length === 0) continue;
      const [size, , , , x, y] = item.transform as number[];
      const key = Math.round(y * 2) / 2;
      byY.set(key, [...(byY.get(key) ?? []), { x, str: item.str, size }]);
      if (item.str.trim().length > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + item.width);
      }
    }
    const lines = [...byY.entries()]
      .sort(([a], [b]) => b - a)
      .map(([y, items]) => ({
        y,
        x: Math.min(...items.map((i) => i.x)),
        text: normalize(items.sort((a, b) => a.x - b.x).map((i) => i.str).join("")),
        size: Math.max(...items.map((i) => i.size)),
      }));
    const annotations = (await page.getAnnotations()) as { subtype: string; url?: string }[];
    pages.push({
      lines,
      text: lines.map((l) => l.text).join("\n"),
      links: annotations.filter((a) => a.subtype === "Link" && a.url).map((a) => a.url as string),
      minX,
      maxX,
    });
  }
  await task.destroy();
  return { bytes, pageCount: pdf.numPages, info: info as Record<string, unknown>, pages };
}

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const allText = (r: Inspected) => r.pages.map((p) => p.text).join("\n");
/** Lines in the page body (above the footer band). */
const bodyLines = (page: Inspected["pages"][number]) => page.lines.filter((l) => l.y > PAGE.marginBottom - 4);
const HEADING_SIZES = [TYPE.h1.size, TYPE.h2.size, TYPE.h3.size];

let typical: Inspected;
let longName: Inspected;
let long: Inspected;
let widow: Inspected;
let orphan: Inspected;
let short: Inspected;

beforeAll(async () => {
  [typical, longName, long, widow, orphan, short] = await Promise.all(
    [TYPICAL_DOC, LONG_NAME_DOC, LONG_DOC, TABLE_WIDOW_DOC, TABLE_ORPHAN_DOC, TABLE_SHORT_DOC].map(inspect),
  );
}, 60_000);

// ── Tables, read back per page ───────────────────────────────────────────────

const plain = (blocks: readonly RenderBlock[]) =>
  blocks.map((b) => (b.type === "paragraph" ? b.content.map((i) => (i.type === "text" ? i.text : "")).join("") : "")).join("");
const isHeaderRow = (row: RenderTableRow) => row.cells.length > 0 && row.cells.every((c) => c.header);
/** Where text starts in a top-level table's first column. */
const FIRST_CELL_X = PAGE.marginX + HAIRLINE + TABLE.padX;
/** A line starts a row when it sits in the first column and starts with the row's first-cell text. */
const startsRow = (line: Line, label: string) =>
  Math.abs(line.x - FIRST_CELL_X) < 0.5 && line.text.startsWith(normalize(label).slice(0, 12));

interface TablePages {
  id: string;
  bodyRows: number;
  /** Per page: body rows that start there, and whether the header row is there. */
  pages: { rows: number; header: boolean }[];
}

/** Where each table's header and body rows landed, found by their first-cell text. */
function tablePages(doc: RenderDoc, r: Inspected): TablePages[] {
  return doc.blocks.flatMap((block) => {
    if (block.type !== "table") return [];
    const headed = block.rows.length > 1 && isHeaderRow(block.rows[0]);
    const header = headed ? plain(block.rows[0].cells[0].content) : null;
    const labels = block.rows.slice(headed ? 1 : 0).map((row) => plain(row.cells[0]?.content ?? []));
    const pages = r.pages.map((page) => {
      const lines = bodyLines(page);
      return {
        rows: lines.filter((line) => labels.some((label) => startsRow(line, label))).length,
        header: header !== null && lines.some((line) => startsRow(line, header)),
      };
    });
    return [{ id: block.id ?? "", bodyRows: labels.length, pages }];
  });
}

describe("renderPdf", () => {
  it("returns a complete PDF", () => {
    for (const r of [typical, longName, long]) {
      expect(ascii(r.bytes.subarray(0, 5))).toBe("%PDF-");
      expect(ascii(r.bytes.subarray(-8))).toContain("%%EOF");
    }
  });

  it("sets plausible page counts", () => {
    expect(typical.pageCount).toBeGreaterThanOrEqual(2);
    expect(typical.pageCount).toBeLessThanOrEqual(3);
    expect(longName.pageCount).toBeGreaterThanOrEqual(2);
    expect(longName.pageCount).toBeLessThanOrEqual(4);
    expect(long.pageCount).toBeGreaterThanOrEqual(10);
  });

  it("sets the document metadata", () => {
    expect(typical.info.Title).toBe("Spring Travel Rewards — Terms");
    expect(typical.info.Creator).toBe("UCOMP");
    expect(typical.info.Producer).toBe("UCOMP");
    expect(long.info.Title).toBe("Coral Bank Cardmember Agreement");
  });

  it("sets real, extractable text with the resolved values", () => {
    const text = allText(typical);
    for (const s of ["Prepared for Maya Chen.", "21.99%", "November 18, 2026", "New Jersey", "$95.00", "$8,500.00", "Offer details", "Rates and fees", "Legal notices"]) {
      expect(text).toContain(s);
    }
  });

  it("prints the template id, version and page numbers in every page footer", () => {
    const check = (r: Inspected, label: string) =>
      r.pages.forEach((page, i) => {
        const footer = page.lines.filter((l) => l.y < PAGE.marginBottom - 4).map((l) => l.text);
        expect(footer.join(" ")).toContain(label);
        expect(footer.join(" ")).toContain(`Page ${i + 1} of ${r.pageCount}`);
      });
    check(typical, "UC-4F7K2Q · v2");
    check(long, "UC-9M3T8A · Draft");
    expect(footerLabel({ templateId: "UC-4F7K2Q", versionNumber: null })).toBe("UC-4F7K2Q · Draft");
  });

  it("embeds its own fonts, so Latin Extended text survives", () => {
    const raw = ascii(long.bytes);
    expect(raw).toContain("/FontFile2");
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+LiberationSans/);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Newsreader/);
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    const text = allText(long);
    expect(text).toContain("Łukasz Wiśniewski-Őrsi");
    expect(text).toContain("Łódź");
    expect(text).toContain("Győr");
  });

  it("makes links real link annotations", () => {
    expect(typical.pages.flatMap((p) => p.links)).toContain("https://www.coralbank.com/agreements");
    expect(long.pages.flatMap((p) => p.links)).toContain(
      "https://payments.coralbank.example/cardmember/servicing/payments/one-time-payment?source=agreement&campaign=spring-travel-rewards-2026",
    );
  });

  it("keeps every line inside the margins, even long values and a long URL", () => {
    for (const r of [typical, longName, long]) {
      for (const page of r.pages) {
        expect(page.minX).toBeGreaterThanOrEqual(PAGE.marginX - 0.5);
        expect(page.maxX).toBeLessThanOrEqual(PAGE.marginX + CONTENT_WIDTH + 0.5);
      }
    }
  });

  it("keeps long names, amounts, states and dates whole in running text", () => {
    const lines = longName.pages.flatMap((p) => p.lines.map((l) => l.text));
    const name = `${LONG_VALUES.first_name} ${LONG_VALUES.last_name}`;
    expect(lines.some((l) => l.includes(`Prepared for ${name}.`))).toBe(true);
    for (const value of [LONG_VALUES.credit_limit, LONG_VALUES.home_state, LONG_VALUES.offer_end_date]) {
      expect(lines.some((l) => l.includes(value))).toBe(true);
    }
    // Wherever a long-name line breaks, it breaks between words, never inside one.
    for (const line of lines) {
      if (line.includes("Featherstone") && !line.endsWith("Featherstonehaugh-")) expect(line).toContain(LONG_VALUES.last_name);
      if (line.includes("Alexandria")) expect(line).toContain(LONG_VALUES.first_name);
    }
  });

  it("never leaves a heading as the last line of a page", () => {
    // Headings are told apart by size; make sure all three levels are actually found.
    const sizes = new Set(long.pages.flatMap((p) => p.lines.map((l) => l.size)));
    for (const size of HEADING_SIZES) expect(sizes).toContain(size);
    for (const r of [typical, longName, long]) {
      r.pages.slice(0, -1).forEach((page) => {
        const body = bodyLines(page);
        const last = body[body.length - 1];
        expect(HEADING_SIZES).not.toContain(last.size);
      });
    }
  });

  it("repeats a table's header row on every page the table crosses", () => {
    const first = long.pages.findIndex((p) => p.text.includes("Additional card fee"));
    const last = long.pages.findIndex((p) => p.text.includes("Balance inquiry at an ATM"));
    expect(last).toBeGreaterThan(first);
    for (let i = first; i <= last; i += 1) {
      expect(long.pages[i].lines.some((l) => l.text.trim() === "FeeAmount" || /^Fee\s*Amount$/.test(l.text.trim()))).toBe(true);
    }
  });

  it("keeps at least 2 body rows on each side of every page break inside a table", () => {
    const docs: [RenderDoc, Inspected][] = [
      [TYPICAL_DOC, typical],
      [LONG_NAME_DOC, longName],
      [LONG_DOC, long],
      [TABLE_WIDOW_DOC, widow],
      [TABLE_ORPHAN_DOC, orphan],
      [TABLE_SHORT_DOC, short],
    ];
    let crossings = 0;
    for (const [doc, r] of docs) {
      for (const table of tablePages(doc, r)) {
        const spread = table.pages.filter((p) => p.rows > 0);
        // Every body row was found exactly once, so the counts below are real.
        expect(spread.reduce((n, p) => n + p.rows, 0), table.id).toBe(table.bodyRows);
        if (table.bodyRows <= 3) expect(spread, `${table.id} never splits`).toHaveLength(1);
        if (spread.length > 1) {
          crossings += spread.length - 1;
          for (const p of spread) expect(p.rows, `${table.id}: rows on one side of a break`).toBeGreaterThanOrEqual(2);
        }
        // The header is never left at a page bottom without rows under it, and repeats over every page.
        table.pages.forEach((p, i) => {
          if (p.header) expect(p.rows, `${table.id} header alone on page ${i + 1}`).toBeGreaterThanOrEqual(Math.min(2, table.bodyRows));
          if (p.rows > 0 && table.pages.some((q) => q.header)) expect(p.header, `${table.id} header on page ${i + 1}`).toBe(true);
        });
      }
    }
    expect(crossings).toBeGreaterThanOrEqual(2); // the long fee table and the widow case do cross
  });

  it("moves the row before a lone last row with it, under the repeated header", () => {
    // "Late payment fee" falls just past the bottom of page 1 (it used to sit alone on page 2).
    const [table] = tablePages(TABLE_WIDOW_DOC, widow);
    expect(table.pages.map((p) => p.rows)).toEqual([8, 2]);
    expect(table.pages[1].header).toBe(true);
    const page2 = bodyLines(widow.pages[1]).map((l) => l.text);
    expect(page2.findIndex((l) => l.startsWith("Statement copy"))).toBeLessThan(page2.findIndex((l) => l.startsWith("Late payment fee")));
  });

  it("starts a table on the next page when its header and 2 rows don't fit", () => {
    // Only the header and one row used to fit at the bottom of page 1.
    const [table] = tablePages(TABLE_ORPHAN_DOC, orphan);
    expect(table.pages.map((p) => p.rows)).toEqual([0, 8]);
    expect(table.pages[0].header).toBe(false);
  });

  it("never splits a table of 3 rows", () => {
    const [table] = tablePages(TABLE_SHORT_DOC, short);
    expect(table.pages.map((p) => p.rows)).toEqual([0, 3]);
    expect(table.pages.map((p) => p.header)).toEqual([false, true]);
  });

  it("prints callouts in the stone palette and shape the web and email callouts share", () => {
    expect([INK.calloutFill, INK.calloutLine, INK.calloutGlyph]).toEqual([
      PALETTE.callout.fill,
      PALETTE.callout.line,
      PALETTE.callout.glyph,
    ]);
    // The shared shape, in points of the 10 pt callout text.
    expect(CALLOUT).toEqual({ padTop: 9, padBottom: 9, padRight: 12, padLeft: 30, iconSize: 10.5, iconLeft: 11, radius: 4 });
  });

  it("sets the long document over 10 or more pages", () => {
    expect(long.pageCount).toBeGreaterThanOrEqual(10);
    expect(allText(long)).toContain("Coral Bank, N.A. Member FDIC.");
  });
});

describe("keepRuns", () => {
  const rows = (n: number, height = 23, keep: number[] = []) =>
    Array.from({ length: n }, (_, i) => ({ height, keepWithNext: keep.includes(i) }));

  it("never splits 3 rows or fewer", () => {
    expect(keepRuns(rows(1))).toEqual([[0]]);
    expect(keepRuns(rows(2))).toEqual([[0, 1]]);
    expect(keepRuns(rows(3))).toEqual([[0, 1, 2]]);
  });

  it("keeps the first 2 and last 2 rows together, and lets the rest part", () => {
    expect(keepRuns(rows(4))).toEqual([[0, 1], [2, 3]]);
    expect(keepRuns(rows(5))).toEqual([[0, 1], [2], [3, 4]]);
    expect(keepRuns(rows(7))).toEqual([[0, 1], [2], [3], [4], [5, 6]]);
  });

  it("keeps a sub-header or rowspan row with the next", () => {
    expect(keepRuns(rows(8, 23, [3]))).toEqual([[0, 1], [2], [3, 4], [5], [6, 7]]);
    expect(keepRuns(rows(6, 23, [1, 2]))).toEqual([[0, 1, 2, 3], [4, 5]]);
  });

  it("lets rows too tall to move together part", () => {
    expect(keepRuns(rows(4, 0.3 * CONTENT_AREA))).toEqual([[0], [1], [2], [3]]);
  });
});

describe("prepareText", () => {
  beforeAll(() => loadFonts());

  const run = (text: string, extra: { variable?: string } = {}) => ({ type: "text" as const, text, ...extra });

  it("keeps a name whole when it fits, and breaks it only at its hyphen when it doesn't", () => {
    const name = [run(LONG_VALUES.last_name, { variable: "last_name" })];
    expect(prepareText(name, TYPE.body, CONTENT_WIDTH).inlines).toEqual([expect.objectContaining({ text: LONG_VALUES.last_name })]);
    const narrow = prepareText(name, TYPE.table, 100);
    expect(narrow.lines).toBe(2);
    expect(narrow.inlines[0]).toMatchObject({ text: "Featherstonehaugh-\nVilliers" });
  });

  it("joins a short variable's words so it never wraps mid-value", () => {
    const { inlines } = prepareText([run("Valid until "), run("September 30, 2027", { variable: "offer_end_date" })], TYPE.body, CONTENT_WIDTH);
    expect(inlines[1]).toMatchObject({ text: "September 30, 2027" });
  });

  it("cuts a token wider than the line so it can't overflow", () => {
    const url = "https://example.com/" + "a".repeat(200);
    const { inlines, lines } = prepareText([run(url)], TYPE.body, CONTENT_WIDTH);
    expect(lines).toBeGreaterThan(1);
    const text = (inlines[0] as { text: string }).text;
    expect(text.replace(/-?\n/g, "")).toBe(url);
  });
});
