// @vitest-environment node
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { describeImport, finishImport } from "@/domain/import";
import type { ConvertedFile } from "@/domain/import-types";
import type { JSONContent, RequiredSection } from "@/domain/types";
import { convertFile } from "./convert";
import { allowlistHtml, stripNotes, withDom } from "./dom";
import { decodeText, hasAscii, sniffKind } from "./sniff";

// The converters on the generated fixtures (e2e/fixtures/import, made by make-fixtures.mjs) and on
// files made here for the refusals.

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];

const fixture = (name: string) => new Uint8Array(readFileSync(`e2e/fixtures/import/${name}`));
const text = (s: string) => new TextEncoder().encode(s);

async function converted(kind: "docx" | "pdf" | "txt", bytes: Uint8Array): Promise<ConvertedFile> {
  const result = await convertFile(kind, bytes);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result.file;
}

const types = (body: JSONContent) => (body.content ?? []).map((b) => (b.attrs?.requiredKey as string | undefined) ?? b.type);

async function docxWith(bodyXml: string, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  for (const [name, data] of Object.entries(extra)) zip.file(name, data);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
const wp = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;

const h = React.createElement;
const pdfOf = (pages: React.ReactElement[]) => renderToBuffer(h(Document, null, ...pages)).then((b) => new Uint8Array(b));

// ── Sniffing ─────────────────────────────────────────────────────────────────

describe("sniffKind: decided from the bytes", () => {
  it("knows the three fixtures", () => {
    expect(sniffKind(fixture("spring-offer.docx"), "anything.bin")).toBe("docx");
    expect(sniffKind(fixture("rate-change-notice.pdf"), "x")).toBe("pdf");
    expect(sniffKind(fixture("spring_offer_notes.txt"), "notes.TXT")).toBe("txt");
  });

  it("refuses a legacy .doc, a zip that isn't a Word document, binary text and a text file not named .txt", async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(sniffKind(doc, "old.doc")).toBeNull();
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    expect(sniffKind(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), "a.docx")).toBeNull();
    expect(sniffKind(new Uint8Array([0x68, 0x00, 0x69]), "a.txt")).toBeNull();
    expect(sniffKind(new Uint8Array([0xff, 0xfe, 0x41]), "a.txt")).toBeNull();
    expect(sniffKind(text("plain"), "a.md")).toBeNull();
  });

  it("decodeText takes UTF-8 with a BOM; hasAscii finds zip entry names", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(hasAscii(text("xxword/document.xmlyy"), "word/document.xml")).toBe(true);
    expect(hasAscii(text("word/documen"), "word/document.xml")).toBe(false);
  });
});

// ── .docx ────────────────────────────────────────────────────────────────────

describe(".docx", () => {
  it("the fixture: title, chips across runs, sections, a header row, and what was left out", async () => {
    const bytes = fixture("spring-offer.docx");
    const file = await converted("docx", bytes);
    const done = finishImport({ file, filename: "spring-offer.docx", size: bytes.length, requiredSections: SECTIONS });

    expect(done.name).toBe("Spring Balance Transfer Offer");
    expect(done.variables.map((v) => v.key)).toEqual(["first_name", "purchase_apr", "offer_end_date", "annual_fee"]);
    expect(done.report.placeholders[0]).toEqual({
      key: "first_name",
      label: "First name",
      raw: ["{{First Name}}", "{{first_name}}"],
      count: 2,
    });
    expect(types(done.body)).toEqual([
      "paragraph",
      "paragraph",
      "offer_details",
      "paragraph",
      "paragraph",
      "paragraph",
      "rates_and_fees",
      "table",
      "legal_notices",
    ]);
    // "{{Purch" + "ase APR}}" in two bold runs is one bold chip.
    expect(done.body.content?.[1]?.content?.[2]).toEqual({ type: "variable", attrs: { key: "purchase_apr" }, marks: [{ type: "bold" }] });
    const table = done.body.content?.[7];
    expect(table?.content?.[0]?.content?.map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(JSON.stringify(table)).toContain('"key":"annual_fee"');

    expect(file.dropped).toEqual([
      { kind: "images", count: 1 },
      { kind: "comments", count: 1 },
      { kind: "headers_footers" },
      { kind: "styles", names: ["Quote"] },
    ]);
    expect(describeImport(done.report)).toEqual({
      detected: ["4 variables, all Text and required: First name, Purchase APR, Offer end date, Annual fee", "1 table", "Added empty section: Legal notices"],
      dropped: ["1 image (still shown in Original)", "1 comment", "Headers and footers", "Quote formatting"],
      kept: ["{{#if member}} … {{/if}} shows to customers as written."],
    });
  });

  it("the Compare HTML is allowlisted and keeps the image as a data: URI", async () => {
    const file = await converted("docx", fixture("spring-offer.docx"));
    expect(file.compareHtml).toMatch(/^<h1>Spring Balance Transfer Offer<\/h1><p>Dear \{\{First Name\}\},<\/p>/);
    expect(file.compareHtml).toContain("<thead><tr><th><p><strong>Fee</strong></p></th>");
    expect(file.compareHtml).toContain('<img src="data:image/png;base64,');
    expect(file.compareHtml).not.toMatch(/comment|footnote|id=|class=|style=/i);
  });

  it("refuses an empty document, a broken zip and too much text", async () => {
    expect(await convertFile("docx", await docxWith(""))).toEqual({ ok: false, code: "empty" });
    const broken = text("PK\u0003\u0004 word/document.xml but not really a zip");
    expect(await convertFile("docx", broken)).toEqual({ ok: false, code: "unreadable" });
    const long = await docxWith(wp("x".repeat(100_001)) + wp("y".repeat(100_000)));
    expect(await convertFile("docx", long)).toEqual({ ok: false, code: "tooLong" });
  });

  it("footnotes are counted and left out of the draft and the Compare view", async () => {
    const bytes = await docxWith(
      `<w:p><w:r><w:t>Rates apply.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      {
        "word/footnotes.xml": `<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>See terms.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
        "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
      },
    );
    const file = await converted("docx", bytes);
    expect(file.dropped).toContainEqual({ kind: "footnotes", count: 1 });
    expect(JSON.stringify(file.body)).not.toContain("See terms");
    expect(file.compareHtml).toBe("<p>Rates apply.</p>");
  });
});

describe("dom helpers", () => {
  it("allowlistHtml keeps the allowed tags, safe links and data: images within the budget, nothing else", async () => {
    const html = await withDom((parse) =>
      allowlistHtml(
        parse(
          `<h4 class="x">T</h4><p style="color:red" onclick="x()">a <b>b</b> <i>c</i> <span>d</span><script>alert(1)</script></p>` +
            `<a href="javascript:alert(1)">bad</a><a href="https://example.com/?a=1&b=2">ok</a>` +
            `<table><tr><td colspan="2" width="9">x</td></tr></table><img src="https://evil.test/x.png">` +
            `<img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,${"A".repeat(40)}">`,
        ).body,
        10,
      ),
    );
    expect(html).toBe(
      '<h3>T</h3><p>a <strong>b</strong> <em>c</em> d</p>bad<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">ok</a>' +
        '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table><img src="data:image/png;base64,AAAA" alt="">',
    );
  });

  it("stripNotes removes mammoth's comment and note lists and their marks", async () => {
    const out = await withDom((parse) => {
      const root = parse(
        `<p>A<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup> B<sup><a href="#comment-0">[MC1]</a></sup></p>` +
          `<dl><dt id="comment-0">Comment [MC1]</dt><dd><p>note</p></dd></dl><ol><li id="footnote-1"><p>See terms.</p></li></ol>`,
      ).body;
      return { counts: stripNotes(root), html: root.innerHTML };
    });
    expect(out).toEqual({ counts: { comments: 1, footnotes: 1 }, html: "<p>A B</p>" });
  });
});

// ── .pdf ─────────────────────────────────────────────────────────────────────

describe(".pdf", () => {
  it("the fixture: title from the large first line, sections, a list, running lines dropped", async () => {
    const bytes = fixture("rate-change-notice.pdf");
    const file = await converted("pdf", bytes);
    const done = finishImport({ file, filename: "rate-change-notice.pdf", size: bytes.length, requiredSections: SECTIONS });

    expect(file.pages).toBe(2);
    expect(done.name).toBe("Rate Change Notice");
    expect(types(done.body)).toEqual([
      "paragraph",
      "offer_details",
      "paragraph",
      "bulletList",
      "paragraph",
      "rates_and_fees",
      "paragraph",
      "legal_notices",
      "paragraph",
    ]);
    expect(done.report.sections.added).toEqual([]);
    expect(done.variables.map((v) => v.key)).toEqual(["first_name", "effective_date", "purchase_apr", "balance_transfer_apr", "cash_apr", "annual_fee"]);
    expect(file.dropped).toEqual([{ kind: "pdf_layout" }, { kind: "repeated_lines", count: 2 }]);
    expect(JSON.stringify(done.body)).not.toMatch(/Coral Bank · Rate change notice|Page \d of/);
  });

  it("refuses a PDF with no text and one over 50 pages", async () => {
    const blank = await pdfOf([h(Page, { key: 1 }, h(View, { style: { width: 100, height: 100, backgroundColor: "#ccc" } }))]);
    expect(await convertFile("pdf", blank)).toEqual({ ok: false, code: "pdfNoText" });
    const many = await pdfOf(Array.from({ length: 51 }, (_, i) => h(Page, { key: i }, h(Text, null, `Page ${i}`))));
    expect(await convertFile("pdf", many)).toEqual({ ok: false, code: "pdfPages" });
  }, 30_000);

  it("refuses a password-protected PDF, and one it can't parse", async () => {
    const hex = (n: number) => "ab".repeat(n);
    const locked = text(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n" +
        `4 0 obj << /Filter /Standard /V 1 /R 2 /O <${hex(32)}> /U <${hex(32)}> /P -4 >> endobj\n` +
        `trailer << /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(16)}> <${hex(16)}>] >>\n%%EOF\n`,
    );
    expect(await convertFile("pdf", locked)).toEqual({ ok: false, code: "pdfLocked" });
    expect(await convertFile("pdf", text("%PDF-1.4\nnothing else"))).toEqual({ ok: false, code: "unreadable" });
  });
});

// ── .txt ─────────────────────────────────────────────────────────────────────

describe(".txt", () => {
  it("the fixture: paragraphs, chips, and every section added", async () => {
    const bytes = fixture("spring_offer_notes.txt");
    const done = finishImport({ file: await converted("txt", bytes), filename: "spring_offer_notes.txt", size: bytes.length, requiredSections: SECTIONS });
    expect(done.name).toBe("Spring offer notes");
    expect(types(done.body)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph", "offer_details", "rates_and_fees", "legal_notices"]);
    expect(done.variables.map((v) => v.key)).toEqual(["first_name", "purchase_apr", "effective_date"]);
  });

  it("refuses an empty file and too much text", async () => {
    expect(await convertFile("txt", text(" \n\n "))).toEqual({ ok: false, code: "empty" });
    expect(await convertFile("txt", text("a".repeat(200_001)))).toEqual({ ok: false, code: "tooLong" });
  });
});
