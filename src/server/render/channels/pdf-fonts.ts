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
  // itself (pdf-text.ts) and cuts inside a word only when the word is wider than its line.
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

/** Registers and loads every face. The first call parses the TTFs; later calls resolve at once. */
export function loadFonts(): Promise<void> {
  registerFonts();
  loading ??= Promise.all(MEASURED_FACES.map((face) => Font.load(descriptor(face)))).then(() => undefined);
  return loading;
}

interface Measurable {
  unitsPerEm: number;
  layout(text: string): { advanceWidth: number };
}

const widthCache = new Map<string, number>();

/** The advance width of `text` in points, as react-pdf will set it. Call after `loadFonts()`. */
export function measure(text: string, face: FontFace, size: number): number {
  if (text.length === 0) return 0;
  const key = `${face.family}|${face.weight}|${face.italic ? 1 : 0}|${text}`;
  let em = widthCache.get(key);
  if (em === undefined) {
    const font = Font.getFont(descriptor(face))?.data as Measurable | null | undefined;
    if (!font) throw new Error(`PDF font not loaded: ${key}`);
    em = font.layout(text).advanceWidth / font.unitsPerEm;
    if (widthCache.size > 20_000) widthCache.clear();
    widthCache.set(key, em);
  }
  return em * size;
}
