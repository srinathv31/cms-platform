// pdf.js ships no types for its worker module. The import only needs it to exist: loaded into
// globalThis.pdfjsWorker, it lets pdf.js run its worker in-process on the server (src/server/import/pdf.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
