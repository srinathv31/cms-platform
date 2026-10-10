import { describe, expect, it } from "vitest";
import { charShows, visibleLength, type CharBox, type Clip } from "./measure";

// A clamped box two lines tall (20px lines), 200px wide, with a 12px ellipsis: the last line's characters
// must end by x = 188. The DOM side (Range rects, the clamp itself) is checked on the design page.
const CLIP: Clip = { bottom: 40, lastLineTop: 20, lastLineRight: 188 };

/** Characters 10px wide, wrapped at 20 per line, laid out like a browser would. */
function layout(): (index: number) => CharBox {
  return (index) => {
    const line = Math.floor(index / 20);
    const column = index % 20;
    return { top: line * 20, bottom: line * 20 + 20, right: column * 10 + 10 };
  };
}

describe("charShows", () => {
  it("shows a character on an earlier line, and on the last line only before the ellipsis", () => {
    expect(charShows({ top: 0, bottom: 20, right: 200 }, CLIP)).toBe(true);
    expect(charShows({ top: 20, bottom: 40, right: 180 }, CLIP)).toBe(true);
    expect(charShows({ top: 20, bottom: 40, right: 190 }, CLIP)).toBe(false);
    expect(charShows({ top: 40, bottom: 60, right: 10 }, CLIP)).toBe(false);
  });
});

describe("visibleLength", () => {
  const text = "a".repeat(60);
  const all = Array.from({ length: text.length }, (_, i) => i);
  const one = () => 1;

  it("finds the last character before the ellipsis on the last line", () => {
    // Line 2 holds characters 20–39; 188px fits 18 of them (ending at 180), so 38 show.
    expect(visibleLength(all, layout(), CLIP, one)).toBe(38);
  });

  it("lets a character without a box take its neighbour's answer, and counts a surrogate pair as two", () => {
    const boxes = layout();
    const holes = (i: number) => (i % 2 ? null : boxes(i));
    // 36 shows and 38 doesn't; 37 has no box, so it goes with 36: 38 characters.
    expect(visibleLength(all, holes, CLIP, one)).toBe(38);
    expect(visibleLength([0, 2], boxes, CLIP, () => 2)).toBe(4);
  });

  it("returns 0 when nothing shows", () => {
    expect(visibleLength(all, () => ({ top: 50, bottom: 70, right: 10 }), CLIP, one)).toBe(0);
    expect(visibleLength([], layout(), CLIP, one)).toBe(0);
  });
});
