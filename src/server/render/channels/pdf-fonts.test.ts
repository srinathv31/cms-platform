import { beforeAll, describe, expect, it } from "vitest";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RenderDoc } from "@/domain/render/types";
import { renderInFreshProcess, pdfBytes, type FreshJob } from "@/server/render/testing/fresh-process";
import type { RenderFixture } from "@/server/render/testing/fixture";
import { doc, p, t, v, variable } from "@/server/render/testing/tiptap";
import { renderPdf } from "./pdf";
import { loadFonts, measure, SANS, SERIF } from "./pdf-fonts";
import { PAGE, TYPE } from "./pdf-styles";

// The PDF's fonts live as long as the process, and so does fontkit's glyph cache: a glyph is cached
// with the code points of the first lookup that reached it. Two characters that share a glyph (a
// hyphen and a soft hyphen, a space and a no-break space) would otherwise make every later PDF
// depend on which one some earlier document used first. These tests render in fresh processes,
// with the document that would poison the cache first.

const AT = "2027-03-04T12:00:00.000Z";

function input(body: RenderFixture["body"], extra: Partial<RenderFixture> = {}): RenderFixture {
  return {
    templateId: "UC-PROBE",
    templateName: "Probe",
    versionNumber: 1,
    at: AT,
    variables: [],
    values: {},
    body,
    emailSubject: null,
    emailPreheader: null,
    ...extra,
  };
}

const AMOUNT = input(doc(p(t("Fee: "), v("fee")), p(t("Call 800-555-0100"))), {
  variables: [variable("fee", "Fee", "currency", true, "")],
  values: { fee: "-1234.50" },
});
const SOFT_HYPHEN = input(doc(p(t("Ver­sicherung"))));
/** A RenderDoc that hands a soft hyphen straight to the adapter (the resolver would remove it). */
const SOFT_HYPHEN_DOC: RenderDoc = {
  templateId: "UC-PROBE",
  templateName: "Probe",
  versionNumber: 1,
  blocks: [{ type: "paragraph", id: null, content: [{ type: "text", text: "Ver­sicherung" }] }],
};
const NBSP_LEAD = input(doc(p(t("    Indented by four no-break spaces"))));
const ASCII_LEAD = input(doc(p(t("    Indented by four spaces"))));

const pdf = (name: string, source: RenderFixture): FreshJob => ({ name, input: source, channel: "pdf" });

interface Glyph {
  ch: string;
  x: number;
  y: number;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

/** Every glyph the first page draws, with its text-layer character and where it starts. */
async function glyphs(bytes: Uint8Array): Promise<Glyph[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const page = await (await task.promise).getPage(1);
  const list = await page.getOperatorList();
  const out: Glyph[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let tm: Matrix = [1, 0, 0, 1, 0, 0];
  let size = 0;
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push([...ctm] as Matrix);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.beginText) tm = [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.setTextMatrix) tm = (args.length === 1 ? args[0] : args) as Matrix;
    else if (fn === OPS.setFont) size = args[1];
    else if (fn === OPS.showText) {
      const m = multiply(tm, ctm);
      let x = m[4];
      for (const g of args[0] as ({ unicode: string; width: number } | number | null)[]) {
        if (g === null) continue;
        if (typeof g === "number") x -= (g / 1000) * size * m[0];
        else {
          out.push({ ch: g.unicode, x, y: Math.round(m[5] * 2) / 2 });
          x += (g.width / 1000) * size * m[0];
        }
      }
    }
  }
  await task.destroy();
  return out;
}

/** The text of each line, top to bottom, as the text layer reads it. */
function lines(all: readonly Glyph[]): string[] {
  const byY = new Map<number, Glyph[]>();
  for (const g of all) byY.set(g.y, [...(byY.get(g.y) ?? []), g]);
  return [...byY.entries()].sort(([a], [b]) => b - a).map(([, list]) => list.sort((a, b) => a.x - b.x).map((g) => g.ch).join(""));
}

/** Where `word` first starts, top to bottom, and its whole line as the text layer reads it. */
function find(all: readonly Glyph[], word: string): { x: number; line: string } {
  for (const y of [...new Set(all.map((g) => g.y))].sort((a, b) => b - a)) {
    const line = all.filter((g) => g.y === y).sort((a, b) => a.x - b.x);
    const text = line.map((g) => g.ch).join("");
    const at = text.indexOf(word);
    if (at >= 0) return { x: line[at]!.x, line: text };
  }
  throw new Error(`"${word}" is not on the page: ${lines(all).join(" / ")}`);
}

/** Four U+0020 in the body face: where text indented by four spaces of either kind starts. */
let fourSpaces: number;

beforeAll(async () => {
  await loadFonts();
  fourSpaces = 4 * measure(" ", { family: SANS, weight: 400, italic: false }, TYPE.body.size);
});

describe("the PDF fonts, in a fresh process", () => {
  it("keep every hyphen and minus sign after a document with a soft hyphen", async () => {
    const [, amount] = await renderInFreshProcess([pdf("soft hyphen", SOFT_HYPHEN), pdf("amount", AMOUNT)]);
    const text = lines(await glyphs(pdfBytes(amount!)));
    expect(text).toEqual(["Fee: -$1,234.50", "Call 800-555-0100", "UC-PROBE · v1Page 1 of 1"]);
  }, 60_000);

  it("keep every hyphen even when a soft hyphen reaches the PDF adapter itself", async () => {
    const [shy, amount] = await renderInFreshProcess([{ name: "soft hyphen", pdfDoc: SOFT_HYPHEN_DOC, at: AT }, pdf("amount", AMOUNT)]);
    expect(lines(await glyphs(pdfBytes(shy!)))).toEqual(["Versicherung", "UC-PROBE · v1Page 1 of 1"]);
    expect(lines(await glyphs(pdfBytes(amount!)))).toEqual(["Fee: -$1,234.50", "Call 800-555-0100", "UC-PROBE · v1Page 1 of 1"]);
  }, 60_000);

  it.each([
    ["no-break spaces first", [pdf("nbsp", NBSP_LEAD), pdf("ascii", ASCII_LEAD)]],
    ["ASCII spaces first", [pdf("ascii", ASCII_LEAD), pdf("nbsp", NBSP_LEAD)]],
  ])("indent leading spaces of either kind by their own width, with %s", async (_, jobs) => {
    const results = await renderInFreshProcess(jobs);
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    const nbsp = find(await glyphs(pdfBytes(byName.nbsp!)), "Indented");
    const ascii = find(await glyphs(pdfBytes(byName.ascii!)), "Indented");
    expect(nbsp.x).toBeCloseTo(PAGE.marginX + fourSpaces, 1);
    expect(ascii.x).toBeCloseTo(PAGE.marginX + fourSpaces, 1);
    // The text layer keeps the author's U+0020 as U+0020.
    expect(ascii.line).toBe("    Indented by four spaces");
  }, 60_000);
});

// ── Spaces of every kind (docs/render-spec.md section 10, PDF) ─────────────────────────────────

const docOf = (...blocks: RenderDoc["blocks"]): RenderDoc => ({ templateId: "UC-PROBE", templateName: "Probe", versionNumber: 1, blocks });
const para = (text: string): RenderDoc["blocks"][number] => ({ type: "paragraph", id: null, content: [{ type: "text", text }] });
const BODY = { family: SANS, weight: 400, italic: false } as const;

/** Each Unicode space, and the width it prints at in the body face (10.5 pt). */
const SPACES: [string, number, () => number][] = [
  ["U+0020 space", 0x20, () => measure(" ", BODY, TYPE.body.size)],
  ["U+00A0 no-break space", 0xa0, () => measure(" ", BODY, TYPE.body.size)],
  ["U+1680 Ogham space mark", 0x1680, () => measure(" ", BODY, TYPE.body.size)],
  ["U+2000 en quad", 0x2000, () => TYPE.body.size / 2],
  ["U+2001 em quad", 0x2001, () => TYPE.body.size],
  ["U+2002 en space", 0x2002, () => TYPE.body.size / 2],
  ["U+2003 em space", 0x2003, () => TYPE.body.size],
  ["U+2004 three-per-em space", 0x2004, () => TYPE.body.size / 3],
  ["U+2005 four-per-em space", 0x2005, () => TYPE.body.size / 4],
  ["U+2006 six-per-em space", 0x2006, () => TYPE.body.size / 6],
  ["U+2007 figure space", 0x2007, () => measure("0", BODY, TYPE.body.size)],
  ["U+2008 punctuation space", 0x2008, () => measure(".", BODY, TYPE.body.size)],
  ["U+2009 thin space", 0x2009, () => TYPE.body.size / 5],
  ["U+200A hair space", 0x200a, () => TYPE.body.size / 10],
  ["U+202F narrow no-break space", 0x202f, () => TYPE.body.size / 5],
  ["U+205F medium mathematical space", 0x205f, () => (TYPE.body.size * 4) / 18],
  ["U+3000 ideographic space", 0x3000, () => TYPE.body.size],
];

describe("the PDF's spaces", () => {
  it.each(SPACES)("prints a %s at its own width, inside a line and leading one", async (_, codePoint, width) => {
    const space = String.fromCodePoint(codePoint);
    const all = await glyphs(await renderPdf(docOf(para(`0${space}${space}1`), para(`${space}${space}Lead`)), { createdAt: new Date(AT) }));
    expect(find(all, "1").x - find(all, "0").x - measure("0", BODY, TYPE.body.size)).toBeCloseTo(2 * width(), 1);
    expect(find(all, "Lead").x).toBeCloseTo(PAGE.marginX + 2 * width(), 1);
  });

  it("keeps a heading's leading no-break spaces where the serif face has a glyph of its own for them", async () => {
    const heading: RenderDoc["blocks"][number] = { type: "heading", id: null, level: 2, section: null, content: [{ type: "text", text: "\u00A0\u00A0 Serif" }] };
    const all = await glyphs(await renderPdf(docOf(heading), { createdAt: new Date(AT) }));
    const serif = { family: SERIF, weight: 500, italic: false } as const;
    expect(find(all, "Serif").x).toBeCloseTo(PAGE.marginX + 2 * measure("\u00A0", serif, TYPE.h2.size) + measure(" ", serif, TYPE.h2.size), 1);
  });

  it("keeps a run of mixed spaces leading a line where they were typed", async () => {
    const all = await glyphs(await renderPdf(docOf(para(" \u2003\u00A0\u2009Mixed")), { createdAt: new Date(AT) }));
    const space = measure(" ", BODY, TYPE.body.size);
    expect(find(all, "Mixed").x).toBeCloseTo(PAGE.marginX + space + TYPE.body.size + space + TYPE.body.size / 5, 1);
  });
});
