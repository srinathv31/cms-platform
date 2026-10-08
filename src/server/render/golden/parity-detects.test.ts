// The parity check checks itself: each test plants one defect in one channel's output (a changed
// marker, a dropped paragraph, a collapsed run of spaces, a changed link address, two cells swapped,
// a missing glyph...) and requires parityProblems to report it. If an extractor goes blind, this
// fails, not the goldens.

import { beforeAll, describe, expect, it } from "vitest";
import type { RenderBlock, RenderInline } from "@/domain/render/types";
import { renderPdf } from "@/server/render/channels/pdf";
import { extractPdf } from "./extract-pdf";
import { readInput } from "./files";
import { parityProblems, runCase, type CaseRun } from "./pipeline";

const cache = new Map<string, Promise<CaseRun>>();
const base = (slug: string) => {
  if (!cache.has(slug)) cache.set(slug, runCase(readInput(slug)));
  return cache.get(slug)!;
};

/** The run with its web page, email or PDF replaced. */
const withWeb = (run: CaseRun, change: (html: string) => string): CaseRun => ({ ...run, web: change(run.web) });
const withEmail = (run: CaseRun, change: (email: NonNullable<CaseRun["email"]>) => Partial<NonNullable<CaseRun["email"]>>): CaseRun => ({
  ...run,
  email: { ...run.email!, ...change(run.email!) },
});
async function withPdfOf(run: CaseRun, change: (blocks: RenderBlock[]) => void): Promise<CaseRun> {
  const blocks = structuredClone(run.blocks);
  change(blocks);
  const bytes = await renderPdf({ ...run.doc!, blocks }, { createdAt: new Date(run.input.at) });
  return { ...run, pdf: { ok: true, bytes, extract: await extractPdf(bytes) } };
}

const firstMatch = (blocks: RenderBlock[], pick: (b: RenderBlock) => boolean): RenderBlock => {
  const found = blocks.find(pick);
  if (!found) throw new Error("the planted defect needs a block this case does not have");
  return found;
};
const runsOf = (block: RenderBlock): RenderInline[] => ("content" in block ? (block.content as RenderInline[]) : []);

describe("the parity check catches", () => {
  let lists: CaseRun;
  let links: CaseRun;
  let blanks: CaseRun;
  let spaces: CaseRun;
  let tables: CaseRun;
  beforeAll(async () => {
    [lists, links, blanks, spaces, tables] = await Promise.all(["lists-mixed", "links", "blank-lines", "spaces-and-breaks", "tables"].map(base));
  }, 60_000);

  it("a clean run (so the rest mean something)", () => {
    for (const run of [lists, links, blanks, spaces, tables]) expect(parityProblems(run)).toEqual([]);
  });

  it("a changed marker on the web page", () => {
    expect(parityProblems(withWeb(lists, (html) => html.replace(/>1\.</, ">2.<"))).join("\n")).toContain("web: content differs");
  });
  it("a dropped paragraph in the email HTML", () => {
    const run = withEmail(blanks, (e) => ({ html: e.html.replace(/<p[^>]*>[^<]*After two blank paragraphs\.<\/p>/, "") }));
    expect(parityProblems(run).join("\n")).toContain("email.html: content differs");
  });
  it("a blank paragraph dropped from the web page", () => {
    const run = withWeb(blanks, (html) => html.replace(/<p[^>]*><br><\/p>/, ""));
    expect(parityProblems(run).join("\n")).toContain("web: content differs");
  });
  it("a changed word in the plain text", () => {
    const run = withEmail(lists, (e) => ({ text: e.text.replace("Item after an empty item", "Item after an empty bullet") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("a list the browser would number itself", () => {
    const start = withWeb(lists, (html) => html.replace("<ol>", '<ol start="3">'));
    expect(parityProblems(start).join("\n")).toContain("may number the list itself");
    const style = withWeb(lists, (html) => html.replace("</style>", "ol{list-style:decimal}</style>"));
    expect(parityProblems(style).join("\n")).toContain("lets a client number a list itself");
  });
  it("a marker hidden from assistive technology", () => {
    const run = withWeb(lists, (html) => html.replace(/<span class="marker">/, '<span class="marker" aria-hidden="true">'));
    expect(parityProblems(run).join("\n")).toContain("hidden from assistive technology");
  });
  it("a changed marker in the plain text", () => {
    const run = withEmail(lists, (e) => ({ text: e.text.replace(/^1\. /m, "2. ") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("a table cell lost from the plain text", () => {
    const run = withEmail(tables, (e) => ({ text: e.text.replace("Yearly", "") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("a changed link address in the web page", () => {
    const run = withWeb(links, (html) => html.replace('href="https://coral.example/terms"', 'href="https://coral.example/other"'));
    expect(parityProblems(run).join("\n")).toContain("web: links differ");
  });
  it("a link address missing from the plain text", () => {
    const run = withEmail(links, (e) => ({ text: e.text.replace(" (https://coral.example/bullet)", "") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("two cells swapped in the plain text", () => {
    const run = withEmail(tables, (e) => ({ text: e.text.replace("$95", "\u0000").replace("Yearly", "$95").replace("\u0000", "Yearly") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("a blank paragraph dropped from a list item in the plain text", () => {
    const run = withEmail(blanks, (e) => ({ text: e.text.replace("Bullet with a blank paragraph after it\n\n", "Bullet with a blank paragraph after it\n") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("collapsed spaces on the web page", () => {
    const run = withWeb(spaces, (html) => html.replace("Two  spaces,", "Two spaces,"));
    expect(parityProblems(run).join("\n")).toContain("typed spaces or hard breaks differ");
  });
  it("trimmed leading spaces in the plain text", () => {
    const run = withEmail(spaces, (e) => ({ text: e.text.replace("   Three leading spaces.", "Three leading spaces.") }));
    expect(parityProblems(run).join("\n")).toContain("email.txt: content differs");
  });
  it("collapsed spaces in a table cell on the web page", () => {
    const run = withWeb(spaces, (html) => html.replace("<p>  Indented cell", "<p> Indented cell"));
    expect(parityProblems(run).join("\n")).toContain("web: typed spaces or hard breaks differ");
  });
  it("a hard break dropped from a list item in the email HTML", () => {
    const run = withEmail(spaces, (e) => ({ html: e.html.replace("Bullet<br>continued", "Bullet continued") }));
    expect(parityProblems(run).join("\n")).toContain("email.html: typed spaces or hard breaks differ");
  });
  it("a changed marker in the PDF", async () => {
    const run = await withPdfOf(lists, (blocks) => {
      const list = firstMatch(blocks, (b) => b.type === "list" && b.ordered);
      if (list.type === "list") list.items[0]!.marker = "9.";
    });
    expect(parityProblems(run).join("\n")).toContain("pdf: content differs");
  });
  it("a paragraph dropped from the PDF", async () => {
    const run = await withPdfOf(blanks, (blocks) => void blocks.splice(blocks.findIndex((b) => b.type === "paragraph" && runsOf(b).some((r) => r.type === "text" && r.text.startsWith("After two"))), 1));
    expect(parityProblems(run).join("\n")).toContain("pdf: content differs");
  });
  it("a blank paragraph dropped from the PDF", async () => {
    const run = await withPdfOf(blanks, (blocks) => void blocks.splice(blocks.findIndex((b) => b.type === "paragraph" && runsOf(b).length === 0 && blocks.indexOf(b) > 0), 1));
    expect(parityProblems(run).join("\n")).toContain("pdf: content differs");
  });
  it("a changed link address in the PDF", async () => {
    const run = await withPdfOf(links, (blocks) => {
      const para = firstMatch(blocks, (b) => runsOf(b).some((r) => r.type === "text" && r.href === "https://coral.example/terms"));
      for (const r of runsOf(para)) if (r.type === "text" && r.href === "https://coral.example/terms") r.href = "https://coral.example/other";
    });
    expect(parityProblems(run).join("\n")).toContain("pdf: links differ");
  });
  it("a character changed inside a PDF table", async () => {
    const run = await withPdfOf(tables, (blocks) => {
      const table = firstMatch(blocks, (b) => b.type === "table");
      if (table.type === "table") {
        const para = table.rows[1]!.cells[1]!.content[0]!;
        const run0 = runsOf(para)[0]!;
        if (run0.type === "text") run0.text = "$96";
      }
    });
    expect(parityProblems(run).join("\n")).toContain("pdf: content differs");
  });
  it("two cells swapped in a PDF table", async () => {
    const run = await withPdfOf(tables, (blocks) => {
      const table = firstMatch(blocks, (b) => b.type === "table");
      if (table.type === "table") {
        const cells = table.rows[1]!.cells;
        [cells[0]!.content, cells[1]!.content] = [cells[1]!.content, cells[0]!.content];
      }
    });
    expect(parityProblems(run).join("\n")).toContain("pdf: content differs");
  });
  it("a glyph the font could not draw", () => {
    if (!lists.pdf?.ok) throw new Error("the lists-mixed case must render a PDF");
    const run: CaseRun = { ...lists, pdf: { ...lists.pdf, extract: { ...lists.pdf.extract, missingGlyphs: 2 } } };
    expect(parityProblems(run).join("\n")).toContain("missing glyph");
  });
});
