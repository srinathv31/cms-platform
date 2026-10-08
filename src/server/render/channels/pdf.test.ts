import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  RenderBlock,
  RenderDoc,
  RenderInline,
  RenderList,
  RenderListItem,
  RenderParagraph,
  RenderTableCell,
  RenderTableRow,
  RenderText,
} from "@/domain/render/types";
import {
  HEADING_CHAIN_DOC,
  LONG_DOC,
  LONG_INTRO_DOC,
  LONG_NAME_DOC,
  LONG_VALUES,
  TABLE_ORPHAN_DOC,
  TABLE_SHORT_DOC,
  TABLE_WIDOW_DOC,
  TYPICAL_DOC,
} from "./__fixtures__/pdf-docs";
import { footerLabel, keepRuns, renderPdf, UnrenderableCharactersError } from "./pdf";
import { GlyphCheck, loadFonts, measure, SANS } from "./pdf-fonts";
import { PALETTE } from "./look";
import { CALLOUT, CONTENT_AREA, CONTENT_WIDTH, HAIRLINE, INK, PAGE, SPACE, TABLE, TYPE, lineBox } from "./pdf-styles";
import { prepareText, type Piece } from "./pdf-text";

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

const normalize = (s: string) => s.replace(/\u00a0/g, " ");
/** The render time every test renders at (the PDF keeps whole seconds). */
const AT = new Date("2027-03-04T12:00:00.789Z");
const PLAIN_SANS = { family: SANS, weight: 400, italic: false } as const;

async function inspect(doc: RenderDoc, createdAt = AT): Promise<Inspected> {
  const bytes = await renderPdf(doc, { createdAt });
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
let chain: Inspected;
let longIntro: Inspected;

beforeAll(async () => {
  [typical, longName, long, widow, orphan, short, chain, longIntro] = await Promise.all(
    [TYPICAL_DOC, LONG_NAME_DOC, LONG_DOC, TABLE_WIDOW_DOC, TABLE_ORPHAN_DOC, TABLE_SHORT_DOC, HEADING_CHAIN_DOC, LONG_INTRO_DOC].map(
      (doc) => inspect(doc),
    ),
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
    expect(typical.info.Creator).toBe("Stencil");
    expect(typical.info.Producer).toBe("Stencil");
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
      [HEADING_CHAIN_DOC, chain],
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

  /** The pages a fee notice's "Rates and fees" heading, the line after it, and its first table row are on. */
  const chainPages = (r: Inspected) => {
    const lines = r.pages.flatMap((page, n) => bodyLines(page).map((line) => ({ line, n })));
    const heading = lines.findIndex(({ line }) => line.text === "Rates and fees");
    return {
      heading: lines[heading]?.n ?? -1,
      intro: lines[heading + 1]?.n ?? -1,
      table: lines.find(({ line }) => startsRow(line, "Annual fee"))?.n ?? -1,
    };
  };

  it("keeps a heading, its one-line intro and the table it introduces on one page", () => {
    // Each of these used to leave the heading and intro stranded at the bottom of page 1.
    for (const [doc, r] of [[TABLE_ORPHAN_DOC, orphan], [TABLE_SHORT_DOC, short], [HEADING_CHAIN_DOC, chain]] as const) {
      const at = chainPages(r);
      expect(at.heading, doc.blocks[0].id ?? "").toBeGreaterThanOrEqual(0);
      expect([at.intro, at.table], doc.blocks[0].id ?? "").toEqual([at.heading, at.heading]);
      // Page 1 isn't left with the lead alone and a lot of space: the chain moved as one.
      expect(at.heading).toBe(1);
    }
  });

  it("still splits a long table after the chain, with its header repeated", () => {
    const [table] = tablePages(HEADING_CHAIN_DOC, chain);
    const spread = table.pages.filter((p) => p.rows > 0);
    expect(spread.length).toBeGreaterThan(1);
    expect(table.pages.filter((p) => p.rows > 0).every((p) => p.header)).toBe(true);
  });

  it("lets a long intro split instead of dragging its heading along", () => {
    const at = chainPages(longIntro);
    expect(at.heading).toBe(0);
    expect(at.intro).toBe(0);
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

// ── Exactly the RenderDoc ────────────────────────────────────────────────────

const run = (text: string, marks: Omit<RenderText, "type" | "text"> = {}): RenderText => ({ type: "text", text, ...marks });
const BREAK: RenderInline = { type: "break" };
const para = (...content: (RenderInline | string)[]): RenderParagraph => ({
  type: "paragraph",
  id: null,
  content: content.map((c) => (typeof c === "string" ? run(c) : c)),
});
const items = (markers: string[], text: (i: number) => RenderBlock[]): RenderListItem[] => markers.map((marker, i) => ({ marker, content: text(i) }));
const ordered = (markers: string[], text: (i: number) => RenderBlock[]): RenderList => ({
  type: "list",
  id: null,
  ordered: true,
  start: 1,
  format: "decimal",
  delimiter: "period",
  items: items(markers, text),
});
const bullets = (glyph: string, text: (i: number) => RenderBlock[], count = 2): RenderList => ({
  type: "list",
  id: null,
  ordered: false,
  bullet: "disc",
  items: items(Array.from({ length: count }, () => glyph), text),
});
const cellOf = (content: RenderTableCell["content"], extra: Partial<RenderTableCell> = {}): RenderTableCell => ({
  header: false,
  colspan: 1,
  rowspan: 1,
  content,
  ...extra,
});
const grid = (columns: number, ...rows: RenderTableCell[][]): RenderBlock => ({ type: "table", id: null, columns, rows: rows.map((cells) => ({ cells })) });
const probe = (...blocks: RenderBlock[]): RenderDoc => ({ templateId: "UC-PROBE", templateName: "Probe", versionNumber: 1, blocks });
const body = (r: Inspected) => r.pages.flatMap(bodyLines);
const at = (r: Inspected, text: string) => {
  const line = body(r).find((l) => l.text.trim() === text);
  if (!line) throw new Error(`no line "${text}" in:\n${body(r).map((l) => l.text).join("\n")}`);
  return line;
};
const SPACE_WIDTH = () => measure(" ", PLAIN_SANS, TYPE.body.size);
const LONG_WORD = "Pneumonoultramicroscopicsilicovolcanoconiosis";

/** `depth` levels of lists, ordered and bulleted in turn, two items a level. */
function deepList(depth: number): RenderList {
  let inner: RenderList | null = null;
  for (let d = depth - 1; d >= 0; d -= 1) {
    const nested: RenderBlock[] = inner ? [inner] : [];
    const text = (i: number): RenderBlock[] => (i === 0 ? [para(`Level ${d + 1} first item`), ...nested] : [para(`Level ${d + 1} second item`)]);
    inner = d % 2 === 0 ? ordered(["1.", "2."], text) : bullets("◦", text);
  }
  return inner as RenderList;
}

describe("renderPdf prints exactly the RenderDoc", () => {
  beforeAll(() => loadFonts());

  it("prints each item's marker as given, recomputing nothing", async () => {
    const r = await inspect(
      probe(
        ordered(["(mmmcmxcix)", "(4000)", "0."], (i) => [para(["last roman", "past roman", "zero start"][i])]),
        bullets("▪", () => [para("a square at the top level")], 1),
        // An item whose first block is a list (its paragraph was removed): its marker still prints.
        ordered(["7."], () => [ordered(["(c)"], () => [para("nested first")])]),
      ),
    );
    expect(body(r).map((l) => l.text)).toEqual([
      "(mmmcmxcix) last roman",
      "(4000) past roman",
      "0. zero start",
      "▪ a square at the top level",
      "7. (c) nested first",
    ]);
  });

  it("prints blank paragraphs as blank lines of the paragraph's height", async () => {
    const r = await inspect(probe(para("A"), para(), para("   "), para("B"), para(BREAK, "x")));
    const step = lineBox(TYPE.body) + SPACE.paragraph;
    expect(at(r, "A").y - at(r, "B").y).toBeCloseTo(3 * step, 0);
    // A break at a paragraph's start is an empty first line.
    expect(at(r, "B").y - at(r, "x").y).toBeCloseTo(step + lineBox(TYPE.body), 0);
  });

  it("prints the empty line after a hard break that ends a paragraph", async () => {
    const r = await inspect(probe(para("A"), para("x", BREAK), para("B"), para(BREAK), para("C"), para("y", BREAK, BREAK), para("D")));
    const step = lineBox(TYPE.body) + SPACE.paragraph;
    expect(at(r, "A").y - at(r, "x").y).toBeCloseTo(step, 0);
    // n breaks give n + 1 lines, the empty ones at the end included.
    expect(at(r, "x").y - at(r, "B").y).toBeCloseTo(step + lineBox(TYPE.body), 0);
    expect(at(r, "B").y - at(r, "C").y).toBeCloseTo(2 * step + lineBox(TYPE.body), 0);
    expect(at(r, "y").y - at(r, "D").y).toBeCloseTo(step + 2 * lineBox(TYPE.body), 0);
  });

  it("keeps the author's leading spaces, at the start of a paragraph and after a hard break", async () => {
    const r = await inspect(
      probe(para("Edge"), para("   Lead"), para("Line one", BREAK, "    after a break"), para(run("  "), run("linked", { href: "https://example.com/" }))),
    );
    const edge = at(r, "Edge").x;
    expect(edge).toBeCloseTo(PAGE.marginX, 1);
    expect(at(r, "Lead").x - edge).toBeCloseTo(3 * SPACE_WIDTH(), 1);
    expect(at(r, "after a break").x - edge).toBeCloseTo(4 * SPACE_WIDTH(), 1);
    expect(at(r, "linked").x - edge).toBeCloseTo(2 * SPACE_WIDTH(), 1);
  });

  it("cuts long words and URLs bare, never adding a hyphen", async () => {
    const url = "https://example.com/" + "segment/".repeat(12) + LONG_WORD.repeat(3);
    const r = await inspect(probe(para(url), grid(6, Array.from({ length: 6 }, () => cellOf([para(LONG_WORD)])))));
    const text = body(r).map((l) => l.text).join("");
    expect(text).not.toContain("-");
    expect(text.replace(/ /g, "")).toContain(url);
    expect(text.split(LONG_WORD.slice(0, 10)).length - 1).toBeGreaterThanOrEqual(6 + 3);
  });

  it("refuses characters its fonts can't draw, naming each once, in order, without quoting them in the message", async () => {
    const heading = (level: 1 | 2 | 3, text: string): RenderBlock => ({ type: "heading", id: null, level, section: null, content: [run(text)] });
    const refusal = (doc: RenderDoc) =>
      renderPdf(doc, { createdAt: AT }).then(
        () => null,
        (error: unknown) => error,
      );
    const error = await refusal(probe(para("Fee ₹100, then ạ"), heading(1, "₹ ✓"), para(run("ạ", { bold: true }))));
    expect(error).toBeInstanceOf(UnrenderableCharactersError);
    expect((error as UnrenderableCharactersError).characters).toEqual(["₹", "ạ", "✓"]);
    expect((error as Error).message).not.toMatch(/[₹ạ✓]/u);
    // The serif section heads draw Vietnamese; the sans body can't.
    expect(await refusal(probe(heading(2, "Tiếng Việt")))).toBeNull();
    expect((await refusal(probe(heading(3, "Tiếng Việt"))) as UnrenderableCharactersError).characters).toEqual(["ế", "ệ"]);
    // Markers and the footer are drawn too.
    expect((await refusal(probe(bullets("✓", () => [para("x")], 1))) as UnrenderableCharactersError).characters).toEqual(["✓"]);
    expect((await refusal({ ...probe(para("x")), templateId: "UC-₹" })) as UnrenderableCharactersError).toMatchObject({ characters: ["₹"] });
  });

  it("gives the same bytes for the same document and time, dated to the second", async () => {
    const a = await renderPdf(TYPICAL_DOC, { createdAt: AT });
    const b = await renderPdf(TYPICAL_DOC, { createdAt: new Date(AT.getTime() + 150) });
    const c = await renderPdf(TYPICAL_DOC, { createdAt: new Date("2027-03-05T00:00:00Z") });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
    expect(typical.info.CreationDate).toBe("D:20270304120000Z");
    expect(typical.info.ModDate).toBe("D:20270304120000Z");
    expect(ascii(a)).not.toContain("/ModificationDate");
  });
});

describe("renderPdf never crashes or hangs", () => {
  it("sets tables of up to 12 columns, whatever their cells hold", async () => {
    const twelve = (cell: (i: number) => RenderTableCell["content"]) => Array.from({ length: 12 }, (_, i) => cellOf(cell(i)));
    const nested = grid(12, twelve((i) => (i === 0 ? [bullets("•", () => [para("in a list"), grid(12, twelve(() => [para(LONG_WORD)]))], 1)] : [para("c")])));
    const r = await inspect(
      probe(
        grid(12, twelve((i) => [para(LONG_WORD + i)]), twelve(() => [para(), para("   lead"), deepList(9)]), twelve(() => [])),
        grid(12, twelve((i) => (i === 0 ? [deepList(9)] : [para("c")]))),
        nested,
      ),
    );
    expect(r.pageCount).toBeGreaterThanOrEqual(1);
    for (const page of r.pages) expect(page.minX).toBeGreaterThanOrEqual(PAGE.marginX - 0.5);
  });

  it("bounds a malformed table's width and spans instead of hanging", async () => {
    const started = performance.now();
    const r = await inspect(
      probe(
        grid(1, [cellOf([para("wide")], { colspan: 1e9 })], [cellOf([para("x")])]),
        grid(1e9, [cellOf([para("huge")], { colspan: 1e9, rowspan: 1e9 })]),
        grid(Number.NaN, Array.from({ length: 6 }, (_, i) => cellOf([para(`c${i}`)]))),
      ),
    );
    expect(performance.now() - started).toBeLessThan(5_000);
    const text = allText(r);
    for (const s of ["wide", "huge", "c0", "c5"]) expect(text).toContain(s);
  });

  it("lays out deep lists in linear time", async () => {
    await renderPdf(probe(deepList(3)), { createdAt: AT }); // warm up
    for (const depth of [9, 12]) {
      const started = performance.now();
      const r = await inspect(probe(deepList(depth)));
      // Before the fix: 0.3 s at 9 levels, 4.3 s at 12 (doubling a level).
      expect(performance.now() - started, `${depth} levels`).toBeLessThan(1_000);
      expect(allText(r)).toContain(`Level ${depth} second item`);
    }
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
    expect(prepareText(name, TYPE.body, CONTENT_WIDTH, new GlyphCheck()).inlines).toEqual([expect.objectContaining({ text: LONG_VALUES.last_name })]);
    const narrow = prepareText(name, TYPE.table, 100, new GlyphCheck());
    expect(narrow.lines).toBe(2);
    expect(narrow.inlines[0]).toMatchObject({ text: "Featherstonehaugh-\nVilliers" });
  });

  it("never wraps a short variable mid-value, and leaves its characters alone", () => {
    // "September" alone would still fit on the first line; the whole date moves to the second.
    const width = measure("Valid until September", PLAIN_SANS, TYPE.body.size) + 2;
    const date = run("September 30, 2027", { variable: "offer_end_date" });
    const { inlines, lines } = prepareText([run("Valid until "), date], TYPE.body, width, new GlyphCheck());
    expect(lines).toBe(2);
    expect(inlines).toEqual([
      expect.objectContaining({ text: "Valid until\n" }),
      expect.objectContaining({ text: "September 30, 2027" }),
    ]);
  });

  it("cuts a token wider than the line bare, inserting nothing", () => {
    const url = "https://example.com/" + "segment/".repeat(12) + "a".repeat(200);
    const { inlines, lines } = prepareText([run(url)], TYPE.body, CONTENT_WIDTH, new GlyphCheck());
    expect(lines).toBeGreaterThan(1);
    const text = (inlines[0] as Piece).text;
    expect(text.split("\n")[0]).toMatch(/segment\/$/); // after the last separator that fits
    expect(text.replace(/\n/g, "")).toBe(url);
    const word = "Pneumonoultramicroscopicsilicovolcanoconiosis";
    const narrow = prepareText([run(word)], TYPE.table, 60, new GlyphCheck());
    expect(narrow.lines).toBeGreaterThan(2);
    expect((narrow.inlines[0] as Piece).text.replace(/\n/g, "")).toBe(word);
    expect((narrow.inlines[0] as Piece).text).not.toContain("-");
  });

  it("never loops or throws in a box narrower than a glyph", () => {
    for (const width of [0, -40, 0.5, Number.NaN]) {
      const { inlines, lines } = prepareText([run("ab cd")], TYPE.table, width, new GlyphCheck());
      expect(lines).toBe(4);
      expect((inlines[0] as Piece).text).toBe("a\nb\nc\nd");
    }
  });

  it("keeps the author's spaces: leading ones as an indented run of their own, runs inside as typed", () => {
    const space = measure(" ", PLAIN_SANS, TYPE.body.size);
    const { inlines } = prepareText(
      [run("   Lead and   three"), { type: "break" }, run("  "), run("after a break")],
      TYPE.body,
      CONTENT_WIDTH,
      new GlyphCheck(),
    );
    expect(inlines).toEqual([
      expect.objectContaining({ text: "   ", indent: 3 * space }),
      expect.objectContaining({ text: "Lead and   three" }),
      { kind: "break" },
      expect.objectContaining({ text: "  ", indent: 2 * space }),
      expect.objectContaining({ text: "after a break" }),
    ]);
  });

  it("absorbs the spaces where a line wraps, never carrying them to the next line", () => {
    const filler = "word ".repeat(20).trim();
    const { inlines } = prepareText([run(filler + "      ")], TYPE.body, CONTENT_WIDTH, new GlyphCheck());
    const lines = (inlines[0] as Piece).text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("word")).toBe(true);
    expect(lines.join(" ")).toBe(filler + "      "); // the wrap took the one space it fell in
  });

  it("keeps trailing spaces that fit, and absorbs those past the line's end", () => {
    const space = measure(" ", PLAIN_SANS, TYPE.body.size);
    const word = measure("word", PLAIN_SANS, TYPE.body.size);
    const width = word + 10.5 * space + 1; // room for "word" and 10 spaces (plus the 1 pt slack)
    const { inlines, lines } = prepareText([run("word" + " ".repeat(30)), { type: "break" }, run(" ".repeat(300))], TYPE.body, width, new GlyphCheck());
    expect(lines).toBe(2);
    expect(inlines[0]).toMatchObject({ text: "word" + " ".repeat(10) });
    expect(inlines[2]).toMatchObject({ text: " ".repeat(Math.floor((width - 1) / space)) });
  });
});
