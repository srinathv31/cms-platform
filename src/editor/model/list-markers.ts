// List markers: the one definition of what an author sees beside a list item, shared by the editor,
// the resolver and every channel adapter (and mirrored by the Java engine). Pure TypeScript.
// docs/render-spec.md ("Lists and markers") is the specification; list-markers.test.ts pins it.
//
// An ordered list's style is a format (how the number is written) plus a delimiter (what wraps
// it). A list nobody styled uses the default for its ordered depth: 1. → a. → i. → repeat,
// counting only ordered-list ancestors. Bullets cycle • ◦ ▪ by bullet depth, counting only
// bullet-list ancestors.
//
// formatMarker never reads a locale, never calls Intl, and never clamps: a number a format can't
// write (0 or above 3999 in roman, 0 in alpha) is written in decimal digits, with the list's
// delimiter, exactly as CSS Counter Styles 3 falls back for the built-in styles.

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** How an ordered list writes its numbers. Stored on the orderedList node as `markerFormat`. */
export const MARKER_FORMATS = ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"] as const;
export type MarkerFormat = (typeof MARKER_FORMATS)[number];

/** What wraps the number: "1." / "1)" / "(1)". Stored on the orderedList node as `markerDelimiter`. */
export const MARKER_DELIMITERS = ["period", "paren-right", "parens"] as const;
export type MarkerDelimiter = (typeof MARKER_DELIMITERS)[number];

/** A bulleted list's marker, named as CSS names it. */
export const BULLET_STYLES = ["disc", "circle", "square"] as const;
export type BulletStyle = (typeof BULLET_STYLES)[number];

/** The glyph each bullet style prints: • U+2022, ◦ U+25E6, ▪ U+25AA. */
export const BULLET_GLYPHS: Readonly<Record<BulletStyle, string>> = {
  disc: "•",
  circle: "◦",
  square: "▪",
};

/**
 * The orderedList attributes that store a list's style (absent or null = the default for its depth
 * and "period"). The schema (schema.ts), the editor's markers and the block menu all use these names.
 */
export const ORDERED_LIST_ATTRS = { format: "markerFormat", delimiter: "markerDelimiter" } as const;

/** A resolved ordered-list style. */
export interface NumberingStyle {
  format: MarkerFormat;
  delimiter: MarkerDelimiter;
}

/**
 * The ten styles the list's "Numbering" menu offers, in menu order:
 * 1.  a.  A.  i.  I.  (1)  (a)  (i)  1)  a)
 * Documents may store any format × delimiter pair (all fifteen render); the menu offers these.
 */
export const NUMBERING_STYLES: readonly NumberingStyle[] = [
  { format: "decimal", delimiter: "period" },
  { format: "lower-alpha", delimiter: "period" },
  { format: "upper-alpha", delimiter: "period" },
  { format: "lower-roman", delimiter: "period" },
  { format: "upper-roman", delimiter: "period" },
  { format: "decimal", delimiter: "parens" },
  { format: "lower-alpha", delimiter: "parens" },
  { format: "lower-roman", delimiter: "parens" },
  { format: "decimal", delimiter: "paren-right" },
  { format: "lower-alpha", delimiter: "paren-right" },
];

/** The delimiter of a list whose `markerDelimiter` is absent or null. */
export const DEFAULT_DELIMITER: MarkerDelimiter = "period";

/** An ordered list's `start` must be an integer in this range (inclusive). */
export const LIST_START_MIN = 0;
export const LIST_START_MAX = 9999;

/** Lists nest at most this deep: a list with 8 list ancestors is fine, one with 9 is refused. */
export const MAX_LIST_DEPTH = 9;

/** The largest number roman formats write; above it they fall back to decimal digits. */
export const ROMAN_MAX = 3999;

// ── Guards (for attribute values read from JSON) ─────────────────────────────

export function isMarkerFormat(value: unknown): value is MarkerFormat {
  return typeof value === "string" && (MARKER_FORMATS as readonly string[]).includes(value);
}

export function isMarkerDelimiter(value: unknown): value is MarkerDelimiter {
  return typeof value === "string" && (MARKER_DELIMITERS as readonly string[]).includes(value);
}

/** A valid `start`: an integer from 0 to 9999. Strings, fractions and out-of-range numbers are not. */
export function isListStart(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= LIST_START_MIN && value <= LIST_START_MAX;
}

// ── Defaults by depth ────────────────────────────────────────────────────────

const DEPTH_FORMATS: readonly MarkerFormat[] = ["decimal", "lower-alpha", "lower-roman"];

/**
 * The format of an ordered list nobody styled. `orderedDepth` is the number of orderedList nodes
 * among the list's ancestors (bullet lists, tables and anything else in between don't count):
 * 0 → decimal, 1 → lower-alpha, 2 → lower-roman, 3 → decimal, …
 */
export function defaultMarkerFormat(orderedDepth: number): MarkerFormat {
  return DEPTH_FORMATS[checkDepth(orderedDepth) % DEPTH_FORMATS.length]!;
}

/**
 * An ordered list's resolved style. Each attribute falls back on its own: a null format takes the
 * default for the depth, a null delimiter takes "period". Callers read the stored attributes with
 * isMarkerFormat / isMarkerDelimiter first (anything else is null only if absent; an invalid value
 * is the document check's to refuse, not this function's to guess).
 */
export function resolveNumbering(
  format: MarkerFormat | null,
  delimiter: MarkerDelimiter | null,
  orderedDepth: number,
): NumberingStyle {
  return { format: format ?? defaultMarkerFormat(orderedDepth), delimiter: delimiter ?? DEFAULT_DELIMITER };
}

const BULLET_CYCLE: readonly BulletStyle[] = ["disc", "circle", "square"];

/**
 * The style of a bulleted list. `bulletDepth` is the number of bulletList nodes among the list's
 * ancestors: 0 → disc, 1 → circle, 2 → square, 3 → disc, …
 */
export function bulletStyle(bulletDepth: number): BulletStyle {
  return BULLET_CYCLE[checkDepth(bulletDepth) % BULLET_CYCLE.length]!;
}

/** The glyph of a bulleted list at `bulletDepth`: • ◦ ▪, cycling. */
export function bulletGlyph(bulletDepth: number): string {
  return BULLET_GLYPHS[bulletStyle(bulletDepth)];
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * The number as `format` writes it, without the delimiter: 4 → "4", "d", "D", "iv", "IV".
 * `n` must be a non-negative safe integer (a list item's number is start + index, start ≥ 0);
 * anything else throws a RangeError.
 *
 *   decimal       ASCII digits, no grouping, no padding: 0 → "0", 10003 → "10003".
 *   lower-alpha   bijective base 26 (spreadsheet columns): 1 → "a", 26 → "z", 27 → "aa",
 *                 702 → "zz", 703 → "aaa". 0 is written "0" (decimal).
 *   upper-alpha   the same in capitals.
 *   lower-roman   1–3999, subtractive (iv, ix, xl, xc, cd, cm): 1994 → "mcmxciv".
 *                 0 and 4000 or more are written in decimal digits.
 *   upper-roman   the same in capitals.
 */
export function formatNumber(n: number, format: MarkerFormat): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`A list number must be a non-negative integer, got ${String(n)}.`);
  }
  switch (format) {
    case "decimal":
      return String(n);
    case "lower-alpha":
      return n === 0 ? "0" : alpha(n);
    case "upper-alpha":
      return n === 0 ? "0" : alpha(n).toUpperCase();
    case "lower-roman":
      return n === 0 || n > ROMAN_MAX ? String(n) : roman(n);
    case "upper-roman":
      return n === 0 || n > ROMAN_MAX ? String(n) : roman(n).toUpperCase();
  }
}

/**
 * The marker a list item prints: the number in `format`, wrapped by `delimiter`.
 *   period       "4."   "d."   "iv."
 *   paren-right  "4)"   "d)"   "iv)"
 *   parens       "(4)"  "(d)"  "(iv)"
 * No space is included: each channel puts its own gap between the marker and the text.
 */
export function formatMarker(n: number, format: MarkerFormat, delimiter: MarkerDelimiter): string {
  const number = formatNumber(n, format);
  switch (delimiter) {
    case "period":
      return `${number}.`;
    case "paren-right":
      return `${number})`;
    case "parens":
      return `(${number})`;
  }
}

/** The markers of an ordered list's items, in order: start, start + 1, … (count items). */
export function orderedMarkers(start: number, count: number, style: NumberingStyle): string[] {
  return Array.from({ length: count }, (_, i) => formatMarker(start + i, style.format, style.delimiter));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkDepth(depth: number): number {
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new RangeError(`A list depth must be a non-negative integer, got ${String(depth)}.`);
  }
  return depth;
}

/** Bijective base 26: a–z, then aa–zz, then aaa… (n ≥ 1). */
function alpha(n: number): string {
  let out = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    out = String.fromCharCode(97 + ((x - 1) % 26)) + out;
  }
  return out;
}

const ROMAN_DIGITS: readonly (readonly [number, string])[] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** Lowercase subtractive roman numerals (1 ≤ n ≤ 3999). */
function roman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, digits] of ROMAN_DIGITS) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}
