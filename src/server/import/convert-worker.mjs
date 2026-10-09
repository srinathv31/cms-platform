// The import's untrusted parsing, in a worker thread (src/server/import/isolate.ts starts it).
//
// A .docx or .pdf is a compressed container: a small upload can inflate to gigabytes (a
// decompression bomb). mammoth (JSZip + an XML DOM) and pdf.js run HERE, under the worker's heap
// limit and a timeout, so a bomb that exhausts memory or runs forever ends this worker, never the
// server. Only bounded results come back: mammoth's HTML (refused when its text alone is too long)
// and pdf.js's positioned text items. Everything else (the DOM cleanup, the schema JSON) runs on the
// main thread, on that bounded output.
//
// Plain JavaScript importing only packages, so the same file runs bundled (next build) and as-is
// (vitest). Input: workerData { kind: "docx" | "pdf", bytes: Uint8Array, limits }. Output: one
// message, { ok: true, ... } or { ok: false, code }.

import { parentPort, workerData } from "node:worker_threads";

const { kind, bytes, limits } = workerData;

/** A rough count of the text in mammoth's HTML (tags dropped, entities as one character). */
function textLength(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&[#a-z0-9]+;/gi, "x").length;
}

async function docx() {
  const { default: mammoth } = await import("mammoth");
  let images = 0;
  let result;
  try {
    result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
      {
        styleMap: limits.styleMap,
        convertImage: mammoth.images.imgElement(async (image) => {
          images += 1;
          return { src: `data:${image.contentType};base64,${await image.readAsBase64String()}` };
        }),
      },
    );
  } catch {
    return { ok: false, code: "unreadable" };
  }
  if (result.value.length > limits.maxHtmlChars) return { ok: false, code: "tooLong" };
  if (textLength(result.value) > limits.maxChars) return { ok: false, code: "tooLong" };
  return { ok: true, html: result.value, messages: result.messages.map((m) => m.message), images };
}

// pdf.js runs with its worker in-process (docs/decisions/prototype-log.md): bundling breaks its fake-worker
// import, so the worker module is loaded into globalThis.pdfjsWorker BEFORE pdf.js itself.
async function pdf() {
  globalThis.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it's given: hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      return { ok: false, code: error instanceof pdfjs.PasswordException ? "pdfLocked" : "unreadable" };
    }
    if (doc.numPages > limits.maxPdfPages) return { ok: false, code: "pdfPages" };

    const pages = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        // Into viewport space: y measured down from the top of the page, rotation and crop applied.
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(c, d) || item.height;
        items.push({ str: item.str, x, y, w: item.width, h: size });
        chars += item.str.length;
      }
      pages.push({ items });
      page.cleanup();
      if (chars > limits.maxChars) return { ok: false, code: "tooLong" };
    }
    return { ok: true, pages, numPages: doc.numPages };
  } catch {
    return { ok: false, code: "unreadable" };
  } finally {
    await task.destroy();
  }
}

try {
  parentPort.postMessage(kind === "docx" ? await docx() : await pdf());
} catch {
  parentPort.postMessage({ ok: false, code: "unreadable" });
}
