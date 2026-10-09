import { describe, expect, it } from "vitest";
import { compactCount, formatCount } from "./numbers";

describe("formatCount", () => {
  it("groups thousands, en-US", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(812)).toBe("812");
    expect(formatCount(1_204)).toBe("1,204");
    expect(formatCount(1_000_000)).toBe("1,000,000");
  });
});

describe("compactCount", () => {
  it("is a stat card's short form, lower case", () => {
    expect(compactCount(1)).toBe("1");
    expect(compactCount(812)).toBe("812");
    expect(compactCount(1_234)).toBe("1.2k");
    expect(compactCount(27_412)).toBe("27.4k");
    expect(compactCount(1_300_000)).toBe("1.3m");
  });
});
