// @vitest-environment happy-dom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { PdfRuntime } from "./load-pdfjs";
import { MAX_BUSY_ROUNDS } from "./page-schedule";
import {
  PdfController,
  type LoadedPdf,
  type PdfControllerEvents,
} from "./pdf-controller";

// The controller against a pdf.js that is only as much as it asks of it: `load-pdfjs.ts` is replaced by a
// runtime whose documents, pages, renders and text layers the test holds and releases by hand, and
// page-layers.ts (what draws a page) runs for real on top of it, into canvases in happy-dom. Pages are
// letter-sized and the column 600px wide, so a page is about 776px tall and a 1000px window shows two.

interface PdfjsFake {
  loadRuntime(): Promise<unknown>;
  open(runtime: unknown, bytes: Uint8Array): unknown;
}
const world = vi.hoisted(() => ({ current: null as null | PdfjsFake }));
vi.mock("./load-pdfjs", () => ({
  loadPdfjs: () => world.current!.loadRuntime(),
  openPdf: (runtime: unknown, bytes: Uint8Array) =>
    world.current!.open(runtime, bytes),
}));

const COLUMN_WIDTH = 600;
const WINDOW_HEIGHT = 1000;
const LETTER = { width: 612, height: 792 };
/** What a letter page's height is at the column's width. */
const PAGE_HEIGHT = (COLUMN_WIDTH * LETTER.height) / LETTER.width;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** One render the controller asked a page for. */
interface RenderCall {
  /** Which opened document (1 for the first `openPdf`). */
  doc: number;
  /** Zero-based. */
  page: number;
  canvas: HTMLCanvasElement;
  /** Settles it the way pdf.js would: the canvas is drawn. */
  finish: () => void;
  /** pdf.js rejects it for a reason of its own (not because the controller cancelled it). */
  fail: (error: unknown) => void;
  cancelled: boolean;
  done: boolean;
}

class FakeTextLayer {
  render() {
    return Promise.resolve();
  }
  cancel() {}
}

class FakeWorld {
  runtime = {
    pdfjs: { TextLayer: FakeTextLayer },
    worker: {},
  } as unknown as PdfRuntime;
  /** Pages in each document `openPdf` is asked for next (all letter-sized). */
  pagesPerDocument = 3;
  /** Every `openPdf` so far. */
  opened: FakeDocument[] = [];
  /** Every page render, in the order they were asked for. */
  renders: RenderCall[] = [];
  /** When true, a render waits for `finish()`; otherwise it is drawn at once. */
  holdRenders = false;
  /** When true, a document waits for `finish()` (or `fail()`) to load. */
  holdLoads = false;

  loadRuntime() {
    return Promise.resolve(this.runtime);
  }

  open(_runtime: unknown, bytes: Uint8Array) {
    const doc = new FakeDocument(this, this.opened.length + 1, bytes);
    this.opened.push(doc);
    if (!this.holdLoads) doc.finish();
    return { task: doc.task, loaded: doc.loaded.promise };
  }

  /** The renders still waiting, for one document. */
  waiting(doc?: number) {
    return this.renders.filter(
      (r) => !r.done && !r.cancelled && (doc === undefined || r.doc === doc),
    );
  }
}

class FakeDocument {
  readonly loaded = deferred<{
    numPages: number;
    getPage: (n: number) => Promise<FakePage>;
  }>();
  readonly task = { destroy: vi.fn(() => Promise.resolve()) };

  constructor(
    readonly world: FakeWorld,
    readonly id: number,
    readonly bytes: Uint8Array,
  ) {}

  get destroyed() {
    return this.task.destroy.mock.calls.length > 0;
  }

  finish() {
    const numPages = this.world.pagesPerDocument;
    this.loaded.resolve({
      numPages,
      getPage: async (n) => new FakePage(this.world, this.id, n - 1),
    });
  }

  fail(error: unknown) {
    this.loaded.reject(error);
  }
}

class FakePage {
  constructor(
    readonly world: FakeWorld,
    readonly doc: number,
    readonly index: number,
  ) {}

  getViewport({ scale }: { scale: number }) {
    return {
      width: LETTER.width * scale,
      height: LETTER.height * scale,
      userUnit: 1,
    };
  }

  render({ canvas }: { canvas: HTMLCanvasElement }) {
    const done = deferred();
    const call: RenderCall = {
      doc: this.doc,
      page: this.index,
      canvas,
      cancelled: false,
      done: false,
      finish: () => {
        call.done = true;
        done.resolve();
      },
      fail: (error) => {
        call.done = true;
        done.reject(error);
      },
    };
    this.world.renders.push(call);
    if (!this.world.holdRenders) call.finish();
    return {
      promise: done.promise,
      cancel: () => {
        call.cancelled = true;
        done.reject(new Error("rendering cancelled"));
      },
    };
  }

  streamTextContent() {
    return {};
  }
}

class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(
    private readonly callback: (
      entries: { target: Element; isIntersecting: boolean }[],
    ) => void,
    readonly options: { rootMargin?: string },
  ) {
    FakeIntersectionObserver.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  /** What the browser does when `el` crosses this observer's margin. */
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting }]);
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** The observer the controller asked to watch within one viewport of the visible area, and the one for 2.5. */
const nearObserver = () =>
  FakeIntersectionObserver.all.findLast(
    (o) => o.options.rootMargin === "100% 0px",
  )!;
const keepObserver = () =>
  FakeIntersectionObserver.all.findLast(
    (o) => o.options.rootMargin === "250% 0px",
  )!;

let fake: FakeWorld;
let idle: (null | (() => void))[];
let column: HTMLElement;
let events: {
  ready: Mock<PdfControllerEvents["ready"]>;
  failed: Mock<PdfControllerEvents["failed"]>;
  busy: Mock<PdfControllerEvents["busy"]>;
};
let controller: PdfController;
let shown: Mock<(doc: LoadedPdf) => void>;

beforeEach(() => {
  fake = new FakeWorld();
  world.current = fake;
  FakeIntersectionObserver.all = [];
  idle = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("innerHeight", WINDOW_HEIGHT);
  // Idle time comes when the test says so.
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => {
    idle[id - 1] = null;
  });
  vi.stubGlobal("matchMedia", () => ({
    addEventListener() {},
    removeEventListener() {},
  }));

  column = document.createElement("div");
  Object.defineProperty(column, "clientWidth", {
    value: COLUMN_WIDTH,
    configurable: true,
  });
  const scroller = document.createElement("div");
  scroller.append(column);
  document.body.append(scroller);

  events = { ready: vi.fn(), failed: vi.fn(), busy: vi.fn() };
  controller = new PdfController(events);
  shown = vi.fn();
  controller.onShown(shown);
  controller.attach(column);
});

afterEach(() => {
  controller.detach();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  world.current = null;
});

/** Lets every promise the controller is waiting on settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Idle time arrives: runs the callbacks asked for so far, once each. */
async function runIdle() {
  const callbacks = idle.splice(0);
  for (const callback of callbacks) callback?.();
  await settle();
}

/**
 * What the viewer does once `ready` has fired: renders a box per page, in the column, each laid out
 * `PAGE_HEIGHT` tall one under the other, and registers each with the controller.
 */
function mountSlots(count: number): HTMLElement[] {
  return Array.from({ length: count }, (_, index) => {
    const el = document.createElement("div");
    const top = index * PAGE_HEIGHT;
    el.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + PAGE_HEIGHT,
        left: 0,
        right: COLUMN_WIDTH,
      }) as DOMRect;
    column.append(el);
    controller.register(index, el);
    return el;
  });
}

const canvasesIn = (el: HTMLElement) => [...el.querySelectorAll("canvas")];
const hasText = (el: HTMLElement) => el.querySelector(".endOfContent") !== null;
const isReleased = (canvas: HTMLCanvasElement) =>
  canvas.width === 0 && canvas.height === 0 && !canvas.isConnected;

/** Loads a document through to `ready`, mounts its slots and adopts it, as the viewer does. */
async function show(bytes = new Uint8Array([1, 2, 3])) {
  controller.load(bytes);
  await settle();
  const doc = events.ready.mock.lastCall![0];
  const slots = mountSlots(doc.numPages);
  controller.adopt(doc);
  return { doc, slots };
}

describe("PdfController.load: a document is drawn before it is shown", () => {
  it("says it is busy, reads every page's size, and draws only the pages that will be on screen", async () => {
    controller.load(new Uint8Array([1, 2, 3]));
    expect(events.busy).toHaveBeenCalledExactlyOnceWith(true);
    await settle();

    expect(events.ready).toHaveBeenCalledTimes(1);
    const doc = events.ready.mock.lastCall![0];
    expect(doc.generation).toBe(1);
    expect(doc.numPages).toBe(3);
    expect(doc.sizes).toEqual([
      { ...LETTER, userUnit: 1 },
      { ...LETTER, userUnit: 1 },
      { ...LETTER, userUnit: 1 },
    ]);
    // A 1000px window shows the first page and the top of the second (776px tall); the third is below it.
    expect(fake.renders.map((r) => r.page)).toEqual([0, 1]);
    // Still busy: nothing is on screen until `adopt`.
    expect(events.busy).toHaveBeenCalledTimes(1);
    expect(shown).not.toHaveBeenCalled();
  });

  it("draws each canvas at the column's width in device pixels", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    controller.detach();
    controller.attach(column);
    controller.load(new Uint8Array([1]));
    await settle();
    expect(fake.renders[0].canvas.width).toBe(2 * COLUMN_WIDTH);
  });

  it("passes pdf.js a copy of the bytes: it transfers the one it is given, and Download needs the original", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    controller.load(bytes);
    await settle();
    expect(fake.opened[0].bytes).not.toBe(bytes);
    expect(fake.opened[0].bytes).toEqual(bytes);
  });

  it("draws nothing before the swap until the column has a width (it is hidden)", async () => {
    controller.detach();
    Object.defineProperty(column, "clientWidth", {
      value: 0,
      configurable: true,
    });
    controller.attach(column);
    controller.load(new Uint8Array([1]));
    await settle();
    expect(events.ready).toHaveBeenCalledTimes(1);
    expect(fake.renders).toEqual([]);
  });

  it("reports nothing for a document that is still loading", async () => {
    fake.holdLoads = true;
    controller.load(new Uint8Array([1]));
    await settle();
    expect(events.ready).not.toHaveBeenCalled();
    expect(events.busy).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("PdfController.adopt: the swap", () => {
  it("puts the drawn pages into their slots, and says it has shown the document", async () => {
    const { doc, slots } = await show();
    expect(slots.map((el) => canvasesIn(el).length)).toEqual([1, 1, 0]);
    expect(slots.map(hasText)).toEqual([true, true, false]);
    // The canvas is the first thing in its slot, under the text layer.
    expect(slots[0].firstElementChild).toBe(fake.renders[0].canvas);
    expect(events.busy).toHaveBeenLastCalledWith(false);
    expect(shown).toHaveBeenCalledExactlyOnceWith(doc);
  });

  it("ignores a document that a later load has replaced, even once that one is ready", async () => {
    controller.load(new Uint8Array([1]));
    await settle();
    const first = events.ready.mock.lastCall![0];
    const slots = mountSlots(first.numPages);
    controller.load(new Uint8Array([2])); // supersedes it before it was adopted
    controller.adopt(first);
    expect(shown).not.toHaveBeenCalled();
    expect(slots.flatMap(canvasesIn)).toEqual([]);
    expect(events.busy).not.toHaveBeenCalledWith(false);

    await settle();
    const second = events.ready.mock.lastCall![0];
    expect(second).not.toBe(first);
    controller.adopt(first); // the viewer's layout effect for the stale document runs late
    expect(shown).not.toHaveBeenCalled();
    expect(slots.flatMap(canvasesIn)).toEqual([]);

    controller.adopt(second);
    expect(shown).toHaveBeenCalledExactlyOnceWith(second);
    expect(canvasesIn(slots[0])).toHaveLength(1);
  });

  it("ignores a document that has not finished loading", async () => {
    fake.holdLoads = true;
    controller.load(new Uint8Array([1]));
    await settle();
    // What the viewer would hold if `ready` had fired: nothing yet, so a made-up document can't be adopted.
    controller.adopt({ generation: 1, numPages: 3, sizes: [] });
    expect(shown).not.toHaveBeenCalled();
  });

  it("adopts a document once", async () => {
    const { doc } = await show();
    controller.adopt(doc);
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it("releases the canvases drawn for pages that have no slot", async () => {
    controller.load(new Uint8Array([1]));
    await settle();
    const doc = events.ready.mock.lastCall![0];
    const [only] = mountSlots(1); // the viewer rendered one slot of three
    controller.adopt(doc);
    expect(canvasesIn(only)).toHaveLength(1);
    expect(isReleased(fake.renders[1].canvas)).toBe(true);
  });

  it("destroys the document it replaces, and the new one stays", async () => {
    await show();
    controller.load(new Uint8Array([2]));
    await settle();
    expect(fake.opened[0].destroyed).toBe(false); // still on screen while the next is drawn
    controller.adopt(events.ready.mock.lastCall![0]);
    expect(fake.opened[0].destroyed).toBe(true);
    expect(fake.opened[1].destroyed).toBe(false);
  });

  it("replaces a slot's canvas with the new document's and frees the old one", async () => {
    const { slots } = await show();
    const oldCanvas = canvasesIn(slots[0])[0];
    controller.load(new Uint8Array([2]));
    await settle();
    const doc = events.ready.mock.lastCall![0];
    controller.adopt(doc);
    const [now] = canvasesIn(slots[0]);
    expect(now).not.toBe(oldCanvas);
    expect(isReleased(oldCanvas)).toBe(true);
    expect(canvasesIn(slots[0])).toHaveLength(1);
  });

  it("keeps an old page's pixels where the new document drew nothing, until its own render lands", async () => {
    const { slots } = await show();
    // Page 2 scrolls near: it is drawn from the first document.
    nearObserver().report(slots[2], true);
    await settle();
    const [first] = canvasesIn(slots[2]);
    expect(first).toBeDefined();

    controller.load(new Uint8Array([2]));
    await settle();
    controller.adopt(events.ready.mock.lastCall![0]);
    // The second document drew only pages 0 and 1 before the swap: page 2 still shows the first document's.
    expect(canvasesIn(slots[2])).toEqual([first]);
    expect(isReleased(first)).toBe(false);

    // Page 2 is near, so the second document renders it, and its canvas replaces the old one.
    await settle();
    const [replaced] = canvasesIn(slots[2]);
    expect(replaced).toBeDefined();
    expect(replaced).not.toBe(first);
    expect(isReleased(first)).toBe(true);
  });

  it("builds the text layers of the pages nobody has scrolled to, one idle period at a time", async () => {
    const { slots } = await show();
    expect(hasText(slots[2])).toBe(false);
    await runIdle();
    expect(hasText(slots[2])).toBe(true);
  });

  it("gives up filling text when the only pages missing it keep being busy", async () => {
    const { slots } = await show();
    // Page 2's own render is held in flight, so the fill finds it busy every round.
    fake.holdRenders = true;
    nearObserver().report(slots[2], true);
    await settle();
    expect(fake.waiting().some((r) => r.page === 2)).toBe(true);
    let requests = 0;
    for (let round = 0; round < MAX_BUSY_ROUNDS + 5; round++) {
      requests += idle.filter(Boolean).length;
      await runIdle();
    }
    expect(requests).toBe(MAX_BUSY_ROUNDS);
    expect(hasText(slots[2])).toBe(false);
  });
});

describe("PdfController.load: a newer load supersedes the one before", () => {
  it("destroys the superseded document's task, and never reports it", async () => {
    fake.holdLoads = true;
    controller.load(new Uint8Array([1]));
    await settle();
    expect(fake.opened).toHaveLength(1);

    controller.load(new Uint8Array([2]));
    expect(fake.opened[0].destroyed).toBe(true);
    fake.opened[0].finish(); // too late: it is ignored
    await settle();
    expect(events.ready).not.toHaveBeenCalled();

    fake.opened[1].finish();
    await settle();
    expect(events.ready).toHaveBeenCalledTimes(1);
    expect(events.ready.mock.lastCall![0].generation).toBe(2);
    expect(events.failed).not.toHaveBeenCalled();
  });

  it("stays busy through both, and is not busy again until the new one is shown", async () => {
    fake.holdLoads = true;
    controller.load(new Uint8Array([1]));
    controller.load(new Uint8Array([2]));
    await settle();
    expect(events.busy.mock.calls).toEqual([[true], [true]]);
  });

  it("cancels the renders of a superseded document and frees what it had drawn", async () => {
    fake.holdRenders = true;
    controller.load(new Uint8Array([1]));
    await settle();
    expect(fake.waiting(1).map((r) => r.page)).toEqual([0, 1]);

    controller.load(new Uint8Array([2]));
    expect(
      fake.renders.filter((r) => r.doc === 1).every((r) => r.cancelled),
    ).toBe(true);
    await settle();
    expect(
      fake.renders
        .filter((r) => r.doc === 1)
        .every((r) => isReleased(r.canvas)),
    ).toBe(true);
    expect(events.failed).not.toHaveBeenCalled();
    expect(events.ready).not.toHaveBeenCalled();
  });

  it("frees the canvases of a document that was ready but never adopted", async () => {
    controller.load(new Uint8Array([1]));
    await settle();
    const drawn = fake.renders.map((r) => r.canvas);
    expect(drawn).toHaveLength(2);
    expect(drawn.some(isReleased)).toBe(false);
    controller.load(new Uint8Array([2]));
    expect(drawn.every(isReleased)).toBe(true);
  });

  it("numbers each load: a later document has a later generation", async () => {
    await show();
    controller.load(new Uint8Array([2]));
    await settle();
    const generations = events.ready.mock.calls.map(([doc]) => doc.generation);
    expect(generations).toEqual([1, 2]);
  });
});

describe("PdfController: failures and clearing", () => {
  it("shows the fallback when the bytes can't be opened, and lets go of what it was showing", async () => {
    await show();
    const error = new Error("not a PDF");
    fake.holdLoads = true;
    controller.load(new Uint8Array([2]));
    await settle();
    fake.opened[1].fail(error);
    await settle();
    expect(events.failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(events.busy).toHaveBeenLastCalledWith(false);
    expect(fake.opened[0].destroyed).toBe(true);
  });

  it("doesn't report the failure of a document that was superseded", async () => {
    fake.holdLoads = true;
    controller.load(new Uint8Array([1]));
    await settle();
    controller.load(new Uint8Array([2]));
    fake.opened[0].fail(new Error("worker died"));
    await settle();
    expect(events.failed).not.toHaveBeenCalled();
  });

  it("shows the fallback when drawing a page fails, and lets go of the document", async () => {
    const { slots } = await show();
    fake.holdRenders = true;
    nearObserver().report(slots[2], true);
    await settle();
    const error = new Error("render failed");
    fake
      .waiting()
      .find((r) => r.page === 2)!
      .fail(error);
    await settle();
    expect(events.failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(events.busy).toHaveBeenLastCalledWith(false);
    expect(fake.opened[0].destroyed).toBe(true);
  });

  it("clear() lets go of the document, stops being busy and ignores one still loading", async () => {
    const { slots } = await show();
    const canvases = slots.flatMap(canvasesIn);
    expect(canvases.length).toBeGreaterThan(0);
    fake.holdLoads = true;
    controller.load(new Uint8Array([2]));
    await settle();
    controller.clear();
    expect(fake.opened[0].destroyed).toBe(true);
    expect(fake.opened[1].destroyed).toBe(true);
    expect(events.busy).toHaveBeenLastCalledWith(false);
    fake.opened[1].finish();
    await settle();
    expect(events.ready).toHaveBeenCalledTimes(1); // only the first document's
    // The viewer shows its skeleton instead of the slots, and each slot frees its canvas as it goes.
    slots.forEach((_, index) => controller.register(index, null));
    expect(canvases.every(isReleased)).toBe(true);
  });

  it("detach() stops everything, frees the document, and can be attached again", async () => {
    const { slots } = await show();
    const before = nearObserver();
    expect(before.observed.size).toBe(slots.length);
    controller.detach();
    expect(fake.opened[0].destroyed).toBe(true);
    expect(before.observed.size).toBe(0);
    // Attached again, it watches the slots that are still registered.
    controller.attach(column);
    expect([...nearObserver().observed]).toEqual(slots);
  });
});

describe("PdfController: which pages hold a canvas", () => {
  it("renders a slot that comes near the viewport, and not one that is already drawn", async () => {
    const { slots } = await show();
    const drawn = fake.renders.length;
    nearObserver().report(slots[0], true); // page 0 was drawn for the swap
    await settle();
    expect(fake.renders).toHaveLength(drawn);
    nearObserver().report(slots[2], true);
    await settle();
    expect(fake.renders).toHaveLength(drawn + 1);
    expect(fake.renders.at(-1)!.page).toBe(2);
  });

  it("releases a slot's canvas when it is far from the viewport, but keeps its text", async () => {
    const { slots } = await show();
    const [canvas] = canvasesIn(slots[0]);
    keepObserver().report(slots[0], false);
    expect(isReleased(canvas)).toBe(true);
    expect(canvasesIn(slots[0])).toHaveLength(0);
    expect(hasText(slots[0])).toBe(true);
  });

  it("keeps a canvas while its slot is within the keep margin", async () => {
    const { slots } = await show();
    keepObserver().report(slots[0], true);
    expect(canvasesIn(slots[0])).toHaveLength(1);
  });

  it("starts at most two renders at a time, nearest the middle of the window first", async () => {
    // A 6-page document: pages 0 and 1 are drawn for the swap, the rest are drawn as they come near.
    fake.pagesPerDocument = 6;
    const { slots } = await show();
    fake.holdRenders = true;
    const before = fake.renders.length;
    // They come near in this order; the first two start at once, and the others queue.
    for (const index of [5, 4, 3, 2]) nearObserver().report(slots[index], true);
    await settle();
    const started = () => fake.renders.slice(before).map((r) => r.page);
    expect(started()).toEqual([5, 4]);

    // One finishes: of those waiting (3 and 2), page 2 is the one nearest the middle of the window.
    fake
      .waiting()
      .find((r) => r.page === 5)!
      .finish();
    await settle();
    expect(started()).toEqual([5, 4, 2]);
    fake
      .waiting()
      .find((r) => r.page === 4)!
      .finish();
    await settle();
    expect(started()).toEqual([5, 4, 2, 3]);
  });

  it("drops a queued page that leaves the viewport before it starts", async () => {
    fake.pagesPerDocument = 6;
    const { slots } = await show();
    fake.holdRenders = true;
    const before = fake.renders.length;
    for (const index of [5, 4, 3]) nearObserver().report(slots[index], true);
    nearObserver().report(slots[3], false); // page 3 is queued behind 5 and 4: no longer worth drawing
    await settle();
    fake
      .waiting()
      .find((r) => r.page === 5)!
      .finish();
    fake
      .waiting()
      .find((r) => r.page === 4)!
      .finish();
    await settle();
    expect(fake.renders.slice(before).map((r) => r.page)).toEqual([5, 4]);
  });

  it("cancels a render in flight when its slot goes away", async () => {
    const { slots } = await show();
    fake.holdRenders = true;
    nearObserver().report(slots[2], true);
    await settle();
    const [call] = fake.waiting().filter((r) => r.page === 2);
    controller.register(2, null);
    expect(call.cancelled).toBe(true);
    await settle();
    expect(events.failed).not.toHaveBeenCalled();
  });
});
