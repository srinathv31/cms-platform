// Grapheme clusters, the units an SMS never splits and `characters` counts: Unicode's extended grapheme clusters
// (UAX #29, "Grapheme Cluster Boundary Rules"), at one pinned Unicode version, UNICODE_VERSION.
//
// Why not `Intl.Segmenter`: it follows the Unicode version of the runtime's ICU, which differs between browsers,
// Node releases and a Java engine, and the rules themselves move between versions (GB9c, the Indic conjunct rule,
// arrived in 15.1 and changed again in 18.0). The composer's preview runs in the browser and the API on the
// server, and both must cut an SMS into the same parts (decision 0036), so the rules and the property data live
// here, generated from the Unicode Character Database by scripts/unicode-graphemes.ts. A second engine reproduces
// them at the same version (ICU4J 78 is Unicode 17.0); GraphemeBreakTest.txt, Unicode's own conformance file, is
// the test (graphemes.test.ts).

import { GRAPHEME_DATA, GRAPHEME_DATA_VERSION } from "./grapheme-data";

/** The Unicode version whose grapheme cluster rules and data this module implements. */
export const UNICODE_VERSION = "17.0.0";

if (GRAPHEME_DATA_VERSION !== UNICODE_VERSION) throw new Error("grapheme-data.ts is for another Unicode version");

// Grapheme_Cluster_Break classes, numbered as the generator numbers them (0 is Other).
const CR = 1;
const LF = 2;
const CONTROL = 3;
const EXTEND = 4;
const ZWJ = 5;
const RI = 6;
const PREPEND = 7;
const SPACING_MARK = 8;
const L = 9;
const V = 10;
const T = 11;
const LV = 12;
const LVT = 13;

// Indic_Conjunct_Break (InCB) classes.
const INCB_NONE = 0;
const INCB_LINKER = 1;
const INCB_CONSONANT = 2;
const INCB_EXTEND = 3;

const EXT_PICT = 16;
const INCB_SHIFT = 5;

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

let starts: Uint32Array | undefined;
let values: Uint8Array | undefined;

/** The runs of GRAPHEME_DATA, decoded once. */
function table(): { starts: Uint32Array; values: Uint8Array } {
  if (!starts || !values) {
    const runs = GRAPHEME_DATA.split(",").filter(Boolean);
    starts = new Uint32Array(runs.length + 1);
    values = new Uint8Array(runs.length + 1);
    let at = 0;
    runs.forEach((run, i) => {
      const [distance, value] = run.split(":");
      at += parseInt(distance!, 36);
      starts![i + 1] = at;
      values![i + 1] = parseInt(value!, 36);
    });
  }
  return { starts, values };
}

/** A code point's properties: its Grapheme_Cluster_Break class, Extended_Pictographic and its InCB class. */
function properties(cp: number): number {
  if (cp >= HANGUL_FIRST && cp <= HANGUL_LAST) return (cp - HANGUL_FIRST) % 28 === 0 ? LV : LVT;
  const { starts, values } = table();
  // The last run that starts at or before cp.
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (starts[mid]! <= cp) low = mid;
    else high = mid - 1;
  }
  return values[low]!;
}

const gcb = (props: number) => props & 15;
const incb = (props: number) => props >> INCB_SHIFT;
const isExtPict = (props: number) => (props & EXT_PICT) !== 0;

/**
 * The extended grapheme clusters of `text`, in order, each with its UTF-16 offset. A lone surrogate is a code
 * point of its own (class Other), as a string iterator yields it. The empty text has none.
 */
export function graphemes(text: string): { segment: string; index: number }[] {
  const out: { segment: string; index: number }[] = [];
  let start = 0;
  let previous = -1;
  // GB9c: what precedes the break point, `Consonant [Extend Linker]*` (1) or with a Linker among them (2).
  let conjunct = 0;
  // GB11: what precedes the break point, `ExtPict Extend*` (1) or `ExtPict Extend* ZWJ` (2).
  let emoji = 0;
  // GB12, GB13: how many Regional Indicators precede the break point, back to the last non-RI.
  let regional = 0;

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const props = properties(cp);
    if (previous !== -1 && breaksBetween(previous, props, conjunct, emoji, regional)) {
      out.push({ segment: text.slice(start, i), index: start });
      start = i;
    }
    conjunct = conjunctAfter(conjunct, props);
    emoji = emojiAfter(emoji, props);
    regional = gcb(props) === RI ? regional + 1 : 0;
    previous = props;
    i += cp > 0xffff ? 2 : 1;
  }
  if (text.length > 0) out.push({ segment: text.slice(start), index: start });
  return out;
}

/** The number of extended grapheme clusters in `text`. */
export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

/** UAX #29's rules GB3 to GB999, in order: is there a boundary between a character and the next? */
function breaksBetween(before: number, after: number, conjunct: number, emoji: number, regional: number): boolean {
  const a = gcb(before);
  const b = gcb(after);
  if (a === CR && b === LF) return false; // GB3
  if (a === CONTROL || a === CR || a === LF) return true; // GB4
  if (b === CONTROL || b === CR || b === LF) return true; // GB5
  if (a === L && (b === L || b === V || b === LV || b === LVT)) return false; // GB6
  if ((a === LV || a === V) && (b === V || b === T)) return false; // GB7
  if ((a === LVT || a === T) && b === T) return false; // GB8
  if (b === EXTEND || b === ZWJ) return false; // GB9
  if (b === SPACING_MARK) return false; // GB9a
  if (a === PREPEND) return false; // GB9b
  if (conjunct === 2 && incb(after) === INCB_CONSONANT) return false; // GB9c
  if (emoji === 2 && isExtPict(after)) return false; // GB11
  if (b === RI && regional % 2 === 1) return false; // GB12, GB13
  return true; // GB999
}

/** GB9c's state after a character: `Consonant [Extend Linker]* (Linker [Extend Linker]*)?` so far. */
function conjunctAfter(state: number, props: number): number {
  switch (incb(props)) {
    case INCB_CONSONANT:
      return 1;
    case INCB_LINKER:
      return state === 0 ? 0 : 2;
    case INCB_EXTEND:
      return state;
    case INCB_NONE:
    default:
      return 0;
  }
}

/** GB11's state after a character: `ExtPict Extend*` (1), then a ZWJ (2). */
function emojiAfter(state: number, props: number): number {
  if (isExtPict(props)) return 1;
  if (gcb(props) === EXTEND && state === 1) return 1;
  if (gcb(props) === ZWJ && state === 1) return 2;
  return 0;
}
