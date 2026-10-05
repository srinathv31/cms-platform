import { IMPORT_LIMITS, type ConvertResult, type ImportDrop } from "@/domain/import-types";
import { pdfLinesToBody, type PdfPageText, type PdfTextItem } from "@/domain/import";

// .pdf → schema JSON: pdf.js reads each page's text items, src/domain/import.ts (pdfLinesToBody)
// turns them into lines, paragraphs, lists and headings. Text only: layout, tables and images don't
// come across (reported). Refused: password-protected, more than 50 pages, too much text, no text.
//
// pdf.js runs with its worker in-process (docs/decisions/track-c.md): bundling breaks its fake-worker
// import, so the worker module is loaded into globalThis.pdfjsWorker BEFORE pdf.js itself. pdf.js
// caches a failed worker setup for the module's lifetime, so this order must never change.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfJs> | null = null;

function loadPdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function convertPdf(bytes: Uint8Array): Promise<ConvertResult> {
  const pdfjs = await loadPdfjs();
  // pdf.js takes ownership of the buffer it's given: hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    let pdf: Awaited<typeof task.promise>;
    try {
      pdf = await task.promise;
    } catch (error) {
      return { ok: false, code: error instanceof pdfjs.PasswordException ? "pdfLocked" : "unreadable" };
    }
    if (pdf.numPages > IMPORT_LIMITS.maxPdfPages) return { ok: false, code: "pdfPages" };

    const pages: PdfPageText[] = [];
    let chars = 0;
    let visible = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        // Into viewport space: y measured down from the top of the page, rotation and crop applied.
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(c, d) || item.height;
        items.push({ str: item.str, x, y, w: item.width, h: size });
        chars += item.str.length;
        visible += item.str.trim().length;
      }
      pages.push({ items });
      page.cleanup();
      if (chars > IMPORT_LIMITS.maxChars) return { ok: false, code: "tooLong" };
    }
    if (!visible) return { ok: false, code: "pdfNoText" };

    const { body, repeatedLines } = pdfLinesToBody(pages);
    if (!body.content?.length) return { ok: false, code: "pdfNoText" };
    const dropped: ImportDrop[] = [{ kind: "pdf_layout" }];
    if (repeatedLines) dropped.push({ kind: "repeated_lines", count: repeatedLines });
    return { ok: true, file: { kind: "pdf", body, pages: pdf.numPages, dropped } };
  } catch (error) {
    console.error("Import: pdf.js couldn't read this PDF", error);
    return { ok: false, code: "unreadable" };
  } finally {
    await task.destroy();
  }
}
