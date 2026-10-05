// Makes the import fixtures (Phase 7a): a .docx built with jszip (real heading styles, a table with
// a header row, {{First Name}} / {{first_name}} / {{Purchase APR}} placeholders, one split across
// formatted runs, {{#if member}} logic, one image, one comment, a footer and an unmapped "Quote"
// style; "Legal notices" left out so the import adds it), a 2-page .pdf made with
// @react-pdf/renderer (title, the three sections, a list, a running footer and page numbers), and a .txt.
//
//   node e2e/fixtures/import/make-fixtures.mjs
//
// Writes next to this file. Deterministic apart from the PDF's creation date.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── .docx ────────────────────────────────────────────────────────────────────

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text, { bold = false } = {}) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (runs, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
const cell = (text, header) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${para(run(text, { bold: header }))}</w:tc>`;
const row = (cells, header = false) =>
  `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((c) => cell(c, header)).join("")}</w:tr>`;

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const image = `<w:p><w:r><w:drawing>
  <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="952500" cy="952500"/>
    <wp:docPr id="1" name="Logo" descr="Coral logo"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill>
          <pic:spPr/>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r></w:p>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}">
<w:body>
${para(run("Spring Balance Transfer Offer"), "Title")}
${para(run("Dear {{First Name}},"))}
${para(run("Thank you for being a Coral cardmember. ") + run("Your purchase APR is {{Purch", { bold: true }) + run("ase APR}}.", { bold: true }))}
${para(run("1. Offer details:"), "Heading1")}
${para(run("Transfer a balance by {{offer_end_date}} and pay 0% intro APR for 15 months, {{first_name}}."))}
<w:p><w:commentRangeStart w:id="0"/>${run("{{#if member}}Members also pay no transfer fee.{{/if}}")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
${para(run("Terms apply to every transfer."), "Quote")}
${para(run("Rates and Fees"), "Heading1")}
<w:tbl>
  <w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>
  ${row(["Fee", "Amount"], true)}
  ${row(["Annual fee", "{{annual_fee}}"])}
  ${row(["Balance transfer fee", "3% of each transfer"])}
</w:tbl>
${image}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>
</w:body>
</w:document>`;

const style = (id, name, type = "paragraph", extra = "") =>
  `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
${style("Normal", "Normal", "paragraph", "<w:qFormat/>")}
${style("Title", "Title", "paragraph", '<w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="56"/></w:rPr>')}
${style("Heading1", "heading 1", "paragraph", '<w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>')}
${style("Quote", "Quote", "paragraph", '<w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr>')}
</w:styles>`;

const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}">
<w:comment w:id="0" w:author="Maya Chen" w:initials="MC">${para(run("Legal to confirm the member wording."))}</w:comment>
</w:comments>`;

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W}">${para(run("Coral Bank · Member FDIC"))}</w:ftr>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>
<Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/>
<Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>
<Relationship Id="rIdImage" Type="${REL}/image" Target="media/image1.png"/>
<Relationship Id="rIdComments" Type="${REL}/comments" Target="comments.xml"/>
<Relationship Id="rIdFooter" Type="${REL}/footer" Target="footer1.xml"/>
</Relationships>`;

async function makeDocx() {
  const zip = new JSZip();
  const date = new Date("2026-10-01T00:00:00Z");
  const add = (name, data) => zip.file(name, data, { date });
  add("[Content_Types].xml", contentTypesXml);
  add("_rels/.rels", rootRels);
  add("word/document.xml", documentXml);
  add("word/_rels/document.xml.rels", documentRels);
  add("word/styles.xml", stylesXml);
  add("word/comments.xml", commentsXml);
  add("word/footer1.xml", footerXml);
  add("word/media/image1.png", PNG);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── .pdf ─────────────────────────────────────────────────────────────────────

const h = React.createElement;
const s = StyleSheet.create({
  page: { paddingTop: 72, paddingBottom: 90, paddingHorizontal: 72, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 22, marginBottom: 18 },
  heading: { fontSize: 15, marginTop: 14, marginBottom: 8 },
  p: { marginBottom: 9 },
  li: { marginBottom: 3 },
  footer: { position: "absolute", left: 72, right: 72, bottom: 40, fontSize: 9 },
  number: { position: "absolute", left: 72, right: 72, bottom: 26, fontSize: 9 },
});

const long =
  "We are writing to tell you about a change to the interest rates on your Coral credit card account. " +
  "Starting on {{effective_date}}, the purchase APR on your account will be {{Purchase APR}}. This change " +
  "applies to new purchases made on or after that date, and to any balance you carry from earlier statements.";

function notice() {
  return h(
    Document,
    { title: "Rate Change Notice", creator: "UCOMP fixtures", producer: "UCOMP fixtures" },
    h(
      Page,
      { size: "LETTER", style: s.page },
      h(Text, { style: s.title }, "Rate Change Notice"),
      h(Text, { style: s.p }, "Dear {{first_name}},"),
      h(Text, { style: s.heading }, "Offer details"),
      h(Text, { style: s.p }, long),
      h(Text, { style: s.li }, "• Purchases: {{Purchase APR}}"),
      h(Text, { style: s.li }, "• Balance transfers: {{balance_transfer_apr}}"),
      h(Text, { style: s.li }, "• Cash advances: {{cash_apr}}"),
      h(Text, { style: [s.p, { marginTop: 9 }] }, "{{#if member}}As a member you keep your current rate for 90 days.{{/if}}"),
      h(View, { break: true }),
      h(Text, { style: s.heading }, "Rates and fees"),
      h(Text, { style: s.p }, "The annual fee stays at {{annual_fee}}. Late payment fees are unchanged."),
      h(Text, { style: s.heading }, "Legal notices"),
      h(Text, { style: s.p }, "You may reject this change by writing to us before {{effective_date}}. If you do, your account will be closed."),
      h(Text, { style: s.footer, fixed: true }, "Coral Bank · Rate change notice"),
      h(Text, { style: s.number, fixed: true, render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
    ),
  );
}

// ── .txt ─────────────────────────────────────────────────────────────────────

const txt = `Dear {{First Name}},

Your new purchase APR of {{purchase_apr}} applies from {{Effective Date}}.
It replaces the rate shown on your last statement.

{{#if member}}Thank you for being a member.{{/if}}

Questions? Call the number on the back of your card.
`;

// ── Write ────────────────────────────────────────────────────────────────────

await writeFile(path.join(here, "spring-offer.docx"), await makeDocx());
await writeFile(path.join(here, "rate-change-notice.pdf"), await renderToBuffer(notice()));
await writeFile(path.join(here, "spring_offer_notes.txt"), txt);
console.log("Wrote spring-offer.docx, rate-change-notice.pdf, spring_offer_notes.txt");
