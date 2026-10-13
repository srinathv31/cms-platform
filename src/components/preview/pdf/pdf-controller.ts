// The PDF viewer's imperative core: loading, the double-buffered swap, and which pages hold a canvas.
// React renders the page slots (sized boxes with their labels); this class fills them.
//
// Loading. Each `load(bytes)` supersedes the one before: its task is destroyed and its renders
// cancelled. A document that loads is not shown straight away. Its pages' sizes are read, the pages
// that will be on screen are drawn into detached canvases, and only then does the viewer render the
// new slots and call `adopt()`, which swaps those canvases in before the browser paints. Until then
// the previous document stays on screen, so a re-render never shows a blank frame and never moves the
// scroll position.
//
// Virtualization. Two IntersectionObservers on the scroll root (the nearest scrolling ancestor): a
// page within one viewport of the visible area gets a canvas; a page more than 2.5 viewports away
// loses it. Canvases render through a small queue, nearest the viewport first, two at a time. Text
// layers are kept once built (they are light), and the pages nobody has scrolled to get theirs in idle
// time, so the whole document is there for screen readers and find in page.
//
// The decisions (which pages would be on screen, which queued page goes next, when a page is out of date)
// are pure functions in page-schedule.ts; this class measures the page, asks them, and acts.

import type { PDFPageProxy } from "pdfjs-dist";
import {
  loadPdfjs,
  openPdf,
  type OpenedPdf,
  type PdfRuntime,
} from "./load-pdfjs";
import {
  drawCanvas,
  drawTextLayer,
  pageSize,
  releaseCanvas,
  SELECTING_CLASS,
  TEXT_LAYER_CLASS,
  type PageSize,
} from "./page-layers";
import {
  canvasKey,
  canvasPixelWidth,
  firstFreeForText,
  lacks,
  MAX_BUSY_ROUNDS,
  nearestToMiddle,
  needsRender,
  pagesInBand,
  slotsMissingText,
  type SlotFacts,
} from "./page-schedule";

/** A loaded document, ready to be shown. */
export interface LoadedPdf {
  readonly generation: number;
  readonly numPages: number;
  readonly sizes: readonly PageSize[];
}

interface Loaded extends LoadedPdf {
  readonly runtime: PdfRuntime;
  readonly opened: OpenedPdf;
  readonly pages: readonly PDFPageProxy[];
  /** The pages drawn before the swap, by index. Emptied by `adopt()`. */
  readonly prepared: Map<number, Prepared>;
}

interface Prepared {
  canvas: HTMLCanvasElement;
  pixelWidth: number;
  text: HTMLDivElement | null;
}

export interface PdfControllerEvents {
  /** A document is loaded and its visible pages are drawn: render its slots, then call `adopt()`. */
  ready(doc: LoadedPdf): void;
  /** Loading or rendering failed: show the fallback. */
  failed(error: unknown): void;
  /** True while a document is loading or being prepared. */
  busy(busy: boolean): void;
}

/** Renders a page when it comes within this distance of the visible area… */
const NEAR_MARGIN = "100% 0px";
/** …and releases its canvas once it is further than this. */
const KEEP_MARGIN = "250% 0px";
const MAX_CONCURRENT_RENDERS = 2;
/** Resizes settle for this long before the pages re-render at the new width. */
const RESIZE_DEBOUNCE_MS = 150;

class PageSlot implements SlotFacts {
  canvas: HTMLCanvasElement | null = null;
  /** The `canvasKey` of the canvas on screen. */
  canvasKey = "";
  text: HTMLDivElement | null = null;
  textGeneration = -1;
  job: { key: string; abort: AbortController } | null = null;

  constructor(
    readonly index: number,
    readonly el: HTMLElement,
  ) {}

  get jobKey() {
    return this.job?.key ?? null;
  }

  showCanvas(canvas: HTMLCanvasElement, key: string) {
    if (this.canvas) {
      this.canvas.replaceWith(canvas);
      releaseCanvas(this.canvas);
    } else {
      this.el.prepend(canvas);
    }
    this.canvas = canvas;
    this.canvasKey = key;
  }

  showText(text: HTMLDivElement, generation: number) {
    if (this.text) this.text.replaceWith(text);
    else this.el.append(text);
    this.text = text;
    this.textGeneration = generation;
  }

  releaseCanvas() {
    if (this.canvas) releaseCanvas(this.canvas);
    this.canvas = null;
    this.canvasKey = "";
  }

  clear() {
    this.releaseCanvas();
    this.text?.remove();
    this.text = null;
    this.textGeneration = -1;
  }
}

export class PdfController {
  private readonly events: PdfControllerEvents;

  private column: HTMLElement | null = null;
  private scrollRoot: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private nearObserver: IntersectionObserver | null = null;
  private keepObserver: IntersectionObserver | null = null;
  private teardown: (() => void)[] = [];

  private readonly slots = new Map<number, PageSlot>();
  private readonly slotsByElement = new Map<Element, PageSlot>();
  private readonly near = new Set<number>();
  private readonly queue = new Set<PageSlot>();
  private running = 0;

  /** The CSS width of a page right now, and the width pages render at (debounced). */
  private liveWidth = 0;
  private renderWidth = 0;
  private resizeTimer: number | undefined;

  private generation = 0;
  private current: Loaded | null = null;
  private incoming: {
    generation: number;
    abort: AbortController;
    loaded: Loaded | null;
  } | null = null;
  private textFill: AbortController | null = null;
  private shownListener: ((doc: LoadedPdf) => void) | null = null;

  constructor(events: PdfControllerEvents) {
    this.events = events;
  }

  /** Called each time an adopted document is on screen. */
  onShown(listener: ((doc: LoadedPdf) => void) | null) {
    this.shownListener = listener;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Starts measuring and observing. `column` is the element the pages fill, edge to edge. */
  attach(column: HTMLElement) {
    this.column = column;
    this.scrollRoot = findScrollRoot(column);

    this.setLiveWidth(contentWidth(column));
    this.renderWidth = this.liveWidth;
    this.resizeObserver = new ResizeObserver(([entry]) => {
      const width =
        entry?.contentBoxSize[0]?.inlineSize ?? entry?.contentRect.width ?? 0;
      // Zero means hidden (display: none, e.g. a route kept mounted in the background): keep what we have.
      if (width < 1 || width === this.liveWidth) return;
      this.setLiveWidth(width);
      window.clearTimeout(this.resizeTimer);
      if (this.renderWidth < 1) this.applyRenderWidth();
      else
        this.resizeTimer = window.setTimeout(
          () => this.applyRenderWidth(),
          RESIZE_DEBOUNCE_MS,
        );
    });
    this.resizeObserver.observe(column);

    this.nearObserver = new IntersectionObserver(
      (entries) => this.onNear(entries),
      {
        root: this.scrollRoot,
        rootMargin: NEAR_MARGIN,
      },
    );
    this.keepObserver = new IntersectionObserver(
      (entries) => this.onKeep(entries),
      {
        root: this.scrollRoot,
        rootMargin: KEEP_MARGIN,
      },
    );
    for (const slot of this.slots.values()) this.observe(slot);

    this.watchPixelRatio();
    this.watchSelection(column);
  }

  /** Stops everything and frees the documents. The controller can be attached again. */
  detach() {
    window.clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.nearObserver?.disconnect();
    this.keepObserver?.disconnect();
    this.resizeObserver = this.nearObserver = this.keepObserver = null;
    for (const undo of this.teardown.splice(0)) undo();
    this.cancelIncoming();
    this.stopTextFill();
    for (const slot of this.slots.values()) this.cancelJob(slot);
    this.near.clear();
    this.destroyCurrent();
    this.column = null;
  }

  // ── Documents ───────────────────────────────────────────────────────────

  /** Loads new bytes. The document on screen stays until the new one is drawn. */
  load(data: Uint8Array) {
    this.cancelIncoming();
    const generation = ++this.generation;
    const abort = new AbortController();
    const incoming = { generation, abort, loaded: null as Loaded | null };
    this.incoming = incoming;
    this.events.busy(true);

    // pdf.js transfers the buffer it is given to the worker; the caller keeps `data` for Download.
    const bytes = data.slice();
    this.prepare(generation, bytes, abort.signal).then(
      (loaded) => {
        if (abort.signal.aborted) return;
        incoming.loaded = loaded;
        this.events.ready(loaded);
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        this.fail(error);
      },
    );
  }

  /** No document (the viewer shows its skeleton). */
  clear() {
    this.generation++;
    this.cancelIncoming();
    this.stopTextFill();
    this.destroyCurrent();
    this.events.busy(false);
  }

  /**
   * Makes `doc` the document on screen. Call it from a layout effect once the slots for `doc` are
   * rendered: the drawn pages go in before the browser paints, so the swap is a single frame.
   */
  adopt(doc: LoadedPdf) {
    const loaded = this.incoming?.loaded;
    if (!loaded || loaded !== doc) return;
    const previous = this.current;
    this.current = loaded;
    this.incoming = null;
    this.stopTextFill();

    for (const slot of this.slots.values()) {
      this.cancelJob(slot);
      const prepared = loaded.prepared.get(slot.index);
      if (!prepared) continue; // keeps the old page's pixels until its own render lands
      loaded.prepared.delete(slot.index);
      slot.showCanvas(
        prepared.canvas,
        canvasKey(loaded.generation, prepared.pixelWidth),
      );
      if (prepared.text) slot.showText(prepared.text, loaded.generation);
    }
    for (const leftover of loaded.prepared.values())
      releaseCanvas(leftover.canvas);
    loaded.prepared.clear();

    if (previous) destroyTask(previous.opened);
    for (const index of this.near) this.schedule(this.slots.get(index));
    this.startTextFill(loaded);
    this.events.busy(false);
    this.shownListener?.(loaded);
  }

  private async prepare(
    generation: number,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<Loaded> {
    const runtime = await loadPdfjs();
    signal.throwIfAborted();
    const opened = openPdf(runtime, bytes);
    signal.addEventListener("abort", () => destroyTask(opened), { once: true });

    const doc = await opened.loaded;
    signal.throwIfAborted();
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
    );
    signal.throwIfAborted();
    const sizes = pages.map(pageSize);
    const loaded: Loaded = {
      generation,
      numPages: doc.numPages,
      sizes,
      runtime,
      opened,
      pages,
      prepared: new Map(),
    };

    const width = this.renderWidth;
    if (width >= 1) {
      const pixelWidth = this.pixelWidth();
      const drawn = await Promise.all(
        this.visibleIndices(sizes, width).map(
          async (index): Promise<[number, Prepared]> => {
            const page = pages[index];
            const [canvas, text] = await Promise.all([
              drawCanvas(page, sizes[index], pixelWidth, signal),
              drawTextLayer(runtime.pdfjs, page, signal),
            ]);
            return [index, { canvas, pixelWidth, text }];
          },
        ),
      );
      for (const [index, prepared] of drawn)
        loaded.prepared.set(index, prepared);
    }
    return loaded;
  }

  private cancelIncoming() {
    const incoming = this.incoming;
    if (!incoming) return;
    this.incoming = null;
    incoming.abort.abort();
    for (const prepared of incoming.loaded?.prepared.values() ?? [])
      releaseCanvas(prepared.canvas);
  }

  private destroyCurrent() {
    const current = this.current;
    this.current = null;
    if (current) destroyTask(current.opened);
  }

  private fail(error: unknown) {
    this.generation++;
    this.cancelIncoming();
    this.stopTextFill();
    for (const slot of this.slots.values()) this.cancelJob(slot);
    this.destroyCurrent();
    this.events.busy(false);
    this.events.failed(error);
  }

  // ── Slots ───────────────────────────────────────────────────────────────

  /** Called by each page slot's ref: `el` when it mounts, null when it unmounts. */
  register(index: number, el: HTMLElement | null) {
    const existing = this.slots.get(index);
    if (existing) {
      this.cancelJob(existing);
      existing.clear();
      this.nearObserver?.unobserve(existing.el);
      this.keepObserver?.unobserve(existing.el);
      this.slots.delete(index);
      this.slotsByElement.delete(existing.el);
      this.near.delete(index);
    }
    if (!el) return;
    const slot = new PageSlot(index, el);
    this.slots.set(index, slot);
    this.slotsByElement.set(el, slot);
    this.observe(slot);
  }

  private observe(slot: PageSlot) {
    this.nearObserver?.observe(slot.el);
    this.keepObserver?.observe(slot.el);
  }

  private onNear(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const slot = this.slotsByElement.get(entry.target);
      if (!slot) continue;
      if (entry.isIntersecting) {
        this.near.add(slot.index);
        this.schedule(slot);
      } else {
        this.near.delete(slot.index);
        this.queue.delete(slot); // not started yet: no longer worth it
      }
    }
  }

  private onKeep(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const slot = this.slotsByElement.get(entry.target);
      if (!slot) continue;
      this.cancelJob(slot);
      slot.releaseCanvas();
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private pixelWidth() {
    return canvasPixelWidth(this.renderWidth, window.devicePixelRatio);
  }

  private schedule(slot: PageSlot | undefined) {
    const doc = this.current;
    if (!slot || !doc) return;
    const key = canvasKey(doc.generation, this.pixelWidth());
    const view = {
      near: this.near.has(slot.index),
      renderWidth: this.renderWidth,
      key,
    };
    if (!needsRender(slot, doc, view)) return;
    this.cancelJob(slot);
    this.queue.add(slot);
    this.pump();
  }

  private cancelJob(slot: PageSlot) {
    this.queue.delete(slot);
    slot.job?.abort.abort();
    slot.job = null;
  }

  private pump() {
    while (this.running < MAX_CONCURRENT_RENDERS && this.queue.size > 0) {
      const slot = this.nextInQueue();
      this.queue.delete(slot);
      void this.run(slot);
    }
  }

  /** The queued page nearest the middle of the visible area. */
  private nextInQueue(): PageSlot {
    const queued = [...this.queue].map((slot) => {
      const { top, bottom } = slot.el.getBoundingClientRect();
      return { item: slot, top, bottom };
    });
    return nearestToMiddle(queued, this.visibleRect()) as PageSlot;
  }

  private async run(slot: PageSlot) {
    const doc = this.current;
    if (!doc) return;
    const pixelWidth = this.pixelWidth();
    const key = canvasKey(doc.generation, pixelWidth);
    const abort = new AbortController();
    slot.job = { key, abort };
    this.running++;
    try {
      const page = doc.pages[slot.index];
      // The text layer is asked about after the canvas is drawn: a render that finished meanwhile may have built it.
      const canvas = lacks(slot, key, doc.generation).canvas
        ? await drawCanvas(
            page,
            doc.sizes[slot.index],
            pixelWidth,
            abort.signal,
          )
        : null;
      const text = lacks(slot, key, doc.generation).text
        ? await drawTextLayer(doc.runtime.pdfjs, page, abort.signal)
        : null;
      if (abort.signal.aborted) {
        if (canvas) releaseCanvas(canvas);
        return;
      }
      if (canvas) slot.showCanvas(canvas, key);
      if (text) slot.showText(text, doc.generation);
    } catch (error) {
      if (!abort.signal.aborted) this.fail(error);
    } finally {
      if (slot.job?.abort === abort) slot.job = null;
      this.running--;
      this.pump();
    }
  }

  /** Builds the text layers of the pages nobody has scrolled to, one per idle period. */
  private startTextFill(doc: Loaded) {
    const abort = new AbortController();
    this.textFill = abort;
    const { signal } = abort;
    const tried = new Set<PageSlot>();
    void (async () => {
      // A page with a render in flight gets its text from that render; if the render is dropped
      // (scrolled past), a later round picks the page up. Rounds that find only busy pages are capped.
      for (
        let busyRounds = 0;
        !signal.aborted && busyRounds < MAX_BUSY_ROUNDS;
      ) {
        const missing = slotsMissingText(this.slots.values(), doc, tried);
        if (missing.length === 0) return;
        await whenIdle(signal);
        if (signal.aborted) return;
        const slot = firstFreeForText(
          missing,
          doc.generation,
          (s) => s.job !== null || this.queue.has(s),
        );
        if (!slot) {
          busyRounds++;
          continue;
        }
        tried.add(slot);
        try {
          const text = await drawTextLayer(
            doc.runtime.pdfjs,
            doc.pages[slot.index],
            signal,
          );
          if (text && !signal.aborted && this.slots.get(slot.index) === slot)
            slot.showText(text, doc.generation);
        } catch {
          if (signal.aborted) return;
        }
      }
    })();
  }

  private stopTextFill() {
    this.textFill?.abort();
    this.textFill = null;
  }

  // ── Geometry ────────────────────────────────────────────────────────────

  private setLiveWidth(width: number) {
    this.liveWidth = width;
    // Unitless, so each page can derive its scale factor in CSS: calc(var(--pdf-px) / page width).
    this.column?.style.setProperty("--pdf-px", String(width));
  }

  private applyRenderWidth() {
    this.renderWidth = this.liveWidth;
    for (const index of this.near) this.schedule(this.slots.get(index));
  }

  /** The part of the viewport where pages can be seen: the scroll root's box, clipped to the window. */
  private visibleRect(): { top: number; bottom: number } {
    const rect = this.scrollRoot?.getBoundingClientRect();
    return {
      top: Math.max(0, rect?.top ?? 0),
      bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight),
    };
  }

  /** The pages of a document with these sizes that would be on screen if it replaced the current one. */
  private visibleIndices(sizes: readonly PageSize[], width: number): number[] {
    const column = this.column;
    if (!column) return [0];
    const style = getComputedStyle(column);
    const gap = parseFloat(style.rowGap) || 0;
    const firstTop =
      column.getBoundingClientRect().top +
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.borderTopWidth) || 0);
    return pagesInBand(sizes, width, { firstTop, gap }, this.visibleRect());
  }

  // ── Environment ─────────────────────────────────────────────────────────

  /** A new devicePixelRatio (a move to another display) re-renders the pages near the viewport. */
  private watchPixelRatio() {
    let query: MediaQueryList | null = null;
    const onChange = () => {
      query?.removeEventListener("change", onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener("change", onChange);
      if (this.current)
        for (const index of this.near) this.schedule(this.slots.get(index));
    };
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", onChange);
    this.teardown.push(() => query?.removeEventListener("change", onChange));
  }

  /** pdf.js's selection aid: mark the text layer being dragged in until the pointer is released. */
  private watchSelection(column: HTMLElement) {
    const start = (event: PointerEvent) => {
      const layer = (event.target as Element | null)?.closest?.(
        `.${TEXT_LAYER_CLASS}`,
      );
      layer?.classList.add(SELECTING_CLASS);
    };
    const end = () => {
      for (const layer of column.querySelectorAll(`.${SELECTING_CLASS}`))
        layer.classList.remove(SELECTING_CLASS);
    };
    column.addEventListener("pointerdown", start);
    document.addEventListener("pointerup", end);
    window.addEventListener("blur", end);
    this.teardown.push(() => {
      column.removeEventListener("pointerdown", start);
      document.removeEventListener("pointerup", end);
      window.removeEventListener("blur", end);
    });
  }
}

/** The nearest ancestor that scrolls vertically, or null when the document itself scrolls. */
export function findScrollRoot(el: HTMLElement): HTMLElement | null {
  for (
    let node = el.parentElement;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    )
      return node;
  }
  return null;
}

/** Destroying a task whose load failed rejects; that failure was already handled. */
function destroyTask({ task }: OpenedPdf) {
  task.destroy().catch(() => {});
}

function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return (
    el.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0)
  );
}

function whenIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const id = window.requestIdleCallback(
      () => {
        signal.removeEventListener("abort", stop);
        resolve();
      },
      { timeout: 2000 },
    );
    const stop = () => {
      window.cancelIdleCallback(id);
      resolve();
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
