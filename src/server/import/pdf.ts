import { IMPORT_LIMITS, type ConvertResult, type ImportDrop } from "@/domain/import-types";
import { pdfLinesToBody } from "@/domain/import";
import { isolatedPdf, type IsolationOptions } from "./isolate";

// .pdf → schema JSON: pdf.js reads each page's text items, src/domain/import.ts (pdfLinesToBody)
// turns them into lines, paragraphs, lists and headings. Text only: layout, tables and images don't
// come across (reported). Refused: password-protected, more than 50 pages, too much text, no text.
//
// pdf.js runs in a worker thread (convert-worker.mjs, started by isolate.ts) with a heap limit and a
// timeout: a PDF's compressed streams can decode to far more than the upload, and a bomb must end the
// worker, not the server. pdf.js's own worker still runs in-process inside it (docs/decisions/track-c.md).

export async function convertPdf(bytes: Uint8Array, isolation?: IsolationOptions): Promise<ConvertResult> {
  const result = await isolatedPdf(bytes, isolation);
  if (!result.ok) return result;
  const { pages, numPages } = result;
  if (numPages > IMPORT_LIMITS.maxPdfPages) return { ok: false, code: "pdfPages" };
  const visible = pages.reduce((n, page) => n + page.items.reduce((m, item) => m + item.str.trim().length, 0), 0);
  if (!visible) return { ok: false, code: "pdfNoText" };

  const { body, repeatedLines } = pdfLinesToBody(pages);
  if (!body.content?.length) return { ok: false, code: "pdfNoText" };
  const dropped: ImportDrop[] = [{ kind: "pdf_layout" }];
  if (repeatedLines) dropped.push({ kind: "repeated_lines", count: repeatedLines });
  return { ok: true, file: { kind: "pdf", body, pages: numPages, dropped } };
}
