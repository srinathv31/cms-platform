# PDF viewer

The preview's PDF viewer: [pdf-viewer.tsx](pdf-viewer.tsx) draws the bytes the preview route returns with pdf.js,
page by page, on a canvas with a text layer over it. [pdf-controller.ts](pdf-controller.ts) does the loading, the
double-buffered swap and which pages hold a canvas; [load-pdfjs.ts](load-pdfjs.ts) imports pdf.js on demand and starts
its one worker; [page-layers.ts](page-layers.ts) draws a page.

## `pdfjs-dist` is pinned

`package.json` pins `pdfjs-dist` to 6.4.299 without a `^`. JSON has no comments, so the reason is here. This viewer
copies pdf.js's own text-layer styles and calls parts of its API that a minor release can change, and the bundler
resolves two of pdf.js's files by their path inside the package. Bump it with
`npm install --save-exact pdfjs-dist@<version>`, then check each row below.

| Where                                               | Depends on                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` in [load-pdfjs.ts](load-pdfjs.ts)           | `pdfjs-dist/build/pdf.worker.min.mjs` exists at that path, is a self-contained ES module, and works as a module `Worker` the bundler emits from `new URL(…, import.meta.url)`.                                            |
| [load-pdfjs.ts](load-pdfjs.ts)                      | `PDFWorker.create({ port })` and a `worker` passed to `getDocument` that a loading task never destroys (why the file's header explains), and the type imports from `pdfjs-dist/types/src/display/api`.                    |
| `drawTextLayer` in [page-layers.ts](page-layers.ts) | `new TextLayer({ textContentSource, container, viewport })` with `render()` and `cancel()`, `page.streamTextContent({ includeMarkedContent: true })`, and the `endOfContent` element the selection styles expect.         |
| [pdf-viewer.module.css](pdf-viewer.module.css)      | The text-layer rules are copied from `pdfjs-dist/web/pdf_viewer.css` and trimmed, and use the custom properties `--scale-factor`, `--total-scale-factor` and `--user-unit`. Compare the file with pdf.js's on every bump. |
| `drawCanvas` in [page-layers.ts](page-layers.ts)    | `page.render({ canvas, viewport })` and a `RenderTask` that `cancel()` rejects.                                                                                                                                           |

[pdf-viewer.test.tsx](pdf-viewer.test.tsx) covers the viewer.

Two other places use the package, and a bump checks them too: the import's worker
([convert-worker.mjs](../../../server/import/convert-worker.mjs), the `legacy` build with its worker module loaded
first) and the PDF adapter's fonts and tests
([render channels README](../../../server/render/channels/README.md#what-pdfjs-dist-is-used-for-here)).
