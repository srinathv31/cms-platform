import { describe, expect, it } from "vitest";
import {
  GSM7_DEFAULT_ALPHABET,
  GSM7_EXTENSION_TABLE,
  GSM7_PER_PART,
  GSM7_SINGLE_PART,
  SMS_MAX_PARTS,
  UCS2_PER_PART,
  UCS2_SINGLE_PART,
  gsm7Septets,
  nonGsmCharacters,
  smsEncoding,
  smsLength,
  smsParts,
  type NonGsmCharacter,
} from "./gsm7";

// Unicode's GSM0338.TXT (table version 2.0), every mapping line but the escape, as [GSM code, Unicode code point].
// Copied from the file, not from gsm7.ts, so the two transcriptions check each other.
const UNICODE_DEFAULT_ALPHABET: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x0040], // COMMERCIAL AT
  [0x01, 0x00A3], // POUND SIGN
  [0x02, 0x0024], // DOLLAR SIGN
  [0x03, 0x00A5], // YEN SIGN
  [0x04, 0x00E8], // LATIN SMALL LETTER E WITH GRAVE
  [0x05, 0x00E9], // LATIN SMALL LETTER E WITH ACUTE
  [0x06, 0x00F9], // LATIN SMALL LETTER U WITH GRAVE
  [0x07, 0x00EC], // LATIN SMALL LETTER I WITH GRAVE
  [0x08, 0x00F2], // LATIN SMALL LETTER O WITH GRAVE
  [0x09, 0x00E7], // LATIN SMALL LETTER C WITH CEDILLA
  [0x0A, 0x000A], // LINE FEED
  [0x0B, 0x00D8], // LATIN CAPITAL LETTER O WITH STROKE
  [0x0C, 0x00F8], // LATIN SMALL LETTER O WITH STROKE
  [0x0D, 0x000D], // CARRIAGE RETURN
  [0x0E, 0x00C5], // LATIN CAPITAL LETTER A WITH RING ABOVE
  [0x0F, 0x00E5], // LATIN SMALL LETTER A WITH RING ABOVE
  [0x10, 0x0394], // GREEK CAPITAL LETTER DELTA
  [0x11, 0x005F], // LOW LINE
  [0x12, 0x03A6], // GREEK CAPITAL LETTER PHI
  [0x13, 0x0393], // GREEK CAPITAL LETTER GAMMA
  [0x14, 0x039B], // GREEK CAPITAL LETTER LAMDA
  [0x15, 0x03A9], // GREEK CAPITAL LETTER OMEGA
  [0x16, 0x03A0], // GREEK CAPITAL LETTER PI
  [0x17, 0x03A8], // GREEK CAPITAL LETTER PSI
  [0x18, 0x03A3], // GREEK CAPITAL LETTER SIGMA
  [0x19, 0x0398], // GREEK CAPITAL LETTER THETA
  [0x1A, 0x039E], // GREEK CAPITAL LETTER XI
  [0x1C, 0x00C6], // LATIN CAPITAL LETTER AE
  [0x1D, 0x00E6], // LATIN SMALL LETTER AE
  [0x1E, 0x00DF], // LATIN SMALL LETTER SHARP S (German)
  [0x1F, 0x00C9], // LATIN CAPITAL LETTER E WITH ACUTE
  [0x20, 0x0020], // SPACE
  [0x21, 0x0021], // EXCLAMATION MARK
  [0x22, 0x0022], // QUOTATION MARK
  [0x23, 0x0023], // NUMBER SIGN
  [0x24, 0x00A4], // CURRENCY SIGN
  [0x25, 0x0025], // PERCENT SIGN
  [0x26, 0x0026], // AMPERSAND
  [0x27, 0x0027], // APOSTROPHE
  [0x28, 0x0028], // LEFT PARENTHESIS
  [0x29, 0x0029], // RIGHT PARENTHESIS
  [0x2A, 0x002A], // ASTERISK
  [0x2B, 0x002B], // PLUS SIGN
  [0x2C, 0x002C], // COMMA
  [0x2D, 0x002D], // HYPHEN-MINUS
  [0x2E, 0x002E], // FULL STOP
  [0x2F, 0x002F], // SOLIDUS
  [0x30, 0x0030], // DIGIT ZERO
  [0x31, 0x0031], // DIGIT ONE
  [0x32, 0x0032], // DIGIT TWO
  [0x33, 0x0033], // DIGIT THREE
  [0x34, 0x0034], // DIGIT FOUR
  [0x35, 0x0035], // DIGIT FIVE
  [0x36, 0x0036], // DIGIT SIX
  [0x37, 0x0037], // DIGIT SEVEN
  [0x38, 0x0038], // DIGIT EIGHT
  [0x39, 0x0039], // DIGIT NINE
  [0x3A, 0x003A], // COLON
  [0x3B, 0x003B], // SEMICOLON
  [0x3C, 0x003C], // LESS-THAN SIGN
  [0x3D, 0x003D], // EQUALS SIGN
  [0x3E, 0x003E], // GREATER-THAN SIGN
  [0x3F, 0x003F], // QUESTION MARK
  [0x40, 0x00A1], // INVERTED EXCLAMATION MARK
  [0x41, 0x0041], // LATIN CAPITAL LETTER A
  [0x42, 0x0042], // LATIN CAPITAL LETTER B
  [0x43, 0x0043], // LATIN CAPITAL LETTER C
  [0x44, 0x0044], // LATIN CAPITAL LETTER D
  [0x45, 0x0045], // LATIN CAPITAL LETTER E
  [0x46, 0x0046], // LATIN CAPITAL LETTER F
  [0x47, 0x0047], // LATIN CAPITAL LETTER G
  [0x48, 0x0048], // LATIN CAPITAL LETTER H
  [0x49, 0x0049], // LATIN CAPITAL LETTER I
  [0x4A, 0x004A], // LATIN CAPITAL LETTER J
  [0x4B, 0x004B], // LATIN CAPITAL LETTER K
  [0x4C, 0x004C], // LATIN CAPITAL LETTER L
  [0x4D, 0x004D], // LATIN CAPITAL LETTER M
  [0x4E, 0x004E], // LATIN CAPITAL LETTER N
  [0x4F, 0x004F], // LATIN CAPITAL LETTER O
  [0x50, 0x0050], // LATIN CAPITAL LETTER P
  [0x51, 0x0051], // LATIN CAPITAL LETTER Q
  [0x52, 0x0052], // LATIN CAPITAL LETTER R
  [0x53, 0x0053], // LATIN CAPITAL LETTER S
  [0x54, 0x0054], // LATIN CAPITAL LETTER T
  [0x55, 0x0055], // LATIN CAPITAL LETTER U
  [0x56, 0x0056], // LATIN CAPITAL LETTER V
  [0x57, 0x0057], // LATIN CAPITAL LETTER W
  [0x58, 0x0058], // LATIN CAPITAL LETTER X
  [0x59, 0x0059], // LATIN CAPITAL LETTER Y
  [0x5A, 0x005A], // LATIN CAPITAL LETTER Z
  [0x5B, 0x00C4], // LATIN CAPITAL LETTER A WITH DIAERESIS
  [0x5C, 0x00D6], // LATIN CAPITAL LETTER O WITH DIAERESIS
  [0x5D, 0x00D1], // LATIN CAPITAL LETTER N WITH TILDE
  [0x5E, 0x00DC], // LATIN CAPITAL LETTER U WITH DIAERESIS
  [0x5F, 0x00A7], // SECTION SIGN
  [0x60, 0x00BF], // INVERTED QUESTION MARK
  [0x61, 0x0061], // LATIN SMALL LETTER A
  [0x62, 0x0062], // LATIN SMALL LETTER B
  [0x63, 0x0063], // LATIN SMALL LETTER C
  [0x64, 0x0064], // LATIN SMALL LETTER D
  [0x65, 0x0065], // LATIN SMALL LETTER E
  [0x66, 0x0066], // LATIN SMALL LETTER F
  [0x67, 0x0067], // LATIN SMALL LETTER G
  [0x68, 0x0068], // LATIN SMALL LETTER H
  [0x69, 0x0069], // LATIN SMALL LETTER I
  [0x6A, 0x006A], // LATIN SMALL LETTER J
  [0x6B, 0x006B], // LATIN SMALL LETTER K
  [0x6C, 0x006C], // LATIN SMALL LETTER L
  [0x6D, 0x006D], // LATIN SMALL LETTER M
  [0x6E, 0x006E], // LATIN SMALL LETTER N
  [0x6F, 0x006F], // LATIN SMALL LETTER O
  [0x70, 0x0070], // LATIN SMALL LETTER P
  [0x71, 0x0071], // LATIN SMALL LETTER Q
  [0x72, 0x0072], // LATIN SMALL LETTER R
  [0x73, 0x0073], // LATIN SMALL LETTER S
  [0x74, 0x0074], // LATIN SMALL LETTER T
  [0x75, 0x0075], // LATIN SMALL LETTER U
  [0x76, 0x0076], // LATIN SMALL LETTER V
  [0x77, 0x0077], // LATIN SMALL LETTER W
  [0x78, 0x0078], // LATIN SMALL LETTER X
  [0x79, 0x0079], // LATIN SMALL LETTER Y
  [0x7A, 0x007A], // LATIN SMALL LETTER Z
  [0x7B, 0x00E4], // LATIN SMALL LETTER A WITH DIAERESIS
  [0x7C, 0x00F6], // LATIN SMALL LETTER O WITH DIAERESIS
  [0x7D, 0x00F1], // LATIN SMALL LETTER N WITH TILDE
  [0x7E, 0x00FC], // LATIN SMALL LETTER U WITH DIAERESIS
  [0x7F, 0x00E0], // LATIN SMALL LETTER A WITH GRAVE
];

// GSM0338.TXT's extension rows (0x1Bnn), as [code after the escape, Unicode code point].
const UNICODE_EXTENSION_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0x0A, 0x000C], // FORM FEED
  [0x14, 0x005E], // CIRCUMFLEX ACCENT
  [0x28, 0x007B], // LEFT CURLY BRACKET
  [0x29, 0x007D], // RIGHT CURLY BRACKET
  [0x2F, 0x005C], // REVERSE SOLIDUS
  [0x3C, 0x005B], // LEFT SQUARE BRACKET
  [0x3D, 0x007E], // TILDE
  [0x3E, 0x005D], // RIGHT SQUARE BRACKET
  [0x40, 0x007C], // VERTICAL LINE
  [0x65, 0x20AC], // EURO SIGN
];

const FAMILY = "👩‍👩‍👧‍👦"; // U+1F469 ZWJ U+1F469 ZWJ U+1F467 ZWJ U+1F466: 4 surrogate pairs and 3 joiners
const DECOMPOSED_E = "é"; // e + COMBINING ACUTE ACCENT, which composes to é

/** Applies each offered replacement, last first so earlier offsets stay true. */
function applyReplacements(text: string, found: NonGsmCharacter[]): string {
  let out = text;
  for (const { index, length, replacement } of [...found].reverse()) {
    if (replacement !== undefined) out = out.slice(0, index) + replacement + out.slice(index + length);
  }
  return out;
}

describe("the GSM-7 tables", () => {
  it("hold every character of Unicode's default alphabet at its code, 1 septet each", () => {
    for (const [code, codePoint] of UNICODE_DEFAULT_ALPHABET) {
      const char = String.fromCodePoint(codePoint);
      if (code === 0x09) continue; // see the next test
      expect(GSM7_DEFAULT_ALPHABET.get(char), `0x${code.toString(16)} U+${codePoint.toString(16)}`).toBe(code);
      expect(gsm7Septets(char)).toBe(1);
      expect(smsEncoding(char)).toBe("GSM-7");
      expect(smsLength(char)).toMatchObject({ encoding: "GSM-7", units: 1, parts: 1 });
    }
    expect(GSM7_DEFAULT_ALPHABET.size).toBe(127);
    expect(new Set(GSM7_DEFAULT_ALPHABET.values())).toEqual(
      new Set(Array.from({ length: 128 }, (_, code) => code).filter((code) => code !== 0x1b)),
    );
  });

  it("take 3GPP's Ç at 0x09, not Unicode's ç", () => {
    expect(UNICODE_DEFAULT_ALPHABET.find(([code]) => code === 0x09)?.[1]).toBe(0xe7);
    expect(GSM7_DEFAULT_ALPHABET.get("Ç")).toBe(0x09);
    expect(smsEncoding("Ç")).toBe("GSM-7");
    expect(smsEncoding("ç")).toBe("UCS-2");
    expect(nonGsmCharacters("garçon")).toEqual([{ index: 3, length: 1, char: "ç", codePoint: 0xe7 }]);
  });

  it("hold every character of the extension table at its code, 2 septets each", () => {
    for (const [code, codePoint] of UNICODE_EXTENSION_TABLE) {
      const char = String.fromCodePoint(codePoint);
      expect(GSM7_EXTENSION_TABLE.get(char), `0x1B${code.toString(16)}`).toBe(code);
      expect(gsm7Septets(char)).toBe(2);
      expect(smsLength(char)).toMatchObject({ encoding: "GSM-7", units: 2, characters: 1, parts: 1 });
    }
    expect([...GSM7_EXTENSION_TABLE.keys()].sort()).toEqual([..."\f^{}\\[~]|€"].sort());
  });

  it("are the only GSM-7 characters in the Basic Multilingual Plane", () => {
    const gsm: string[] = [];
    for (let unit = 0; unit <= 0xffff; unit++) {
      const char = String.fromCharCode(unit);
      if (smsEncoding(char) === "GSM-7") gsm.push(char);
    }
    expect(gsm).toHaveLength(127 + 10);
    expect(gsm.every((char) => GSM7_DEFAULT_ALPHABET.has(char) || GSM7_EXTENSION_TABLE.has(char))).toBe(true);
  });

  it("leave out the escape's display form and the Greek capitals that share a Latin glyph", () => {
    expect(smsEncoding(" ")).toBe("UCS-2"); // NBSP, GSM0338.TXT's display form of 0x1B
    expect(smsEncoding("\u001b")).toBe("UCS-2");
    expect(smsEncoding("Α")).toBe("UCS-2"); // GREEK CAPITAL LETTER ALPHA, not A
    expect(smsEncoding("Ω")).toBe("UCS-2"); // OHM SIGN, not GREEK CAPITAL LETTER OMEGA
    expect(smsEncoding("Ω")).toBe("GSM-7");
  });
});

describe("smsEncoding", () => {
  it("is GSM-7 for the empty text", () => {
    expect(smsEncoding("")).toBe("GSM-7");
  });

  it("keeps é in GSM-7, and one á, ’ or emoji makes the whole message UCS-2", () => {
    expect(smsEncoding("Café crème, à bientôt")).toBe("UCS-2"); // ô
    expect(smsEncoding("Café crème, à la carte")).toBe("GSM-7");
    expect(smsEncoding("José García")).toBe("UCS-2"); // í
    expect(smsEncoding("Ana Gómez")).toBe("UCS-2"); // ó
    expect(smsEncoding("Your payment is due")).toBe("GSM-7");
    expect(smsEncoding("Your payment’s due")).toBe("UCS-2");
    expect(smsEncoding("Paid 🎉")).toBe("UCS-2");
  });
});

describe("smsLength at the part boundaries", () => {
  it("fits 160 GSM-7 septets in one part, and splits 161 into parts of 153", () => {
    expect(smsLength("a".repeat(160))).toEqual({
      encoding: "GSM-7",
      units: 160,
      characters: 160,
      parts: 1,
      perPart: 160,
      remainingInPart: 0,
    });
    expect(smsLength("a".repeat(161))).toEqual({
      encoding: "GSM-7",
      units: 161,
      characters: 161,
      parts: 2,
      perPart: 153,
      remainingInPart: 145,
    });
  });

  it("holds 306 GSM-7 septets in 2 parts and 307 in 3", () => {
    expect(smsLength("a".repeat(153))).toMatchObject({ parts: 1, perPart: 160, remainingInPart: 7 });
    expect(smsLength("a".repeat(306))).toMatchObject({ parts: 2, perPart: 153, remainingInPart: 0 });
    expect(smsLength("a".repeat(307))).toMatchObject({ parts: 3, perPart: 153, remainingInPart: 152 });
    expect(smsParts("a".repeat(307)).map((part) => part.length)).toEqual([153, 153, 1]);
  });

  it("fits 70 UCS-2 units in one part, and splits 71 into parts of 67", () => {
    expect(smsLength("á".repeat(70))).toEqual({
      encoding: "UCS-2",
      units: 70,
      characters: 70,
      parts: 1,
      perPart: 70,
      remainingInPart: 0,
    });
    expect(smsLength("á".repeat(71))).toEqual({
      encoding: "UCS-2",
      units: 71,
      characters: 71,
      parts: 2,
      perPart: 67,
      remainingInPart: 63,
    });
  });

  it("holds 134 UCS-2 units in 2 parts and 135 in 3", () => {
    expect(smsLength("á".repeat(67))).toMatchObject({ parts: 1, perPart: 70, remainingInPart: 3 });
    expect(smsLength("á".repeat(134))).toMatchObject({ parts: 2, perPart: 67, remainingInPart: 0 });
    expect(smsLength("á".repeat(135))).toMatchObject({ parts: 3, perPart: 67, remainingInPart: 66 });
    expect(smsParts("á".repeat(135)).map((part) => part.length)).toEqual([67, 67, 1]);
  });

  it("counts each extension character as 2 septets", () => {
    expect(smsLength("€".repeat(80))).toMatchObject({ units: 160, characters: 80, parts: 1, remainingInPart: 0 });
    // A part of 153 septets holds 76 of them (152); the 77th starts the next part.
    expect(smsLength("€".repeat(81))).toMatchObject({ units: 162, parts: 2, remainingInPart: 143 });
    expect(smsParts("€".repeat(81)).map((part) => part.length)).toEqual([76, 5]);
    expect(smsLength("{Amount} [due] ~ 5|6 ^ \\")).toMatchObject({ encoding: "GSM-7", units: 24 + 8, characters: 24 });
  });

  it("derives the limits from 140 octets and a 6-octet concatenation header", () => {
    expect(GSM7_SINGLE_PART).toBe(Math.floor((140 * 8) / 7));
    expect(GSM7_PER_PART).toBe(Math.floor(((140 - 6) * 8) / 7));
    expect(UCS2_SINGLE_PART).toBe(140 / 2);
    expect(UCS2_PER_PART).toBe((140 - 6) / 2);
  });

  it("reports 10 GSM-7 parts at 1,530 septets and 11 past it, against SMS_MAX_PARTS", () => {
    expect(SMS_MAX_PARTS).toBe(10);
    expect(smsLength("a".repeat(10 * 153)).parts).toBe(SMS_MAX_PARTS);
    expect(smsLength("a".repeat(10 * 153 + 1)).parts).toBe(SMS_MAX_PARTS + 1);
    expect(smsLength("á".repeat(10 * 67)).parts).toBe(SMS_MAX_PARTS);
    expect(smsLength("á".repeat(10 * 67 + 1)).parts).toBe(SMS_MAX_PARTS + 1);
  });
});

describe("one character outside GSM-7", () => {
  it("turns a 140-character message from 1 part into 3", () => {
    const plain = "a".repeat(140);
    expect(smsLength(plain)).toMatchObject({ encoding: "GSM-7", units: 140, parts: 1 });
    const curly = "a".repeat(70) + "’" + "a".repeat(69);
    expect(curly).toHaveLength(140);
    expect(smsLength(curly)).toMatchObject({ encoding: "UCS-2", units: 140, parts: 3, perPart: 67, remainingInPart: 61 });
  });

  it("turns a message of 71 to 134 characters from 1 part into 2", () => {
    expect(smsLength("a".repeat(134)).parts).toBe(1);
    expect(smsLength("’" + "a".repeat(133))).toMatchObject({ encoding: "UCS-2", units: 134, parts: 2 });
    expect(smsLength("’" + "a".repeat(70)).parts).toBe(2);
    expect(smsLength("’" + "a".repeat(69)).parts).toBe(1);
  });

  it("costs every GSM-7 character 1 unit in UCS-2, extension characters included", () => {
    expect(smsLength("€{’")).toMatchObject({ encoding: "UCS-2", units: 3, characters: 3 });
  });
});

describe("smsParts never cuts a character in two", () => {
  it("moves an extension character whole to the next part", () => {
    const text = "a".repeat(152) + "€" + "a".repeat(7);
    expect(smsLength(text)).toMatchObject({ units: 161, parts: 2, remainingInPart: 144 });
    expect(smsParts(text)).toEqual(["a".repeat(152), "€" + "a".repeat(7)]);
  });

  it("can need a part more than the septet count alone suggests", () => {
    const text = "a".repeat(152) + "€" + "a".repeat(152); // 306 septets: 2 parts of 153 if € could straddle
    expect(smsLength(text)).toMatchObject({ units: 306, parts: 3, remainingInPart: 152 });
    expect(smsParts(text)).toEqual(["a".repeat(152), "€" + "a".repeat(151), "a"]);
  });

  it("moves a surrogate pair whole to the next part", () => {
    const text = "a".repeat(66) + "😀" + "aaa";
    expect(smsLength(text)).toMatchObject({ encoding: "UCS-2", units: 71, characters: 70, parts: 2 });
    expect(smsParts(text)).toEqual(["a".repeat(66), "😀aaa"]);
    expect(smsParts("a".repeat(69) + "😀")).toEqual(["a".repeat(67), "aa😀"]);
    expect(smsLength("a".repeat(68) + "😀")).toMatchObject({ units: 70, parts: 1 });
  });

  it("moves a ZWJ emoji sequence whole to the next part", () => {
    expect(FAMILY).toHaveLength(11);
    const text = "a".repeat(60) + FAMILY + "a".repeat(10);
    expect(smsLength(text)).toMatchObject({ encoding: "UCS-2", units: 81, characters: 71, parts: 2 });
    expect(smsParts(text)).toEqual(["a".repeat(60), FAMILY + "a".repeat(10)]);
  });

  it("keeps a flag and a letter with its combining accent whole", () => {
    expect(smsParts("a".repeat(65) + "🇺🇸" + "a".repeat(5))).toEqual(["a".repeat(65), "🇺🇸" + "a".repeat(5)]);
    expect(smsParts("a".repeat(66) + DECOMPOSED_E + "a".repeat(5))).toEqual(["a".repeat(66), DECOMPOSED_E + "a".repeat(5)]);
  });

  it("may split a CRLF between CR and LF, as Twilio's calculator does", () => {
    expect(smsParts("a".repeat(152) + "\r\n" + "a".repeat(7))).toEqual(["a".repeat(152) + "\r", "\n" + "a".repeat(7)]);
    expect(smsParts("á".repeat(66) + "\r\n" + "a".repeat(5))).toEqual(["á".repeat(66) + "\r", "\n" + "a".repeat(5)]);
  });

  it("splits a cluster longer than a whole part between code points", () => {
    const zalgo = "a" + "́".repeat(80); // one grapheme cluster of 81 units
    expect(smsParts(zalgo).map((part) => part.length)).toEqual([67, 14]);
    expect(smsParts(zalgo).join("")).toBe(zalgo);
  });

  it("joins back to the text, with every part within its capacity", () => {
    const texts = [
      "Coral Offers: your payment of {Amount} is due 12/31. Pay at coral.example/pay\nReply STOP to opt out.",
      ("Hi Gómez, your card ending 4417 was used abroad 🌍 " + FAMILY + " ").repeat(9),
      ("€[x] ".repeat(40) + "\r\n").repeat(3),
      ("a’" + "🇺🇸" + DECOMPOSED_E + "😀").repeat(50),
    ];
    for (const text of texts) {
      const length = smsLength(text);
      const parts = smsParts(text);
      expect(parts.join("")).toBe(text);
      expect(parts).toHaveLength(length.parts);
      for (const part of parts) {
        const units = length.encoding === "GSM-7" ? smsLength(part).units : part.length;
        expect(units).toBeLessThanOrEqual(length.perPart);
      }
    }
  });
});

describe("the empty text", () => {
  it("has no parts and a whole part's room", () => {
    expect(smsLength("")).toEqual({
      encoding: "GSM-7",
      units: 0,
      characters: 0,
      parts: 0,
      perPart: 160,
      remainingInPart: 160,
    });
    expect(smsParts("")).toEqual([]);
    expect(nonGsmCharacters("")).toEqual([]);
  });
});

describe("characters", () => {
  it("counts what a reader sees: a cluster is 1, a CRLF is 1", () => {
    expect(smsLength("Gómez " + FAMILY)).toMatchObject({ units: 6 + 11, characters: 7 });
    expect(smsLength("a\r\nb")).toEqual({
      encoding: "GSM-7",
      units: 4,
      characters: 3,
      parts: 1,
      perPart: 160,
      remainingInPart: 156,
    });
    expect(smsLength("\r\r\n\n")).toMatchObject({ units: 4, characters: 3 });
    expect(smsLength("🇺🇸" + DECOMPOSED_E)).toMatchObject({ units: 6, characters: 2 });
  });
});

describe("nonGsmCharacters", () => {
  it("finds nothing in a GSM-7 text", () => {
    expect(nonGsmCharacters("Coral Offers: pay {Amount} at coral.example. Reply STOP to opt out.")).toEqual([]);
  });

  it("gives each character's UTF-16 offset, length and code point", () => {
    expect(nonGsmCharacters("Pay now 😀 or don’t")).toEqual([
      { index: 3, length: 1, char: " ", codePoint: 0xa0, replacement: " " },
      { index: 8, length: 2, char: "😀", codePoint: 0x1f600 },
      { index: 17, length: 1, char: "’", codePoint: 0x2019, replacement: "'" },
    ]);
  });

  it("flags a ZWJ emoji sequence once, as one character, with no replacement", () => {
    expect(nonGsmCharacters("Hi " + FAMILY + "!")).toEqual([{ index: 3, length: 11, char: FAMILY, codePoint: 0x1f469 }]);
  });

  it("flags a stray joiner with the character it follows, and removes it", () => {
    expect(nonGsmCharacters("a‍b")).toEqual([
      { index: 0, length: 2, char: "a‍", codePoint: 0x200d, replacement: "a" },
    ]);
  });

  it("offers the obvious GSM-7 equivalent for punctuation and spacing", () => {
    const cases: Array<[string, string]> = [
      ["‘", "'"],
      ["’", "'"],
      ["‚", "'"],
      ["‛", "'"],
      ["′", "'"],
      ["´", "'"],
      ["“", '"'],
      ["”", '"'],
      ["„", '"'],
      ["‟", '"'],
      ["″", '"'],
      ["«", '"'],
      ["»", '"'],
      ["‐", "-"],
      ["‑", "-"],
      ["‒", "-"],
      ["–", "-"],
      ["—", "-"],
      ["―", "-"],
      ["−", "-"],
      ["…", "..."],
      ["•", "-"],
      ["‣", "-"],
      ["⁃", "-"],
      ["◦", "-"],
      ["⁄", "/"],
      ["\t", " "],
      [" ", " "],
      [" ", " "],
      [" ", " "],
      [" ", " "],
      [" ", " "],
      [" ", " "],
      [" ", " "],
      ["　", " "],
      [" ", "\n"],
      [" ", "\n"],
      ["­", ""],
      ["​", ""],
      ["⁠", ""],
      ["﻿", ""],
    ];
    for (const [char, replacement] of cases) {
      const found = nonGsmCharacters(`x${char}y`);
      expect(found, `U+${char.codePointAt(0)?.toString(16)}`).toEqual([
        { index: 1, length: char.length, char, codePoint: char.codePointAt(0), replacement },
      ]);
      expect(smsEncoding(`x${replacement}y`)).toBe("GSM-7");
    }
  });

  it("never offers one for a letter, an emoji or a symbol", () => {
    for (const char of ["á", "í", "ó", "ú", "ç", "ő", "Ł", "ж", "中", "ʼ", "ʻ", "😀", "🎉", "™", "©", "½", "Α"]) {
      const [found] = nonGsmCharacters(char);
      expect(found, char).toBeDefined();
      expect(found, char).not.toHaveProperty("replacement");
    }
  });

  it("offers a decomposed letter its composed form when that is GSM-7, and nothing when it isn't", () => {
    expect(nonGsmCharacters("Caf" + DECOMPOSED_E)).toEqual([
      { index: 3, length: 2, char: DECOMPOSED_E, codePoint: 0x301, replacement: "é" },
    ]);
    expect(nonGsmCharacters("á")).toEqual([{ index: 0, length: 2, char: "á", codePoint: 0x301 }]);
    // OHM SIGN is canonically GREEK CAPITAL LETTER OMEGA, which is GSM-7.
    expect(nonGsmCharacters("Ω")).toEqual([
      { index: 0, length: 1, char: "Ω", codePoint: 0x2126, replacement: "Ω" },
    ]);
  });

  it("makes text pasted from a word processor GSM-7 once every replacement is applied", () => {
    const pasted = "“Don’t miss it” – your offer ends soon… Reply​ STOP";
    const fixed = applyReplacements(pasted, nonGsmCharacters(pasted));
    expect(fixed).toBe('"Don\'t miss it" - your offer ends soon... Reply STOP');
    expect(smsEncoding(fixed)).toBe("GSM-7");
  });

  it("is empty exactly when the text is GSM-7, and each entry is where it says", () => {
    const texts = [
      "plain",
      "Gómez",
      "a\r\nb",
      "€{[|]}~^\\\f",
      FAMILY,
      "x‍y",
      "🇺🇸 " + DECOMPOSED_E + " ’ … —   ç Ç",
      "\ud800 lone surrogate",
    ];
    for (const text of texts) {
      const found = nonGsmCharacters(text);
      expect(found.length === 0, text).toBe(smsEncoding(text) === "GSM-7");
      for (const { index, length, char, codePoint } of found) {
        expect(text.slice(index, index + length)).toBe(char);
        expect([...char].map((c) => c.codePointAt(0))).toContain(codePoint);
        expect(gsm7Septets(String.fromCodePoint(codePoint))).toBeNull();
      }
    }
  });
});
