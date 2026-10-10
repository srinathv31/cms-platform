import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UNICODE_VERSION, graphemeCount, graphemes } from "./graphemes";

const segments = (text: string) => graphemes(text).map((g) => g.segment);

/** GraphemeBreakTest.txt's cases: the text, and its clusters as the file marks them with ÷ and ×. */
function conformanceCases(): { line: number; text: string; clusters: string[] }[] {
  const file = readFileSync(path.join(import.meta.dirname, "GraphemeBreakTest.txt"), "utf8");
  expect(file).toContain(`GraphemeBreakTest-${UNICODE_VERSION}.txt`);
  const cases: { line: number; text: string; clusters: string[] }[] = [];
  file.split("\n").forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const clusters = line
      .split("÷")
      .map((cluster) => cluster.trim())
      .filter(Boolean)
      .map((cluster) => String.fromCodePoint(...cluster.split("×").map((hex) => parseInt(hex.trim(), 16))));
    cases.push({ line: i + 1, text: clusters.join(""), clusters });
  });
  return cases;
}

describe("graphemes: Unicode's extended grapheme clusters, pinned", () => {
  it("is Unicode 17.0.0", () => {
    expect(UNICODE_VERSION).toBe("17.0.0");
  });

  it("passes every case of Unicode's GraphemeBreakTest.txt", () => {
    const cases = conformanceCases();
    expect(cases.length).toBe(766);
    const failures = cases.filter((c) => JSON.stringify(segments(c.text)) !== JSON.stringify(c.clusters)).map((c) => c.line);
    expect(failures).toEqual([]);
  });

  it.each([
    ["an emoji ZWJ sequence", "👨\u200D👩\u200D👧", 1],
    ["an emoji with its presentation selector", "❤\uFE0F", 1],
    ["a keycap", "1\uFE0F\u20E3", 1],
    ["a flag tag sequence", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", 1],
    ["a regional indicator flag pair, and a third alone", "🇺🇸🇫", 2],
    ["a skin tone", "👋🏽", 1],
    ["a Devanagari conjunct (GB9c)", "क\u094Dष", 1],
    ["a ZWNJ inside a Persian word", "می\u200Cخواهم", 7],
    ["a letter and its combining mark", "e\u0301", 1],
    ["CRLF", "\r\n", 1],
    ["a Hangul syllable and its jamo", "한\u1100\u1161\u11A8", 2],
  ])("keeps %s together", (_name, text, count) => {
    expect(graphemeCount(text)).toBe(count);
  });

  it("gives each cluster's UTF-16 offset", () => {
    expect(graphemes("a👨\u200D👩\u200D👧b")).toEqual([
      { segment: "a", index: 0 },
      { segment: "👨\u200D👩\u200D👧", index: 1 },
      { segment: "b", index: 9 },
    ]);
  });

  it("has no clusters in the empty text, and a lone surrogate is a cluster of its own", () => {
    expect(graphemes("")).toEqual([]);
    expect(segments("a\uD800b")).toEqual(["a", "\uD800", "b"]);
  });

  // The data is the runtime's when the runtime is on the same version: every code point, alone and in the
  // contexts the rules look at, splits as Intl.Segmenter splits it. Skipped on another Unicode version.
  it.runIf(process.versions.unicode === UNICODE_VERSION.replace(/\.0$/, ""))(
    "agrees with this runtime's Intl.Segmenter on every code point, which is also Unicode 17.0",
    () => {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const native = (text: string) => Array.from(segmenter.segment(text), (s) => s.segment);
      const contexts = [
        (c: string) => `a${c}`,
        (c: string) => `${c}\u0308`,
        (c: string) => `${c}a`,
        (c: string) => `क\u094D${c}`,
        (c: string) => `\u{1F600}\u200D${c}`,
        (c: string) => `${c}\u1161`,
        (c: string) => `${c}\u11A8`,
      ];
      const disagree: string[] = [];
      for (let cp = 0; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        // The unassigned planes 4–13 and the private use planes hold nothing the rules treat apart.
        if (cp >= 0x40000 && cp < 0xe0000) continue;
        if (cp >= 0xf0000) continue;
        const c = String.fromCodePoint(cp);
        for (const context of contexts) {
          const text = context(c);
          if (JSON.stringify(segments(text)) !== JSON.stringify(native(text))) {
            disagree.push(cp.toString(16));
            break;
          }
        }
        if (disagree.length > 10) break;
      }
      expect(disagree).toEqual([]);
    },
    60_000,
  );
});
