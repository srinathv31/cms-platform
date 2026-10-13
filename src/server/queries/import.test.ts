import { describe, expect, it } from "vitest";
import type { ImportReport } from "@/domain/import-report";
import type { ImportedOriginal } from "@/server/services/templates";
import { importOriginalRef, importOriginalView } from "./import";

// The Original tab's read model is the BFF's: the backend answers facts (who uploaded what, the report, the docx's
// Compare HTML), and these words and lay them out. Tested on facts built by hand.

const original = (kind: ImportedOriginal["kind"]): ImportedOriginal => ({
  uploadId: "up_abcdefghjk",
  filename: `Spring offer.${kind}`,
  kind,
  size: 2048,
  uploadedAt: "2026-10-04T13:00:00.000Z",
  uploadedBy: { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 },
});

const report = (kind: ImportReport["kind"]): ImportReport => ({
  kind,
  filename: `Spring offer.${kind}`,
  size: 2048,
  ...(kind === "pdf" ? { pages: 2 } : {}),
  nameFrom: "filename",
  placeholders: [
    {
      key: "first_name",
      label: "First name",
      raw: ["{{First Name}}"],
      count: 1,
    },
  ],
  skippedPlaceholders: [],
  sections: { matched: [], added: [] },
  counts: { headings: 1, paragraphs: 2, lists: 0, tables: 0 },
  dropped: [],
});

describe("importOriginalRef", () => {
  it("names the uploader, the cheap fact the workspace carries", () => {
    expect(importOriginalRef(original("docx"))).toEqual({
      uploadId: "up_abcdefghjk",
      filename: "Spring offer.docx",
      kind: "docx",
      size: 2048,
      uploadedAt: "2026-10-04T13:00:00.000Z",
      uploadedByName: "Maya Chen",
    });
  });
});

describe("importOriginalView", () => {
  it("shows a Word file as its Compare HTML, with the report's lines", () => {
    const view = importOriginalView(
      {
        original: original("docx"),
        report: report("docx"),
        compareHtml: "<h1>Spring</h1>",
      },
      null,
    );
    expect(view).toMatchObject({
      ref: { kind: "docx", uploadedByName: "Maya Chen" },
      source: { kind: "docx", html: "<h1>Spring</h1>" },
      report: report("docx"),
    });
    expect(view?.lines.detected[0]).toBe(
      "1 variable, Text and required: First name",
    );
  });

  it("draws a PDF from the file route, naming its pages", () => {
    expect(
      importOriginalView(
        { original: original("pdf"), report: report("pdf"), compareHtml: null },
        null,
      )?.source,
    ).toEqual({
      kind: "pdf",
      fileUrl: "/api/imports/up_abcdefghjk/file",
      pages: 2,
    });
  });

  it("shows a text file as its text, without a byte order mark", () => {
    expect(
      importOriginalView(
        { original: original("txt"), report: report("txt"), compareHtml: null },
        "﻿hello\nworld",
      )?.source,
    ).toEqual({ kind: "txt", text: "hello\nworld" });
  });

  it("has nothing to show for a Word file without its Compare HTML, or a text file whose bytes can't be read", () => {
    expect(
      importOriginalView(
        {
          original: original("docx"),
          report: report("docx"),
          compareHtml: null,
        },
        null,
      ),
    ).toBeNull();
    expect(
      importOriginalView(
        { original: original("txt"), report: report("txt"), compareHtml: null },
        null,
      ),
    ).toBeNull();
  });
});
