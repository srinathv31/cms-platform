import { describe, expect, it } from "vitest";
import { textMetrics, tracking } from "./type";

describe("tracking", () => {
  it("is Apple's value at a listed size, and interpolates between two", () => {
    expect(tracking(17)).toBe(-0.43);
    expect(tracking(15)).toBe(-0.23);
    expect(tracking(29)).toBeCloseTo(0.39, 2);
  });

  it("holds the ends of the table beyond them", () => {
    expect(tracking(4)).toBe(0.24);
    expect(tracking(120)).toBe(0);
  });
});

describe("textMetrics", () => {
  it("grows with the reader's text size", () => {
    const sizes = (["default", "large", "ax"] as const).map((s) => textMetrics("subheadline", s).size);
    expect(sizes).toEqual([15, 21, 25]);
  });
});
