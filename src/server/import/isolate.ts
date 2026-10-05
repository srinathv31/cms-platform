import "server-only";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { IMPORT_LIMITS, type ImportRefusalCode } from "@/domain/import-types";
import type { PdfPageText } from "@/domain/import";

// Runs the untrusted half of a .docx or .pdf conversion (convert-worker.mjs) in a worker thread with
// a heap limit and a timeout. A decompression bomb that exhausts the worker's heap, or a file that
// keeps the parser busy, ends that worker and comes back as `unreadable` ("Couldn't read this
// file."); the server and everyone else's requests carry on. One worker per conversion, always ended.

/**
 * The worker's file, run as-is (not bundled). Turbopack bundles a `new Worker(...)` it can resolve,
 * even with a turbopackIgnore comment, and its node-worker loader reads `__dirname`, which the
 * app-route runtime doesn't define. So the path is a literal joined to process.cwd() (the project root
 * under `next dev`, `next start` and vitest, as pdf-fonts.ts) and the worker is constructed through
 * Reflect.construct, which Turbopack doesn't rewrite. The worker imports only packages, which
 * resolve from node_modules.
 */
const WORKER_FILE = path.join(process.cwd(), "src/server/import/convert-worker.mjs");

/** mammoth's style map for the import: Word's Title style is an H1 (it becomes the template's name). */
export const DOCX_STYLE_MAP = ["p[style-name='Title'] => h1:fresh", "comment-reference => sup"];

export const ISOLATION_LIMITS = {
  /** The worker's V8 heap (old generation). A real 10 MB upload converts in well under this. */
  maxHeapMb: 256,
  /** How long one conversion may take. A 50-page PDF takes a few seconds. */
  timeoutMs: 30_000,
  /** mammoth's HTML, images included as data: URIs (a 10 MB upload stays far below). */
  maxHtmlChars: 40 * 1024 * 1024,
} as const;

export type IsolatedDocx = { ok: true; html: string; messages: string[]; images: number };
export type IsolatedPdf = { ok: true; pages: PdfPageText[]; numPages: number };
type Refused = { ok: false; code: ImportRefusalCode };

export interface IsolationOptions {
  maxHeapMb?: number;
  timeoutMs?: number;
}

export function isolatedDocx(bytes: Uint8Array, options?: IsolationOptions): Promise<IsolatedDocx | Refused> {
  return runIsolated("docx", bytes, options) as Promise<IsolatedDocx | Refused>;
}

export function isolatedPdf(bytes: Uint8Array, options?: IsolationOptions): Promise<IsolatedPdf | Refused> {
  return runIsolated("pdf", bytes, options) as Promise<IsolatedPdf | Refused>;
}

function runIsolated(kind: "docx" | "pdf", bytes: Uint8Array, options: IsolationOptions = {}): Promise<unknown> {
  const maxHeapMb = options.maxHeapMb ?? ISOLATION_LIMITS.maxHeapMb;
  const timeoutMs = options.timeoutMs ?? ISOLATION_LIMITS.timeoutMs;
  const limits = {
    styleMap: DOCX_STYLE_MAP,
    maxChars: IMPORT_LIMITS.maxChars,
    maxPdfPages: IMPORT_LIMITS.maxPdfPages,
    maxHtmlChars: ISOLATION_LIMITS.maxHtmlChars,
  };

  return new Promise((resolve) => {
    let settled = false;
    const options: WorkerOptions = {
      workerData: { kind, bytes, limits },
      resourceLimits: { maxOldGenerationSizeMb: maxHeapMb, maxYoungGenerationSizeMb: Math.min(32, maxHeapMb) },
      stdout: false,
      stderr: false,
    };
    const worker: Worker = Reflect.construct(Worker, [WORKER_FILE, options]);
    const finish = (value: unknown, problem?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (problem) console.error(`Import: the ${kind} conversion was stopped`, problem);
      void worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "unreadable" }, new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    worker.once("message", (message: unknown) => finish(message));
    // ERR_WORKER_OUT_OF_MEMORY (the heap limit) and anything the worker throws.
    worker.once("error", (error) => finish({ ok: false, code: "unreadable" }, error));
    worker.once("exit", (code) => finish({ ok: false, code: "unreadable" }, new Error(`the worker exited (${code})`)));
  });
}
