// The SMS character set and how a text splits into message parts. Pure TypeScript, for the composer to run on every
// keystroke and for render, Submit and the API to run on the server, so that all of them count the same way.
//
// An SMS carries 140 octets of user data. A text written only in the GSM 7-bit default alphabet (GSM-7) packs
// 160 characters into them; one character outside it switches the whole message to UCS-2 (UTF-16), which fits 70.
// A longer message is sent in parts, and each part gives up 6 octets to the concatenation header, leaving 153
// septets or 67 UTF-16 code units. A handset joins the parts back into one message.
//
// Sources:
//   - 3GPP TS 23.038 §6.2.1 (the default alphabet) and §6.2.1.1 (its extension table).
//   - Unicode's mapping of that table, https://www.unicode.org/Public/MAPPINGS/ETSI/GSM0338.TXT (table version
//     2.0). Every entry below was checked against it, and gsm7.test.ts checks them again.
//   - 3GPP TS 23.040 §9.2.3.24.1 for the concatenation header (6 octets with an 8-bit reference).
//   - Twilio's open-source segment calculator, https://github.com/TwilioDevEd/message-segment-calculator, as a
//     cross-check. The split below gives the same parts as it does, except where noted at `smsParts`.
//   - Unicode's extended grapheme clusters (UAX #29) at Unicode 17.0, for the clusters a UCS-2 part never splits and
//     `characters` counts: graphemes.ts, so the browser, the server and a second engine cut the same parts.
//
// UCS-2 is the name SMS uses for its 16-bit encoding. Handsets read it as UTF-16, so an emoji outside the Basic
// Multilingual Plane travels as a surrogate pair and costs 2 units.

import { graphemeCount, graphemes } from "./graphemes";

// ---------------------------------------------------------------------------------------------------------------
// The character tables

/**
 * The GSM 7-bit default alphabet in code order: the character at index n is GSM code n. Index 0x1B is the escape to
 * the extension table, not a character (GSM0338.TXT shows it as a no-break space only for display), so it is left
 * out of the set below and NBSP is not GSM-7.
 *
 * 0x09 is Ç, CAPITAL C with cedilla, as 3GPP TS 23.038 prints it. GSM0338.TXT maps it to ç, small c with cedilla,
 * reasoning that the spec's capital glyph was a display limitation. Implementations follow the spec: Android's
 * GsmAlphabet decodes 0x09 as Ç, and Twilio's segment calculator encodes only Ç as GSM-7 and counts ç as UCS-2. So
 * only Ç is GSM-7 here. Accepting ç as well would either undercount the parts (Twilio sends ç as UCS-2) or change
 * the letter the reader sees (a gateway that encodes ç as 0x09 shows Ç on Android). Either one breaks render-exact.
 * ç is flagged like any other letter outside the set.
 */
const DEFAULT_ALPHABET =
  /* 0x00 */ "@£$¥èéùìòÇ\nØø\rÅå" +
  /* 0x10 */ "Δ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ" +
  /* 0x20 */ " !\"#¤%&'()*+,-./" +
  /* 0x30 */ "0123456789:;<=>?" +
  /* 0x40 */ "¡ABCDEFGHIJKLMNO" +
  /* 0x50 */ "PQRSTUVWXYZÄÖÑÜ§" +
  /* 0x60 */ "¿abcdefghijklmno" +
  /* 0x70 */ "pqrstuvwxyzäöñüà";

const ESCAPE = 0x1b;

/**
 * The extension table: each character is sent as the escape (0x1B) followed by this code, so it costs 2 septets.
 * The table's other codes are controls or reserved (0x0D, 0x1B) and stand for no character.
 */
const EXTENSION_TABLE: ReadonlyArray<readonly [code: number, char: string]> = [
  [0x0a, "\f"], // FORM FEED
  [0x14, "^"],
  [0x28, "{"],
  [0x29, "}"],
  [0x2f, "\\"],
  [0x3c, "["],
  [0x3d, "~"],
  [0x3e, "]"],
  [0x40, "|"],
  [0x65, "€"],
];

/** Each character of the GSM 7-bit default alphabet, with its code. 127 characters: 0x1B is the escape. */
export const GSM7_DEFAULT_ALPHABET: ReadonlyMap<string, number> = new Map(
  [...DEFAULT_ALPHABET].flatMap((char, code) => (code === ESCAPE ? [] : [[char, code] as const])),
);

/** Each character of the extension table, with its code after the escape. 10 characters, 2 septets each. */
export const GSM7_EXTENSION_TABLE: ReadonlyMap<string, number> = new Map(
  EXTENSION_TABLE.map(([code, char]) => [char, code]),
);

/**
 * What one character costs in GSM-7: 1 septet in the default alphabet, 2 in the extension table, and null when it
 * isn't GSM-7. `char` is one UTF-16 code unit; every GSM-7 character is one.
 */
export function gsm7Septets(char: string): 1 | 2 | null {
  if (GSM7_DEFAULT_ALPHABET.has(char)) return 1;
  if (GSM7_EXTENSION_TABLE.has(char)) return 2;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Encoding and length

export type SmsEncoding = "GSM-7" | "UCS-2";

/** GSM-7 septets in a message sent as one part: 140 octets × 8 bits ÷ 7. */
export const GSM7_SINGLE_PART = 160;
/** GSM-7 septets in each part of a split message: (140 − 6 header octets) × 8 bits ÷ 7, rounded down. */
export const GSM7_PER_PART = 153;
/** UCS-2 code units in a message sent as one part: 140 octets ÷ 2. */
export const UCS2_SINGLE_PART = 70;
/** UCS-2 code units in each part of a split message: (140 − 6 header octets) ÷ 2. */
export const UCS2_PER_PART = 67;
/**
 * The most parts Stencil renders. Past it, render refuses the message rather than truncate it. A product limit, set
 * where a text stops being a text; providers cap length too (Twilio accepts at most 1,600 characters).
 */
export const SMS_MAX_PARTS = 10;

/** GSM-7 when every character of `text` is in the default alphabet or its extension table, otherwise UCS-2. */
export function smsEncoding(text: string): SmsEncoding {
  for (let i = 0; i < text.length; i++) {
    if (gsm7Septets(text[i]) === null) return "UCS-2";
  }
  return "GSM-7";
}

export interface SmsLength {
  encoding: SmsEncoding;
  /** What is billed: septets for GSM-7 (an extension character counts 2), UTF-16 code units for UCS-2. */
  units: number;
  /**
   * Characters as a reader counts them: grapheme clusters, so a ZWJ emoji sequence, a flag, a letter with a
   * combining accent, and a CRLF line break are 1 each. Informational; `units` is what fills the parts.
   */
  characters: number;
  /** How many parts the message is sent in. 0 for the empty text. */
  parts: number;
  /** The units each part holds at this length: 160 or 70 for one part, 153 or 67 once the message is split. */
  perPart: number;
  /** Units left in the last part before another part starts. A 2-unit character may still not fit in 1. */
  remainingInPart: number;
}

/** The encoding, units, characters and parts of an SMS, split as `smsParts` splits it. */
export function smsLength(text: string): SmsLength {
  const { encoding, parts } = split(text);
  const { single, perPart: splitCapacity } = CAPACITY[encoding];
  const perPart = parts.length > 1 ? splitCapacity : single;
  const units = parts.reduce((sum, part) => sum + part.units, 0);
  const lastUnits = parts.length ? parts[parts.length - 1].units : 0;
  return {
    encoding,
    units,
    characters: countGraphemes(text),
    parts: parts.length,
    perPart,
    remainingInPart: perPart - lastUnits,
  };
}

/**
 * The text of each part, in order; joined, they are `text` again. The empty text has no parts.
 *
 * A part ends before a character that doesn't fit. Nothing is ever cut in two:
 *   - an extension character stays with its escape (a GSM-7 part can hold 152 septets plus the 2 of €, not 153);
 *   - a surrogate pair stays whole;
 *   - in UCS-2, a grapheme cluster (a ZWJ emoji sequence, a flag, a letter with its combining accents) stays whole,
 *     as Twilio's calculator and Android's own splitter do it. A CRLF may split between CR and LF, as Twilio's does.
 *
 * Where this differs from Twilio's calculator, on purpose:
 *   - A cluster longer than a whole part (over 67 units, which only a pathological run of combining marks or
 *     joiners reaches) splits between code points here. Twilio's overfills a part with it.
 *   - The empty text has 0 parts. Twilio's reports 1 segment.
 *   - Clusters follow Unicode 17.0's rules and data (graphemes.ts), whatever the runtime's Unicode version. Twilio's
 *     uses the grapheme-splitter package, whose older Unicode rules can join a newer emoji sequence differently.
 */
export function smsParts(text: string): string[] {
  return split(text).parts.map((part) => text.slice(part.start, part.end));
}

// ---------------------------------------------------------------------------------------------------------------
// Characters outside GSM-7

export interface NonGsmCharacter {
  /** Where the character starts in the text, as a UTF-16 offset (the same index `String.prototype.slice` takes). */
  index: number;
  /** Its length in UTF-16 code units: 2 for a surrogate pair, more for a cluster such as a ZWJ emoji sequence. */
  length: number;
  /** The character as written: one grapheme cluster. */
  char: string;
  /** The first code point in `char` that GSM-7 lacks: 0x2019 for ’, 0x301 for an e with a combining acute. */
  codePoint: number;
  /**
   * What a one-click fix writes in its place, when there is an obvious GSM-7 equivalent: ’ → ', “ → ", – → -,
   * … → ..., a no-break space → a space, • → -. It can be the empty string (a zero-width space is removed), so test
   * it against undefined. Never offered for a letter or an emoji: changing those changes the author's words. The one
   * exception is a letter written in decomposed form (e plus a combining acute), offered as the same letter composed
   * (é), which is the identical text in Unicode.
   */
  replacement?: string;
}

/**
 * Each character of `text` that isn't GSM-7, in order. Empty exactly when `smsEncoding(text)` is GSM-7. The editor
 * underlines each one, and Submit refuses authored text while any remain.
 */
export function nonGsmCharacters(text: string): NonGsmCharacter[] {
  if (smsEncoding(text) === "GSM-7") return [];
  const found: NonGsmCharacter[] = [];
  for (const { segment, index } of graphemes(text)) {
    const outside = firstNonGsmCodePoint(segment);
    if (outside === undefined) continue;
    const replacement = replacementFor(segment);
    found.push({
      index,
      length: segment.length,
      char: segment,
      codePoint: outside,
      ...(replacement === undefined ? {} : { replacement }),
    });
  }
  return found;
}

/**
 * Punctuation and spacing with an obvious GSM-7 equivalent. Deliberately short: only marks whose replacement reads
 * the same. Not here, and so only flagged:
 *   - letters, including modifier letters used as apostrophes (ʼ U+02BC, ʻ U+02BB), which are letters in some
 *     languages;
 *   - emoji and symbols (™ © ®);
 *   - fractions (1½ would read 11/2);
 *   - fullwidth forms and single guillemets (‹ ›), which have no one obvious equivalent.
 */
const EQUIVALENTS: ReadonlyMap<string, string> = new Map([
  // Single quotation marks, apostrophes and primes
  ["‘", "'"], // ‘ LEFT SINGLE QUOTATION MARK
  ["’", "'"], // ’ RIGHT SINGLE QUOTATION MARK
  ["‚", "'"], // ‚ SINGLE LOW-9 QUOTATION MARK
  ["‛", "'"], // ‛ SINGLE HIGH-REVERSED-9 QUOTATION MARK
  ["′", "'"], // ′ PRIME
  ["´", "'"], // ´ ACUTE ACCENT, typed as an apostrophe
  // Double quotation marks
  ["“", '"'], // “ LEFT DOUBLE QUOTATION MARK
  ["”", '"'], // ” RIGHT DOUBLE QUOTATION MARK
  ["„", '"'], // „ DOUBLE LOW-9 QUOTATION MARK
  ["‟", '"'], // ‟ DOUBLE HIGH-REVERSED-9 QUOTATION MARK
  ["″", '"'], // ″ DOUBLE PRIME
  ["«", '"'], // « LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
  ["»", '"'], // » RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
  // Hyphens, dashes and minus
  ["‐", "-"], // ‐ HYPHEN
  ["‑", "-"], // ‑ NON-BREAKING HYPHEN
  ["‒", "-"], // ‒ FIGURE DASH
  ["–", "-"], // – EN DASH
  ["—", "-"], // — EM DASH
  ["―", "-"], // ― HORIZONTAL BAR
  ["−", "-"], // − MINUS SIGN
  // Ellipsis, bullets, slash
  ["…", "..."], // … HORIZONTAL ELLIPSIS
  ["•", "-"], // • BULLET
  ["‣", "-"], // ‣ TRIANGULAR BULLET
  ["⁃", "-"], // ⁃ HYPHEN BULLET
  ["◦", "-"], // ◦ WHITE BULLET
  ["⁄", "/"], // ⁄ FRACTION SLASH
  // Spaces
  ["\u0009", " "], // CHARACTER TABULATION
  [" ", " "], // NO-BREAK SPACE
  [" ", " "], // EN QUAD
  [" ", " "], // EM QUAD
  [" ", " "], // EN SPACE
  [" ", " "], // EM SPACE
  [" ", " "], // THREE-PER-EM SPACE
  [" ", " "], // FOUR-PER-EM SPACE
  [" ", " "], // SIX-PER-EM SPACE
  [" ", " "], // FIGURE SPACE
  [" ", " "], // PUNCTUATION SPACE
  [" ", " "], // THIN SPACE
  [" ", " "], // HAIR SPACE
  [" ", " "], // NARROW NO-BREAK SPACE
  [" ", " "], // MEDIUM MATHEMATICAL SPACE
  ["　", " "], // IDEOGRAPHIC SPACE
  // Line breaks
  ["\u0085", "\n"], // NEXT LINE
  [" ", "\n"], // LINE SEPARATOR
  [" ", "\n"], // PARAGRAPH SEPARATOR
  // Invisible characters: removed
  ["­", ""], // SOFT HYPHEN
  ["​", ""], // ZERO WIDTH SPACE
  ["‌", ""], // ZERO WIDTH NON-JOINER
  ["‍", ""], // ZERO WIDTH JOINER, alone (inside an emoji sequence it is part of the emoji)
  ["‎", ""], // LEFT-TO-RIGHT MARK
  ["‏", ""], // RIGHT-TO-LEFT MARK
  ["⁠", ""], // WORD JOINER
  ["﻿", ""], // ZERO WIDTH NO-BREAK SPACE (byte order mark)
]);

/** The GSM-7 text a cluster can be replaced with, or undefined when it has no obvious equivalent. */
function replacementFor(cluster: string): string | undefined {
  // A decomposed letter (e + U+0301) whose composed form is GSM-7 (é) is the same text: offer the composed form.
  const composed = cluster.normalize("NFC");
  if (composed !== cluster && smsEncoding(composed) === "GSM-7") return composed;
  let out = "";
  for (const char of cluster) {
    if (gsm7Septets(char) !== null) out += char;
    else {
      const equivalent = EQUIVALENTS.get(char);
      if (equivalent === undefined) return undefined;
      out += equivalent;
    }
  }
  return out;
}

function firstNonGsmCodePoint(cluster: string): number | undefined {
  for (const char of cluster) {
    if (gsm7Septets(char) === null) return char.codePointAt(0);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Splitting

const CAPACITY: Record<SmsEncoding, { single: number; perPart: number }> = {
  "GSM-7": { single: GSM7_SINGLE_PART, perPart: GSM7_PER_PART },
  "UCS-2": { single: UCS2_SINGLE_PART, perPart: UCS2_PER_PART },
};

/** A run of `text` from `start` to `end` (UTF-16 offsets) that costs `units`. */
interface Span {
  start: number;
  end: number;
  units: number;
}

/** The pieces a part boundary may fall between: a character, an escape pair, a surrogate pair, a cluster. */
function unsplittable(text: string, encoding: SmsEncoding): Span[] {
  const spans: Span[] = [];
  if (encoding === "GSM-7") {
    // Every GSM-7 character is one code unit; an extension character costs its escape too.
    for (let i = 0; i < text.length; i++) spans.push({ start: i, end: i + 1, units: gsm7Septets(text[i]) ?? 0 });
    return spans;
  }
  for (const { segment, index } of graphemes(text)) {
    if (segment !== "\r\n" && segment.length <= UCS2_PER_PART) {
      spans.push({ start: index, end: index + segment.length, units: segment.length });
      continue;
    }
    // CRLF, and a cluster too long for any part, split between code points. A surrogate pair is one code point.
    let at = index;
    for (const codePoint of segment) {
      spans.push({ start: at, end: at + codePoint.length, units: codePoint.length });
      at += codePoint.length;
    }
  }
  return spans;
}

function split(text: string): { encoding: SmsEncoding; parts: Span[] } {
  const encoding = smsEncoding(text);
  const pieces = unsplittable(text, encoding);
  const total = pieces.reduce((sum, piece) => sum + piece.units, 0);
  const { single, perPart } = CAPACITY[encoding];
  if (total === 0) return { encoding, parts: [] };
  if (total <= single) return { encoding, parts: [{ start: 0, end: text.length, units: total }] };

  const parts: Span[] = [];
  let current: Span | undefined;
  for (const piece of pieces) {
    if (!current || current.units + piece.units > perPart) {
      current = { start: piece.start, end: piece.start, units: 0 };
      parts.push(current);
    }
    current.end = piece.end;
    current.units += piece.units;
  }
  return { encoding, parts };
}

// ---------------------------------------------------------------------------------------------------------------
// Grapheme clusters: graphemes.ts, Unicode 17.0's rules and data, never the runtime's

function countGraphemes(text: string): number {
  if (smsEncoding(text) === "GSM-7") {
    // Every GSM-7 character is its own cluster, except a CRLF, which is one.
    let crlf = 0;
    for (let i = text.indexOf("\r\n"); i !== -1; i = text.indexOf("\r\n", i + 2)) crlf++;
    return text.length - crlf;
  }
  return graphemeCount(text);
}
