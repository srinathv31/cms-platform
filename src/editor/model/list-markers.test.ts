// These tables are the spec examples for list markers (docs/render-spec.md, "Lists and markers").
// The Java engine runs the same rows.

import { describe, expect, it } from "vitest";
import {
  BULLET_GLYPHS,
  NUMBERING_STYLES,
  bulletGlyph,
  bulletStyle,
  defaultMarkerFormat,
  formatMarker,
  formatNumber,
  isListStart,
  isMarkerDelimiter,
  isMarkerFormat,
  orderedMarkers,
  resolveNumbering,
  type MarkerDelimiter,
  type MarkerFormat,
} from "./list-markers";

describe("formatNumber", () => {
  // [n, decimal, lower-alpha, upper-alpha, lower-roman, upper-roman]
  const rows: [number, string, string, string, string, string][] = [
    [0, "0", "0", "0", "0", "0"],
    [1, "1", "a", "A", "i", "I"],
    [2, "2", "b", "B", "ii", "II"],
    [3, "3", "c", "C", "iii", "III"],
    [4, "4", "d", "D", "iv", "IV"],
    [5, "5", "e", "E", "v", "V"],
    [9, "9", "i", "I", "ix", "IX"],
    [10, "10", "j", "J", "x", "X"],
    [14, "14", "n", "N", "xiv", "XIV"],
    [19, "19", "s", "S", "xix", "XIX"],
    [26, "26", "z", "Z", "xxvi", "XXVI"],
    [27, "27", "aa", "AA", "xxvii", "XXVII"],
    [28, "28", "ab", "AB", "xxviii", "XXVIII"],
    [40, "40", "an", "AN", "xl", "XL"],
    [52, "52", "az", "AZ", "lii", "LII"],
    [53, "53", "ba", "BA", "liii", "LIII"],
    [90, "90", "cl", "CL", "xc", "XC"],
    [99, "99", "cu", "CU", "xcix", "XCIX"],
    [400, "400", "oj", "OJ", "cd", "CD"],
    [676, "676", "yz", "YZ", "dclxxvi", "DCLXXVI"],
    [702, "702", "zz", "ZZ", "dccii", "DCCII"],
    [703, "703", "aaa", "AAA", "dcciii", "DCCIII"],
    [900, "900", "ahp", "AHP", "cm", "CM"],
    [1994, "1994", "bxr", "BXR", "mcmxciv", "MCMXCIV"],
    [2024, "2024", "byv", "BYV", "mmxxiv", "MMXXIV"],
    [3999, "3999", "ewu", "EWU", "mmmcmxcix", "MMMCMXCIX"],
    [4000, "4000", "ewv", "EWV", "4000", "4000"],
    [9999, "9999", "nto", "NTO", "9999", "9999"],
    [10003, "10003", "nts", "NTS", "10003", "10003"],
    [18278, "18278", "zzz", "ZZZ", "18278", "18278"],
    [18279, "18279", "aaaa", "AAAA", "18279", "18279"],
  ];

  it.each(rows)("%i → %s %s %s %s %s", (n, decimal, lowerAlpha, upperAlpha, lowerRoman, upperRoman) => {
    expect(formatNumber(n, "decimal")).toBe(decimal);
    expect(formatNumber(n, "lower-alpha")).toBe(lowerAlpha);
    expect(formatNumber(n, "upper-alpha")).toBe(upperAlpha);
    expect(formatNumber(n, "lower-roman")).toBe(lowerRoman);
    expect(formatNumber(n, "upper-roman")).toBe(upperRoman);
  });

  it("writes every number from 1 to 3999 as a distinct roman numeral", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 3999; n += 1) seen.add(formatNumber(n, "lower-roman"));
    expect(seen.size).toBe(3999);
  });

  it("writes every number from 1 to 9999 as a distinct alpha label", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 9999; n += 1) seen.add(formatNumber(n, "lower-alpha"));
    expect(seen.size).toBe(9999);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("refuses %s", (n) => {
    expect(() => formatNumber(n, "decimal")).toThrow(RangeError);
  });
});

describe("formatMarker", () => {
  // [n, format, delimiter, marker]
  const rows: [number, MarkerFormat, MarkerDelimiter, string][] = [
    [1, "decimal", "period", "1."],
    [12, "decimal", "period", "12."],
    [0, "decimal", "period", "0."],
    [2, "lower-alpha", "period", "b."],
    [2, "upper-alpha", "period", "B."],
    [4, "lower-roman", "period", "iv."],
    [4, "upper-roman", "period", "IV."],
    [1, "decimal", "parens", "(1)"],
    [2, "lower-alpha", "parens", "(b)"],
    [3, "lower-roman", "parens", "(iii)"],
    [12, "decimal", "paren-right", "12)"],
    [27, "lower-alpha", "paren-right", "aa)"],
    // Fallbacks keep the delimiter and write the digits in decimal.
    [0, "lower-alpha", "period", "0."],
    [0, "upper-roman", "parens", "(0)"],
    [4000, "lower-roman", "paren-right", "4000)"],
    [9999, "upper-roman", "period", "9999."],
    // The five combinations the menu doesn't offer still format.
    [3, "upper-alpha", "parens", "(C)"],
    [3, "upper-roman", "parens", "(III)"],
    [3, "upper-alpha", "paren-right", "C)"],
    [3, "lower-roman", "paren-right", "iii)"],
    [3, "upper-roman", "paren-right", "III)"],
  ];

  it.each(rows)("%i %s %s → %s", (n, format, delimiter, marker) => {
    expect(formatMarker(n, format, delimiter)).toBe(marker);
  });
});

describe("NUMBERING_STYLES", () => {
  it("offers exactly the ten styles, in menu order", () => {
    expect(NUMBERING_STYLES.map((s) => formatMarker(1, s.format, s.delimiter))).toEqual([
      "1.",
      "a.",
      "A.",
      "i.",
      "I.",
      "(1)",
      "(a)",
      "(i)",
      "1)",
      "a)",
    ]);
  });
});

describe("defaultMarkerFormat", () => {
  it.each([
    [0, "decimal"],
    [1, "lower-alpha"],
    [2, "lower-roman"],
    [3, "decimal"],
    [4, "lower-alpha"],
    [5, "lower-roman"],
    [8, "lower-roman"],
  ] as const)("ordered depth %i → %s", (depth, format) => {
    expect(defaultMarkerFormat(depth)).toBe(format);
  });

  it("refuses a negative or fractional depth", () => {
    expect(() => defaultMarkerFormat(-1)).toThrow(RangeError);
    expect(() => defaultMarkerFormat(0.5)).toThrow(RangeError);
  });
});

describe("resolveNumbering", () => {
  it.each([
    // [format, delimiter, ordered depth, resolved marker for 1]
    [null, null, 0, "1."],
    [null, null, 1, "a."],
    [null, null, 2, "i."],
    [null, null, 3, "1."],
    ["upper-roman", null, 0, "I."],
    [null, "parens", 1, "(a)"],
    ["decimal", "paren-right", 2, "1)"],
    ["lower-alpha", "parens", 0, "(a)"],
  ] as const)("%s / %s at depth %i → %s", (format, delimiter, depth, marker) => {
    const style = resolveNumbering(format, delimiter, depth);
    expect(formatMarker(1, style.format, style.delimiter)).toBe(marker);
  });
});

describe("orderedMarkers", () => {
  it("numbers from start, one per item", () => {
    expect(orderedMarkers(1, 3, { format: "decimal", delimiter: "period" })).toEqual(["1.", "2.", "3."]);
    expect(orderedMarkers(0, 2, { format: "decimal", delimiter: "period" })).toEqual(["0.", "1."]);
    expect(orderedMarkers(25, 3, { format: "lower-alpha", delimiter: "parens" })).toEqual(["(y)", "(z)", "(aa)"]);
    expect(orderedMarkers(3998, 3, { format: "upper-roman", delimiter: "period" })).toEqual([
      "MMMCMXCVIII.",
      "MMMCMXCIX.",
      "4000.",
    ]);
    expect(orderedMarkers(9999, 2, { format: "decimal", delimiter: "paren-right" })).toEqual(["9999)", "10000)"]);
    expect(orderedMarkers(1, 0, { format: "decimal", delimiter: "period" })).toEqual([]);
  });
});

describe("bullets", () => {
  it.each([
    [0, "disc", "•"],
    [1, "circle", "◦"],
    [2, "square", "▪"],
    [3, "disc", "•"],
    [4, "circle", "◦"],
    [8, "square", "▪"],
  ] as const)("bullet depth %i → %s %s", (depth, style, glyph) => {
    expect(bulletStyle(depth)).toBe(style);
    expect(bulletGlyph(depth)).toBe(glyph);
    expect(BULLET_GLYPHS[style]).toBe(glyph);
  });
});

describe("guards", () => {
  it("accept exactly the stored vocabularies", () => {
    expect(["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"].every(isMarkerFormat)).toBe(true);
    expect([null, undefined, "", "Decimal", "lower-latin", "a", "1", 1].some(isMarkerFormat)).toBe(false);
    expect(["period", "paren-right", "parens"].every(isMarkerDelimiter)).toBe(true);
    expect([null, undefined, "", ".", ")", "paren", "Period"].some(isMarkerDelimiter)).toBe(false);
  });

  it("accept a start from 0 to 9999", () => {
    expect([0, 1, 9999].every(isListStart)).toBe(true);
    expect([-1, 10000, 1.5, "3", null, undefined, Number.NaN].some(isListStart)).toBe(false);
  });
});
