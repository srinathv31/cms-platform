import { describe, expect, it } from "vitest";
import type { PageSize } from "./page-layers";
import {
  canvasKey,
  canvasPixelWidth,
  firstFreeForText,
  lacks,
  MAX_PREPARED_PAGES,
  nearestToMiddle,
  needsRender,
  pagesInBand,
  slotsMissingText,
  type Placed,
  type SlotFacts,
} from "./page-schedule";

const LETTER: PageSize = { width: 612, height: 792, userUnit: 1 };
const LANDSCAPE: PageSize = { width: 792, height: 612, userUnit: 1 };
const pages = (count: number, size = LETTER) =>
  Array.from({ length: count }, () => size);

describe("pagesInBand: the pages of a new document that would be on screen", () => {
  const band = { top: 0, bottom: 1000 };

  it("takes the pages that start above the bottom edge, from the first", () => {
    // 612 wide keeps each page 792 tall: page 0 is 0-792, page 1 is 792-1584, page 2 would start at 1584.
    expect(pagesInBand(pages(5), 612, { firstTop: 0, gap: 0 }, band)).toEqual([
      0, 1,
    ]);
  });

  it("scales the heights with the width", () => {
    // Half as wide, half as tall: pages are 396 tall, so three start above 1000 (0, 396, 792) and a fourth at 1188 doesn't.
    expect(pagesInBand(pages(5), 306, { firstTop: 0, gap: 0 }, band)).toEqual([
      0, 1, 2,
    ]);
  });

  it("counts the gap between pages", () => {
    // Page 0 ends at 792: with a 300px gap the next starts at 1092, below the band; with 100px, at 892.
    expect(pagesInBand(pages(5), 612, { firstTop: 0, gap: 300 }, band)).toEqual(
      [0],
    );
    expect(pagesInBand(pages(5), 612, { firstTop: 0, gap: 100 }, band)).toEqual(
      [0, 1],
    );
  });

  it("skips pages that end above the top edge (the document is scrolled)", () => {
    // Page 0 is -2000..-1208, 1 is -1208..-416, 2 is -416..376, 3 is 376..1168, 4 starts at 1168.
    expect(
      pagesInBand(pages(6), 612, { firstTop: -2000, gap: 0 }, band),
    ).toEqual([2, 3]);
  });

  it("leaves out a page that only touches an edge", () => {
    // Page 0 ends exactly at the band's top; page 1 starts exactly at its bottom.
    expect(
      pagesInBand(
        pages(3),
        612,
        { firstTop: -792, gap: 0 },
        { top: 0, bottom: 792 },
      ),
    ).toEqual([1]);
  });

  it("returns at most `limit` pages, the first ones, and four by default", () => {
    const tall = { top: 0, bottom: 100_000 };
    expect(MAX_PREPARED_PAGES).toBe(4);
    expect(pagesInBand(pages(10), 612, { firstTop: 0, gap: 0 }, tall)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      pagesInBand(pages(10), 612, { firstTop: 0, gap: 0 }, tall, 2),
    ).toEqual([0, 1]);
  });

  it("measures each page by its own proportions", () => {
    // A landscape page at 612 wide is about 473 tall: the second page starts there and the third at about 1265.
    const mixed = [LANDSCAPE, LETTER, LETTER];
    expect(pagesInBand(mixed, 612, { firstTop: 0, gap: 0 }, band)).toEqual([
      0, 1,
    ]);
  });

  it("is empty for a document with no pages, or when the first page starts below the band", () => {
    expect(pagesInBand([], 612, { firstTop: 0, gap: 0 }, band)).toEqual([]);
    expect(
      pagesInBand(pages(2), 612, { firstTop: 1000, gap: 0 }, band),
    ).toEqual([]);
  });
});

describe("nearestToMiddle: which queued page is drawn next", () => {
  const band = { top: 0, bottom: 1000 };
  const at = (item: string, top: number, bottom: number): Placed<string> => ({
    item,
    top,
    bottom,
  });

  it("takes the page whose middle is nearest the middle of the band", () => {
    expect(
      nearestToMiddle(
        [at("a", 900, 1700), at("b", 100, 600), at("c", 2000, 2800)],
        band,
      ),
    ).toBe("b");
  });

  it("measures a page above the band the same as one below it", () => {
    // Middles at 1250 and 0, which are 750 and 500 from the band's middle.
    expect(
      nearestToMiddle([at("below", 1000, 1500), at("above", -300, 300)], band),
    ).toBe("above");
  });

  it("takes the one queued first when two are as near", () => {
    // Middles at 0 and 1000: both 500 from the band's middle.
    expect(
      nearestToMiddle([at("first", -500, 500), at("second", 500, 1500)], band),
    ).toBe("first");
    expect(
      nearestToMiddle([at("second", 500, 1500), at("first", -500, 500)], band),
    ).toBe("second");
  });

  it("is null for an empty queue", () => {
    expect(nearestToMiddle([], band)).toBeNull();
  });
});

describe("canvasPixelWidth and canvasKey", () => {
  it("multiplies the CSS width by the pixel ratio and rounds", () => {
    expect(canvasPixelWidth(600, 1)).toBe(600);
    expect(canvasPixelWidth(600, 2)).toBe(1200);
    expect(canvasPixelWidth(333.4, 1.5)).toBe(500);
  });

  it("is never less than one pixel", () => {
    expect(canvasPixelWidth(0, 2)).toBe(1);
    expect(canvasPixelWidth(0.2, 1)).toBe(1);
  });

  it("names a canvas by its document's generation and its pixel width", () => {
    expect(canvasKey(3, 1200)).toBe("3:1200");
    expect(canvasKey(3, 1200)).not.toBe(canvasKey(4, 1200));
    expect(canvasKey(3, 1200)).not.toBe(canvasKey(3, 600));
  });
});

describe("lacks", () => {
  it("wants nothing from a slot drawn for this key and this generation", () => {
    expect(
      lacks({ canvasKey: "2:600", textGeneration: 2 }, "2:600", 2),
    ).toEqual({ canvas: false, text: false });
  });

  it("wants the canvas again at another width or for another document, but keeps the text for the document", () => {
    expect(
      lacks({ canvasKey: "2:600", textGeneration: 2 }, "2:1200", 2),
    ).toEqual({ canvas: true, text: false });
    expect(
      lacks({ canvasKey: "2:600", textGeneration: 2 }, "3:600", 3),
    ).toEqual({ canvas: true, text: true });
  });

  it("wants both from a slot that has neither", () => {
    expect(lacks({ canvasKey: "", textGeneration: -1 }, "1:600", 1)).toEqual({
      canvas: true,
      text: true,
    });
  });
});

describe("needsRender", () => {
  const doc = { generation: 2, numPages: 3 };
  const view = { near: true, renderWidth: 600, key: "2:600" };
  const empty: SlotFacts = {
    index: 1,
    canvasKey: "",
    textGeneration: -1,
    jobKey: null,
  };
  const drawn: SlotFacts = {
    ...empty,
    canvasKey: "2:600",
    textGeneration: 2,
  };

  it("renders a page near the viewport that has nothing yet", () => {
    expect(needsRender(empty, doc, view)).toBe(true);
  });

  it("leaves a page that is up to date alone", () => {
    expect(needsRender(drawn, doc, view)).toBe(false);
  });

  it("renders again for a new width, a new document, or a missing text layer", () => {
    expect(needsRender(drawn, doc, { ...view, key: "2:1200" })).toBe(true);
    expect(
      needsRender(drawn, { ...doc, generation: 3 }, { ...view, key: "3:600" }),
    ).toBe(true);
    expect(needsRender({ ...drawn, textGeneration: 1 }, doc, view)).toBe(true);
  });

  it("leaves a page far from the viewport alone, even with nothing drawn", () => {
    expect(needsRender(empty, doc, { ...view, near: false })).toBe(false);
  });

  it("leaves a slot past the last page of the document alone (the old document had more)", () => {
    expect(needsRender({ ...empty, index: 3 }, doc, view)).toBe(false);
    expect(needsRender({ ...empty, index: 2 }, doc, view)).toBe(true);
  });

  it("waits for the pages to have a width", () => {
    expect(needsRender(empty, doc, { ...view, renderWidth: 0 })).toBe(false);
    expect(needsRender(empty, doc, { ...view, renderWidth: 0.5 })).toBe(false);
  });

  it("doesn't start a render that is already running for this key, and replaces one for another", () => {
    expect(needsRender({ ...empty, jobKey: "2:600" }, doc, view)).toBe(false);
    expect(needsRender({ ...empty, jobKey: "1:600" }, doc, view)).toBe(true);
    expect(needsRender({ ...empty, jobKey: "2:300" }, doc, view)).toBe(true);
  });
});

describe("the idle text fill", () => {
  const doc = { generation: 2, numPages: 3 };
  const slot = (index: number, textGeneration: number) => ({
    index,
    textGeneration,
  });

  it("wants the pages of the document whose text isn't built, in order", () => {
    const slots = [slot(0, 2), slot(1, -1), slot(2, 1)];
    expect(slotsMissingText(slots, doc, new Set())).toEqual([
      slots[1],
      slots[2],
    ]);
  });

  it("skips slots past the last page, and pages it has tried", () => {
    const slots = [slot(1, -1), slot(2, -1), slot(3, -1)];
    expect(slotsMissingText(slots, doc, new Set([slots[0]]))).toEqual([
      slots[1],
    ]);
  });

  it("takes any iterable of slots", () => {
    const slots = new Map([[1, slot(1, -1)]]);
    expect(slotsMissingText(slots.values(), doc, new Set())).toEqual([
      slot(1, -1),
    ]);
  });

  it("picks the first page nobody else is drawing", () => {
    const missing = [slot(1, -1), slot(2, -1)];
    expect(firstFreeForText(missing, 2, (s) => s.index === 1)).toBe(missing[1]);
    expect(firstFreeForText(missing, 2, () => false)).toBe(missing[0]);
  });

  it("finds none when every page is being drawn, or got its text meanwhile", () => {
    const missing = [slot(1, -1), slot(2, 2)];
    expect(firstFreeForText(missing, 2, (s) => s.index === 1)).toBeUndefined();
    expect(firstFreeForText([], 2, () => false)).toBeUndefined();
  });
});
