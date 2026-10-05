// pdf.js, loaded on demand (implementation plan §3 item 8: "pdf.js loads on the first PDF preview").
//
// Nothing here runs at import time. The first call imports `pdfjs-dist` (its own chunk, never in a
// route's initial bundle) and starts ONE module worker for the session; every later call, and every
// document after that, reuses both.
//
// Why an explicit PDFWorker instead of `GlobalWorkerOptions.workerPort`: with a global port, pdf.js
// caches one PDFWorker per port and every `loadingTask.destroy()` destroys that shared PDFWorker.
// The viewer keeps the old document on screen while the next one loads (double-buffer), so it
// destroys one document while another is live on the same worker; with the global port that either
// cuts the live one's handler or throws "the worker is being destroyed" on a fast re-render. A
// PDFWorker passed as `getDocument({ worker })` is never destroyed by a loading task, so one worker
// serves every document for the session. Always pass `worker` (see `openPdf`).

import type {
  DocumentInitParameters,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist/types/src/display/api";

export type PdfJs = typeof import("pdfjs-dist");
type PdfWorker = InstanceType<PdfJs["PDFWorker"]>;

export interface PdfRuntime {
  pdfjs: PdfJs;
  worker: PdfWorker;
}

let runtime: Promise<PdfRuntime> | null = null;
/** Rejects (and stays rejected) once the worker script fails; reset with the runtime. */
let workerFailed: Promise<never> | null = null;

/** The pdf.js module and the session's worker. The first call starts both; later calls reuse them. */
export function loadPdfjs(): Promise<PdfRuntime> {
  runtime ??= start().catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

async function start(): Promise<PdfRuntime> {
  const pdfjs = await import("pdfjs-dist");
  // The bundler sees `new Worker(new URL(…, import.meta.url))` and emits the worker as its own
  // file. The worker build is a self-contained ES module, hence `type: "module"`.
  const webWorker = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
    type: "module",
    name: "pdfjs",
  });
  workerFailed = new Promise<never>((_, reject) => {
    webWorker.addEventListener(
      "error",
      () => {
        // A worker that failed to load is gone for good: the next preview starts a fresh one.
        webWorker.terminate();
        runtime = null;
        reject(new Error("The PDF worker failed to start."));
      },
      { once: true },
    );
  });
  workerFailed.catch(() => {});
  const worker = pdfjs.PDFWorker.create({ port: webWorker, verbosity: pdfjs.VerbosityLevel.ERRORS });
  return { pdfjs, worker };
}

export interface OpenedPdf {
  /** Owned by the caller: `destroy()` it when the document is replaced or the viewer unmounts. */
  task: PDFDocumentLoadingTask;
  /** The document, or a rejection if the bytes are not a PDF or the worker died. */
  loaded: Promise<PDFDocumentProxy>;
}

/** Opens a PDF from bytes on the session worker. Pass a COPY: pdf.js transfers (detaches) the buffer. */
export function openPdf({ pdfjs, worker }: PdfRuntime, bytes: Uint8Array): OpenedPdf {
  const params: DocumentInitParameters & { isEvalSupported: false } = {
    data: bytes,
    worker,
    // pdf.js 6 no longer evaluates code (PostScript functions compile to Wasm or an interpreter) and
    // dropped this option; it stays as a guard in case the package is ever swapped for an older build.
    isEvalSupported: false,
    enableXfa: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  };
  const task = pdfjs.getDocument(params);
  // A dead worker never answers, so the load fails instead of waiting forever.
  const loaded = workerFailed ? Promise.race([task.promise, workerFailed]) : task.promise;
  return { task, loaded };
}
