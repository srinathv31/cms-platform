// Drawing one page: the canvas (what the page looks like) and the text layer (what it says, for
// selection, copy, find in page and screen readers). Both are built detached and handed back, so
// the caller decides when they replace what is on screen.

import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfJs } from "./load-pdfjs";
import styles from "./pdf-viewer.module.css";

/** A page's size at scale 1, in PDF units (rotation and UserUnit applied), as `getViewport` gives it. */
export interface PageSize {
  width: number;
  height: number;
  userUnit: number;
}

export function pageSize(page: PDFPageProxy): PageSize {
  const { width, height, userUnit } = page.getViewport({ scale: 1 });
  return { width, height, userUnit };
}

/** A canvas never holds more pixels than this (2^24, about a 4K by 4K page); CSS scales the rest. */
const MAX_CANVAS_PIXELS = 2 ** 24;

/**
 * Renders the page into a new canvas `pixelWidth` device pixels wide (the page's CSS width times
 * devicePixelRatio, so it is crisp). Aborting cancels the render and rejects.
 */
export async function drawCanvas(
  page: PDFPageProxy,
  size: PageSize,
  pixelWidth: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement> {
  signal.throwIfAborted();
  const scale = Math.min(pixelWidth / size.width, Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.className = styles.canvas;
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  const task = page.render({ canvas, viewport });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  return canvas;
}

/** Frees a canvas's backing store now rather than at garbage collection. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

/**
 * Builds the page's text layer: transparent, absolutely placed runs over the canvas. It is laid out
 * in units of the page's --scale-factor, so it never needs redrawing for a new width. Resolves null
 * if the text can't be extracted: the canvas is still the exact page, so that isn't a failure.
 */
export async function drawTextLayer(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  signal: AbortSignal,
): Promise<HTMLDivElement | null> {
  signal.throwIfAborted();
  const container = document.createElement("div");
  container.className = styles.textLayer;
  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true }),
    container,
    viewport: page.getViewport({ scale: 1 }),
  });
  const cancel = () => layer.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await layer.render();
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  const end = document.createElement("div");
  end.className = "endOfContent";
  container.append(end);
  return container;
}

/** The text layer class, toggled while a selection is being dragged (see the CSS). */
export const SELECTING_CLASS = styles.selecting;
export const TEXT_LAYER_CLASS = styles.textLayer;
