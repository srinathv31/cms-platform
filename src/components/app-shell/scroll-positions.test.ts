import { describe, expect, it } from "vitest";
import { pruneSavedPositions, scrollTargetOnPageChange } from "./scroll-positions";

describe("scrollTargetOnPageChange", () => {
  it("opens a page reached by a push at the top (a new entry has nothing saved)", () => {
    const saved = new Map([["library", 400]]);
    expect(scrollTargetOnPageChange("library", "template", saved)).toBe(0);
  });

  it("returns to where an entry was left on back and forward", () => {
    const saved = new Map([
      ["library", 400],
      ["template", 120],
    ]);
    expect(scrollTargetOnPageChange("template", "library", saved)).toBe(400);
    expect(scrollTargetOnPageChange("library", "template", saved)).toBe(120);
  });

  it("opens an entry that was never scrolled at the top", () => {
    expect(scrollTargetOnPageChange("a", "b", new Map())).toBe(0);
  });

  it("opens a page that replaced the one in the same entry at the top, whatever was saved for it", () => {
    const saved = new Map([["library", 400]]);
    expect(scrollTargetOnPageChange("library", "library", saved)).toBe(0);
  });

  it("opens at the top when the browser cannot tell entries apart", () => {
    const saved = new Map([["library", 400]]);
    expect(scrollTargetOnPageChange("library", null, saved)).toBe(0);
    expect(scrollTargetOnPageChange(null, null, saved)).toBe(0);
  });
});

describe("pruneSavedPositions", () => {
  it("forgets entries that left the history list and keeps the rest", () => {
    const saved = new Map([
      ["a", 10],
      ["b", 20],
      ["c", 30],
    ]);
    pruneSavedPositions(saved, ["a", "c", "d"]);
    expect([...saved]).toEqual([
      ["a", 10],
      ["c", 30],
    ]);
  });
});
