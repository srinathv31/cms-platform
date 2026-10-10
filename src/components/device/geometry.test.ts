import { describe, expect, it } from "vitest";
import { MIN_SCALE, frameSize, phoneScale, pt } from "./geometry";

describe("the phone's geometry", () => {
  it("is a point to a CSS pixel inside the phone", () => {
    expect(pt(12)).toBe("12px");
    expect(pt(0)).toBe("0");
  });

  it("has the real phones' proportions, bezel included", () => {
    const iphone = frameSize("ios", "standard");
    const pixel = frameSize("android", "standard");
    expect(iphone).toEqual({ width: 431, height: 903 });
    expect(pixel).toEqual({ width: 455, height: 958 });
    // iPhone 17: 71.5 × 149.6 mm. Pixel 9: 72.0 × 152.8 mm.
    expect(iphone.width / iphone.height).toBeCloseTo(71.5 / 149.6, 2);
    expect(pixel.width / pixel.height).toBeCloseTo(72 / 152.8, 2);
  });

  it("fits the whole phone in the box, never above 1", () => {
    expect(phoneScale({ width: 531, height: 647 }, "ios", "standard")).toBeCloseTo(647 / 903);
    expect(phoneScale({ width: 2000, height: 2000 }, "ios", "standard")).toBe(1);
  });

  it("draws a compact phone at the standard phone's scale, so it reads smaller", () => {
    const box = { width: 531, height: 647 };
    expect(phoneScale(box, "ios", "compact")).toBe(phoneScale(box, "ios", "standard"));
    expect(phoneScale(box, "ios", "large")).toBeLessThan(phoneScale(box, "ios", "standard"));
  });

  it("holds the smallest scale in a short box, and the phone runs past its bottom", () => {
    expect(phoneScale({ width: 650, height: 447 }, "android", "standard")).toBe(MIN_SCALE);
    expect(phoneScale({ width: 650, height: 447 }, "android", "standard", 0.3)).toBeCloseTo(447 / 958);
  });
});
