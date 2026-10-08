import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

// The PDF's embedded fonts, read from local files in node_modules (never the network):
//
// - Body, H1, H3, tables, lists, footer: Liberation Sans (SIL OFL 1.1), shipped by pdfjs-dist as
//   its standard-font substitute. Arial-metric, the classic bank-disclosure face, and it covers
//   Latin, Latin-1 and Latin Extended-A ("Łódź", "Győr"), which the built-in WinAnsi Helvetica
//   can't. Regular, bold, italic and bold italic.
// - H2 section heads: Newsreader (SIL OFL 1.1, @expo-google-fonts/newsreader), the same serif
//   the editor uses for its section heads.
//
// Fonts load lazily on first use and stay cached for the life of the process.

export const SANS = "UCOMP Sans";
export const SERIF = "UCOMP Serif";

export type FontFamilyName = typeof SANS | typeof SERIF;

export interface FontFace {
  family: FontFamilyName;
  weight: 400 | 500 | 700;
  italic: boolean;
}

// Each path is a literal joined to process.cwd() (the project root under `next dev`, `next start`
// and vitest), so the build's file tracing sees exactly which files the route reads. The route
// handler is bundled, so a module-relative path would point into .next/.
function fontFile(full: string): string {
  if (!existsSync(full)) {
    throw new Error(`PDF font missing: ${path.relative(process.cwd(), full)}. Run npm install.`);
  }
  return full;
}

let registered = false;

/** Registers the families once per process. Safe to call on every render. */
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: SANS,
    fonts: [
      { src: fontFile(path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf")), fontWeight: 400 },
      { src: fontFile(path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf")), fontWeight: 400, fontStyle: "italic" },
      { src: fontFile(path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf")), fontWeight: 700 },
      { src: fontFile(path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf")), fontWeight: 700, fontStyle: "italic" },
    ],
  });
  Font.register({
    family: SERIF,
    fonts: [
      { src: fontFile(path.join(process.cwd(), "node_modules/@expo-google-fonts/newsreader/500Medium/Newsreader_500Medium.ttf")), fontWeight: 500 },
      { src: fontFile(path.join(process.cwd(), "node_modules/@expo-google-fonts/newsreader/500Medium_Italic/Newsreader_500Medium_Italic.ttf")), fontWeight: 500, fontStyle: "italic" },
      { src: fontFile(path.join(process.cwd(), "node_modules/@expo-google-fonts/newsreader/700Bold/Newsreader_700Bold.ttf")), fontWeight: 700 },
      { src: fontFile(path.join(process.cwd(), "node_modules/@expo-google-fonts/newsreader/700Bold_Italic/Newsreader_700Bold_Italic.ttf")), fontWeight: 700, fontStyle: "italic" },
    ],
  });
  // react-pdf ends every font stack with "Helvetica" and sets any character the main face lacks
  // in it, including the "\n" of each line break, so the file would reference the non-embedded,
  // WinAnsi-only Helvetica. Point that fallback at Liberation Sans's own sources (the same loaded
  // fonts, so nothing is embedded twice).
  const families = Font.getRegisteredFonts();
  families.Helvetica.sources = families[SANS].sources;
  // No dictionary hyphenation: it splits names ("Feather-stone-haugh"). The adapter breaks lines
  // itself (pdf-text.ts) and cuts inside a word, bare, only when the word is wider than its line.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** The faces the adapter measures text with. Loaded before layout so measuring is synchronous. */
const MEASURED_FACES: FontFace[] = [
  { family: SANS, weight: 400, italic: false },
  { family: SANS, weight: 400, italic: true },
  { family: SANS, weight: 700, italic: false },
  { family: SANS, weight: 700, italic: true },
  { family: SERIF, weight: 500, italic: false },
  { family: SERIF, weight: 500, italic: true },
  { family: SERIF, weight: 700, italic: false },
  { family: SERIF, weight: 700, italic: true },
];

const descriptor = (face: FontFace) => ({
  fontFamily: face.family,
  fontWeight: face.weight,
  fontStyle: face.italic ? ("italic" as const) : ("normal" as const),
});

let loading: Promise<void> | null = null;

/**
 * Registers and loads every face, and primes each font's glyph cache (below). The first call parses
 * the TTFs; later calls resolve at once. Nothing may measure or lay out text before it resolves.
 */
export function loadFonts(): Promise<void> {
  registerFonts();
  loading ??= Promise.all(MEASURED_FACES.map((face) => Font.load(descriptor(face)))).then(() => {
    for (const face of MEASURED_FACES) {
      primeGlyphCache(loadedFont(face.family, face));
      primeGlyphCache(loadedFont(FALLBACK_FAMILY, face));
    }
  });
  return loading;
}

/** The parts of a fontkit font the adapter uses. */
interface LoadedFont {
  unitsPerEm: number;
  characterSet: number[];
  layout(text: string): { advanceWidth: number };
  hasGlyphForCodePoint(codePoint: number): boolean;
  glyphForCodePoint(codePoint: number): { id: number; codePoints: number[] };
}

// ── The glyph cache ──────────────────────────────────────────────────────────
//
// fontkit caches each glyph object the first time any lookup reaches it, with the code points of
// that lookup, and keeps it for the life of the font (here, the process). Characters that share a
// glyph then all read as the first one: the code points decide what the PDF's text layer says the
// glyph is, and react-pdf's layout reads them too (it hangs a line's leading glyphs into the margin
// only when their code point is U+0020, and it drops soft hyphens). Unprimed, a document whose first
// hyphen-shaped character was a soft hyphen (U+00AD) took every "-" out of every later PDF, and one
// that began with a no-break space indented later documents' leading spaces twice and wrote their
// U+0020s as U+00A0. So each font's cache is filled once, right after loading, in a fixed order:
// every code point the font maps, lowest first, private-use code points last. A shared glyph reads
// as its lowest code point: a space as U+0020 (not U+00A0), "-" as U+002D (not U+00AD), "·" as
// U+00B7 (not U+2219), "ﬁ" as U+FB01 (not its private-use twin). The .notdef glyph is reached
// first through "\n", which react-pdf lays out at every line break (no font maps it).

const primed = new WeakSet<LoadedFont>();
const isPrivateUse = (codePoint: number) => (codePoint >= 0xe000 && codePoint <= 0xf8ff) || codePoint >= 0xf0000;

function primeGlyphCache(font: LoadedFont): void {
  if (primed.has(font)) return;
  font.glyphForCodePoint(0x0a);
  const order = [...font.characterSet].sort((a, b) => Number(isPrivateUse(a)) - Number(isPrivateUse(b)) || a - b);
  for (const codePoint of order) font.glyphForCodePoint(codePoint);
  primed.add(font);
}

const faceKey = (face: FontFace) => `${face.family}|${face.weight}|${face.italic ? 1 : 0}`;

/** The loaded font file react-pdf sets `face` with, from `family` (the face's own, or the fallback). */
function loadedFont(family: string, face: FontFace): LoadedFont {
  const font = Font.getFont({ ...descriptor(face), fontFamily: family })?.data as LoadedFont | null | undefined;
  if (!font) throw new Error(`PDF font not loaded: ${family} ${faceKey(face)}`);
  return font;
}

const widthCache = new Map<string, number>();

/** The advance width of `text` in points, as react-pdf will set it. Call after `loadFonts()`. */
export function measure(text: string, face: FontFace, size: number): number {
  if (text.length === 0) return 0;
  const key = `${faceKey(face)}|${text}`;
  let em = widthCache.get(key);
  if (em === undefined) {
    const font = loadedFont(face.family, face);
    em = font.layout(text).advanceWidth / font.unitsPerEm;
    if (widthCache.size > 20_000) widthCache.clear();
    widthCache.set(key, em);
  }
  return em * size;
}

// ── Glyph coverage ───────────────────────────────────────────────────────────

/** react-pdf's last-resort family, pointed at Liberation Sans in `registerFonts`. */
const FALLBACK_FAMILY = "Helvetica";

const coverage = new Map<string, boolean>();

/**
 * Whether the PDF can draw `codePoint` in `face`. react-pdf sets each character in the face's own
 * font when that font has a glyph for it, otherwise in its fallback family (Liberation Sans, in the
 * face's weight and style). A character neither has would print as an empty box (.notdef) or not at
 * all. Call after `loadFonts()`.
 */
export function canDraw(codePoint: number, face: FontFace): boolean {
  const key = `${faceKey(face)}|${codePoint}`;
  let ok = coverage.get(key);
  if (ok === undefined) {
    ok = drawingFont(codePoint, face) !== null;
    coverage.set(key, ok);
  }
  return ok;
}

/** The font react-pdf sets `codePoint` in for `face`: the face's own, else the fallback; null if neither has it. */
function drawingFont(codePoint: number, face: FontFace): LoadedFont | null {
  const own = loadedFont(face.family, face);
  if (own.hasGlyphForCodePoint(codePoint)) return own;
  const fallback = loadedFont(FALLBACK_FAMILY, face);
  return fallback.hasGlyphForCodePoint(codePoint) ? fallback : null;
}

/**
 * Whether react-pdf hangs `codePoint` into the margin when it begins a line. Its layout counts a
 * glyph as white space only when the glyph's code points include U+0020, which (once the cache is
 * primed) is the font's space glyph: U+0020 itself, and U+00A0 in Liberation Sans, which draws it
 * with the same glyph, but not in Newsreader, which has a glyph of its own for it.
 */
export function hangsAtLineStart(codePoint: number, face: FontFace): boolean {
  const font = drawingFont(codePoint, face);
  return font !== null && font.glyphForCodePoint(codePoint).codePoints.includes(0x20);
}

/**
 * Collects the characters the PDF can't draw, once each, in the order they are first checked (the
 * adapter checks in document order, the footer last). The adapter refuses to render when any are
 * found (docs/render-spec.md, "PDF" and "Errors"): no tofu boxes, no silent drops.
 */
export class GlyphCheck {
  readonly #missing = new Map<number, string>();

  /** Checks every character of `text` against the face that will draw it. */
  check(text: string, face: FontFace): void {
    for (const ch of text) {
      const codePoint = ch.codePointAt(0) ?? 0;
      if (codePoint >= 0x20 && codePoint < 0x7f) continue; // printable ASCII: every face has it
      if (!this.#missing.has(codePoint) && !canDraw(codePoint, face)) this.#missing.set(codePoint, ch);
    }
  }

  /** The characters found so far, in order. */
  get missing(): string[] {
    return [...this.#missing.values()];
  }
}
