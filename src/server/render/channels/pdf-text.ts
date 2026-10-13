import "server-only";

import type { RenderInline } from "@/domain/render/types";
import {
  canDraw,
  hangsAtLineStart,
  measure,
  type FontFace,
  type GlyphCheck,
} from "./pdf-fonts";
import type { TypeSpec } from "./pdf-styles";

// Line breaking for the PDF channel. The adapter breaks every line itself, greedily, the way a
// browser sets ragged-right `white-space: pre-wrap` text, and hands react-pdf one line per "\n".
// The rules, with where the spec states them (docs/render-spec.md; "section 4" is "Text: characters,
// spaces, breaks and blank lines", "section 10" is "Channels"):
//
// - react-pdf's own breaker (Knuth-Plass) squeezes word spaces by up to a third to fit one more
//   word, even in left-aligned text, which leaves some lines visibly tighter than their
//   neighbours. Lines measured here never exceed the box, so spacing stays even.
// - Spaces are content (section 4, "Spaces"); every U+0020 stays a U+0020. Runs of spaces keep their
//   width. Spaces of every kind (U+0020, the no-break space, the en, em, thin and other Unicode
//   spaces) that begin a line the author started (the paragraph's start, or after a hard break,
//   section 4 "Hard breaks") are set as a run of their own, and print where they were typed:
//   react-pdf hangs the ones it counts as white space into the margin (and counts them against the
//   line), so the run gets a first-line indent of exactly their width (pdf-fonts.ts,
//   hangsAtLineStart). If those spaces and the first word don't fit on the line, the spaces stay
//   alone on it and the word starts the next. The spaces where a line wraps, and spaces at the end of
//   a line past its edge, are absorbed, as a browser hangs them; they are never carried to the start
//   of the next line. Lines wrap only at U+0020; the other spaces hold their words together, as
//   no-break spaces do.
// - A space is never "a character the PDF can't draw" (section 10, "PDF", Spaces): a Unicode space the
//   font has no glyph for (an em space, a thin space, ...) is set as the face's no-break space,
//   widened or narrowed to the space's own width (SPACE_WIDTHS) with letter spacing.
// - Nothing is ever inserted (section 10, "PDF", line wrapping). Dictionary hyphenation is off
//   (pdf-fonts.ts) and every <Text> forbids react-pdf's run-boundary breaks, so
//   "Featherstonehaugh-Villiers" and "Alexandria-Marguerite," stay whole. A single token wider than
//   its line (a long URL, a long name in a narrow table cell) starts a new line and is cut there,
//   bare: after a hyphen, slash or other separator when one fits, otherwise between two characters.
//   Nothing runs past the margin (except a lone glyph wider than its whole box).
// - A short resolved variable never wraps mid-value ("September 30, 2027", "District of
//   Columbia"; section 10, "PDF", line wrapping): its spaces aren't break points. Its characters are
//   left exactly as they are.
//
// Measurements use the same embedded fonts react-pdf sets the text with (fontkit, with kerning).
// `measure` and `hangsAtLineStart` (pdf-fonts.ts) are the two parts that depend on the font library;
// everything else here is arithmetic on the widths they return. Layout is not compared across
// engines (section 10), so a second engine may choose other breaks, but this is the algorithm the
// Node engine uses, written so that it can be ported step by step: `breakLines` is the driver,
// `placeBreak`, `placeLead` and `placeWord` are its three cases, and `applyEdits` makes the changes.

/** A styled run, ready for a react-pdf <Text>. Line breaks are "\n" inside `text`. */
export interface Piece {
  kind: "text";
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  href?: string;
  /**
   * Set on the first run of spaces that begins a line: a first-line indent of the width react-pdf
   * would hang into the margin, so the spaces print where they were typed.
   */
  indent?: number;
  /**
   * Extra advance after each character, in points (react-pdf's letterSpacing): set on a run of one
   * Unicode space the font can't draw, set as no-break spaces of that space's width.
   */
  spacing?: number;
  /**
   * Set by `prepareText` on the run of spaces that begins a line the author started. `breakLines`
   * sets it as one unit, apart from the words (rule: spaces, above).
   */
  isLead?: true;
  /**
   * Set by `prepareText` on the pieces of a short variable's value: its spaces aren't break points
   * (rule: a short variable never wraps mid-value, above).
   */
  isJoined?: true;
}

export type PreparedInline = Piece | { kind: "break" };

export interface PreparedText {
  inlines: PreparedInline[];
  /** Lines the text will set in. */
  lines: number;
}

const NBSP = "\u00A0";
/**
 * Spaces of every kind (Unicode's space separators): a line the author began keeps those it starts
 * with. The same list as the removal rule's blank spaces (docs/render-spec.md section 4).
 */
const LEADING_SPACES = /^[\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/;
/**
 * The width of each Unicode space no face has a glyph for, in ems of the face's size, or the width
 * of the character it matches ("0" for the figure space, "." for the punctuation space, " " for the
 * Ogham space mark outside Ogham). Typographic convention, as browsers' fallback fonts set them.
 */
const SPACE_WIDTHS: ReadonlyMap<number, number | string> = new Map<
  number,
  number | string
>([
  [0x1680, " "],
  [0x2000, 1 / 2], // en quad
  [0x2001, 1], // em quad
  [0x2002, 1 / 2], // en space
  [0x2003, 1], // em space
  [0x2004, 1 / 3], // three-per-em space
  [0x2005, 1 / 4], // four-per-em space
  [0x2006, 1 / 6], // six-per-em space
  [0x2007, "0"], // figure space
  [0x2008, "."], // punctuation space
  [0x2009, 1 / 5], // thin space
  [0x200a, 1 / 10], // hair space
  [0x202f, 1 / 5], // narrow no-break space
  [0x205f, 4 / 18], // medium mathematical space
  [0x3000, 1], // ideographic space
]);
/** Slack kept between a measured line and its box, for rounding. */
const SAFETY = 1;
/** A variable keeps its words together up to this many words. */
const MAX_JOINED_WORDS = 4;
/** A separator cut is preferred unless it leaves the line less than this full. */
const MIN_SEPARATOR_FILL = 0.4;

const SEPARATOR = new Set([
  " ",
  "-",
  "/",
  ".",
  "_",
  "?",
  "&",
  "=",
  "#",
  ":",
  ",",
  ";",
  "+",
  "~",
  "|",
  "\\",
  "@",
  NBSP,
  "–",
  "—",
]);
/** A combining mark stays on the line of the character it sits on. */
const MARK = /\p{M}/u;

export const faceOf = (
  spec: TypeSpec,
  piece: Pick<Piece, "bold" | "italic">,
): FontFace => ({
  family: spec.family,
  weight: piece.bold ? 700 : spec.weight,
  italic: piece.italic,
});

/**
 * Resolves marks and breaks the text into lines for a box `width` points wide. Every character is
 * checked against the face that will draw it (`glyphs`).
 */
export function prepareText(
  inlines: readonly RenderInline[],
  spec: TypeSpec,
  width: number,
  glyphs: GlyphCheck,
): PreparedText {
  // A box narrower than its padding (deep nesting in a narrow cell) still sets its text: a glyph a line.
  const limit = Number.isNaN(width) ? 0 : Math.max(0, width - SAFETY);
  const out: PreparedInline[] = [];
  let lineStart = true; // nothing but spaces yet on a line the author began
  for (const inline of inlines) {
    if (inline.type === "break") {
      out.push({ kind: "break" });
      lineStart = true;
      continue;
    }
    if (inline.text.length === 0) continue;
    const marks: Piece = {
      kind: "text",
      text: inline.text,
      bold: inline.bold === true,
      italic: inline.italic === true,
      underline: inline.underline === true,
      ...(inline.href ? { href: inline.href } : {}),
    };
    const face = faceOf(spec, marks);
    const kept: Piece[] = []; // this run's pieces after the line's leading spaces
    for (const piece of withDrawableSpaces(marks, face, spec.size)) {
      glyphs.check(piece.text, face);
      if (lineStart) {
        // The author's leading spaces become a run of their own (see the top of this file).
        const lead = LEADING_SPACES.exec(piece.text)?.[0].length ?? 0;
        if (lead > 0) {
          const spaces: Piece = {
            ...piece,
            text: piece.text.slice(0, lead),
            isLead: true,
          };
          out.push(spaces);
          piece.text = piece.text.slice(lead);
        }
        lineStart = piece.text.length === 0;
        if (lineStart) continue;
      }
      kept.push(piece);
      out.push(piece);
    }
    if (
      inline.variable !== undefined &&
      kept.some((piece) => piece.text.includes(" "))
    ) {
      const words = kept
        .map((piece) => piece.text)
        .join("")
        .trim()
        .split(/ +/).length;
      const wide = kept.reduce(
        (sum, piece) => sum + pieceWidth(piece, piece.text, spec),
        0,
      );
      if (words <= MAX_JOINED_WORDS && wide <= limit)
        for (const piece of kept) piece.isJoined = true;
    }
  }
  const lines = breakLines(out, spec, limit);
  return { inlines: out, lines };
}

/**
 * A run's text as pieces the fonts can draw: each stretch of a Unicode space the face has no glyph
 * for becomes a piece of no-break spaces (which every face has) with the letter spacing that gives
 * each the width of the space it stands for. A space is never a missing glyph.
 */
function withDrawableSpaces(run: Piece, face: FontFace, size: number): Piece[] {
  if (!/[\u1680\u2000-\u200A\u202F\u205F\u3000]/.test(run.text)) return [run];
  const pieces: Piece[] = [];
  let text = "";
  let missing: string | null = null; // the space `text` repeats, while it is a stretch of one
  const flush = () => {
    if (text === "") return;
    if (missing === null) pieces.push({ ...run, text });
    else {
      const target = SPACE_WIDTHS.get(missing.codePointAt(0)!)!;
      const wide =
        typeof target === "number"
          ? target * size
          : measure(target, face, size);
      pieces.push({
        ...run,
        text: NBSP.repeat(text.length),
        spacing: wide - measure(NBSP, face, size),
      });
    }
    text = "";
  };
  for (const ch of run.text) {
    const codePoint = ch.codePointAt(0)!;
    const substitute =
      SPACE_WIDTHS.has(codePoint) && !canDraw(codePoint, face) ? ch : null;
    if (substitute !== missing) {
      flush();
      missing = substitute;
    }
    text += ch;
  }
  flush();
  return pieces;
}

/** The width of `text` set as `piece` is: its glyphs, plus the piece's letter spacing after each. */
function pieceWidth(piece: Piece, text: string, spec: TypeSpec): number {
  const spacing = piece.spacing ? piece.spacing * [...text].length : 0;
  return measure(text, faceOf(spec, piece), spec.size) + spacing;
}

// ── Greedy line breaking ─────────────────────────────────────────────────────
//
// `breakLines` reads the text as a sequence of units (leading spaces, words, gaps, hard breaks),
// places them one after another on lines `limit` points wide, and records the changes it makes to the
// text (a "\n" where a line wraps, a space dropped where it is absorbed) as edits, applied at the end.

/** One character of a piece's text and where it sits, so that an edit can name it. */
interface Char {
  piece: Piece;
  /** Offset of this character in `piece.text`, in UTF-16 code units (a JavaScript or Java string index). */
  offset: number;
  /** The character: one code point, so one or two code units long. */
  ch: string;
}

/** The author's leading spaces ("lead"), or the run of U+0020 between two words ("gap"). */
interface Spaces {
  kind: "lead" | "gap";
  chars: Char[];
  width: number;
}

/** A run of anything but U+0020 (possibly across pieces); a joined variable's spaces belong to it. */
interface Word {
  kind: "word";
  chars: Char[];
  width: number;
}

/** A hard break (section 4, "Hard breaks"). It has no width. */
interface HardBreak {
  kind: "break";
}

type Unit = Spaces | Word | HardBreak;

/** Replace `piece.text.slice(start, end)` with `text`; the offsets are those of the text before any edit. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/** The edits to make to each piece's text, in the order they were recorded. */
type Edits = Map<Piece, Edit[]>;

/** Everything `breakLines` knows while it fills lines: its settings, the edits so far, and the current line. */
interface Setter {
  spec: TypeSpec;
  /** The width of a line. */
  limit: number;
  edits: Edits;
  /** Lines so far, the current one included. */
  lines: number;
  /** The width of what the current line holds. */
  used: number;
  /** The width the current line has: `limit`, less the indent of a line that began with leading spaces. */
  room: number;
  /** Nothing has been placed on the current line yet. */
  empty: boolean;
  /** The author's leading spaces, read but not yet placed: they wait for the line's first word. */
  lead: Spaces | null;
  /** The spaces after the last word placed, read but not yet placed: they wait for the next word. */
  gap: Spaces | null;
}

/**
 * Breaks the text of `stream` into lines `limit` points wide: it inserts "\n" where a line wraps and
 * absorbs the spaces that wrap or hang past a line's end, changing the pieces' text in place, and
 * returns the number of lines. A piece flagged `isLead` or `isJoined` was marked by `prepareText`.
 */
function breakLines(
  stream: PreparedInline[],
  spec: TypeSpec,
  limit: number,
): number {
  const set: Setter = {
    spec,
    limit,
    edits: new Map(),
    lines: 1,
    used: 0,
    room: limit,
    empty: true,
    lead: null,
    gap: null,
  };
  for (const unit of toUnits(stream, spec)) {
    switch (unit.kind) {
      case "break":
        placeBreak(set);
        break;
      case "lead":
        set.lead = unit; // placed with the first word that follows it
        break;
      case "gap":
        set.gap = unit; // placed with the next word
        break;
      case "word":
        if (set.lead) placeLead(set, set.lead, unit);
        placeWord(set, unit);
        break;
    }
  }
  endLine(set);
  applyEdits(set.edits);
  return set.lines;
}

/** A hard break ends the line the author made; whatever follows starts a new one (section 4, "Hard breaks"). */
function placeBreak(set: Setter): void {
  endLine(set);
  startLine(set);
}

/**
 * Places the leading spaces of a line the author started, before its first word (section 4,
 * "Spaces", PDF). react-pdf hangs the spaces it counts as white space into the margin; a first-line
 * indent of their width puts them back. It counts every space against the line, indented: the spaces
 * and the first word must fit in what's left. Otherwise, as in a browser, the word wraps and the
 * spaces stay behind on a line of their own.
 */
function placeLead(set: Setter, lead: Spaces, firstWord: Word): void {
  const hang = hangingWidth(lead, set.spec);
  if (hang + lead.width + firstWord.width <= set.limit) {
    if (hang > 0) lead.chars[0].piece.indent = hang;
    set.room = set.limit - hang;
    set.used = lead.width;
    set.empty = false;
  } else {
    absorbSpacesPast(set, lead, set.limit);
    breakAfter(set, lead.chars[lead.chars.length - 1]);
    set.lines += 1; // the spaces are a line of their own; the word starts the next
  }
  set.lead = null;
}

/**
 * Places a word, with the gap before it. A word that doesn't fit what is left of the line wraps in
 * the gap: the first space becomes the break and the other spaces there are dropped, never carried
 * to the next line (section 4, "Spaces", PDF). A word wider than a whole line starts a line of its
 * own and is cut there, bare (section 10, "PDF", line wrapping).
 */
function placeWord(set: Setter, word: Word): void {
  const gapWidth = set.gap && !set.empty ? set.gap.width : 0;
  if (!set.empty && set.used + gapWidth + word.width > set.room) {
    wrapInGap(set);
  } else if (!set.empty) {
    set.used += gapWidth;
  }
  set.gap = null;
  if (set.used + word.width <= set.room) {
    set.used += word.width;
    set.empty = false;
    return;
  }
  const { cuts, rest } = cutWord(word.chars, set.spec, set.limit);
  for (const index of cuts) breakAfter(set, word.chars[index - 1]);
  set.lines += cuts.length;
  set.used = rest;
  set.empty = false;
}

/** Wraps in the gap before the word being placed: its first space becomes "\n", the others go. */
function wrapInGap(set: Setter): void {
  set.gap?.chars.forEach((c, i) =>
    addEdit(set, c.piece, {
      start: c.offset,
      end: c.offset + 1,
      text: i === 0 ? "\n" : "",
    }),
  );
  startLine(set);
}

/**
 * Ends the line being filled: spaces still waiting (a line's leading spaces with no word after them,
 * or a gap before a hard break or the end of the text) are kept as far as they fit and the rest are
 * absorbed (section 4, "Spaces", PDF: "Spaces ending a line ... are kept as far as they fit").
 */
function endLine(set: Setter): void {
  if (set.lead) absorbSpacesPast(set, set.lead, set.limit);
  else if (set.gap && !set.empty)
    absorbSpacesPast(set, set.gap, set.room - set.used);
}

/** Starts a new line: nothing on it, and no spaces waiting. */
function startLine(set: Setter): void {
  set.lines += 1;
  set.used = 0;
  set.room = set.limit;
  set.empty = true;
  set.lead = null;
  set.gap = null;
}

/** Keeps the spaces that fit in `room` and absorbs the rest (they would hang past the line's end). */
function absorbSpacesPast(set: Setter, spaces: Spaces, room: number): void {
  let width = 0;
  for (const c of spaces.chars) {
    width += pieceWidth(c.piece, c.ch, set.spec);
    if (width > room) removeChar(set, c);
  }
}

function addEdit(set: Setter, piece: Piece, edit: Edit): void {
  const list = set.edits.get(piece) ?? [];
  list.push(edit);
  set.edits.set(piece, list);
}

function removeChar(set: Setter, c: Char): void {
  addEdit(set, c.piece, {
    start: c.offset,
    end: c.offset + c.ch.length,
    text: "",
  });
}

/** Inserts a line break after a character. */
function breakAfter(set: Setter, c: Char): void {
  const at = c.offset + c.ch.length;
  addEdit(set, c.piece, { start: at, end: at, text: "\n" });
}

/**
 * Makes every recorded edit to its piece's text. A piece's edits are applied from its end to its
 * start, so the offsets of the edits still waiting stay right; the sort is stable, so two edits at
 * the same offset keep the order they were recorded in.
 */
function applyEdits(edits: Edits): void {
  for (const [piece, list] of edits) {
    list.sort((a, b) => b.start - a.start);
    let text = piece.text;
    for (const e of list)
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    piece.text = text;
  }
}

/**
 * Leading spaces (the author's, at the start of a line), words (runs of anything but U+0020,
 * possibly across pieces), gaps (runs of U+0020 between words, where a line may wrap) and hard
 * breaks, measured. A joined variable's spaces belong to its word.
 */
function toUnits(stream: PreparedInline[], spec: TypeSpec): Unit[] {
  const units: Unit[] = [];
  let current = null as { kind: "lead" | "word" | "gap"; chars: Char[] } | null;
  const close = () => {
    if (current)
      units.push({ ...current, width: widthOf(current.chars, spec) });
    current = null;
  };
  for (const item of stream) {
    if (item.kind === "break") {
      close();
      units.push({ kind: "break" });
      continue;
    }
    let offset = 0;
    for (const ch of item.text) {
      const kind = item.isLead
        ? "lead"
        : ch === " " && !item.isJoined
          ? "gap"
          : "word";
      if (current?.kind !== kind) {
        close();
        current = { kind, chars: [] };
      }
      current.chars.push({ piece: item, offset, ch });
      offset += ch.length;
    }
  }
  close();
  return units;
}

/**
 * How far react-pdf hangs a line's leading spaces into the margin: the width of the spaces from the
 * start up to the first one it doesn't count as white space (pdf-fonts.ts, hangsAtLineStart).
 */
function hangingWidth(lead: Spaces, spec: TypeSpec): number {
  let end = 0;
  while (
    end < lead.chars.length &&
    hangsAtLineStart(
      lead.chars[end]!.ch.codePointAt(0)!,
      faceOf(spec, lead.chars[end]!.piece),
    )
  )
    end += 1;
  return end === lead.chars.length
    ? lead.width
    : widthOf(lead.chars.slice(0, end), spec);
}

/** Width of a run of characters, measured per piece (with kerning inside each piece). */
function widthOf(chars: readonly Char[], spec: TypeSpec): number {
  let width = 0;
  let i = 0;
  while (i < chars.length) {
    const piece = chars[i].piece;
    let text = "";
    while (i < chars.length && chars[i].piece === piece) {
      text += chars[i].ch;
      i += 1;
    }
    width += pieceWidth(piece, text, spec);
  }
  return width;
}

/**
 * Cut points for a word wider than `limit`: each is the number of characters before a cut. `rest`
 * is the width of what follows the last cut. Cuts are bare: nothing is added at either side.
 */
function cutWord(
  chars: readonly Char[],
  spec: TypeSpec,
  limit: number,
): { cuts: number[]; rest: number } {
  const prefix = [0];
  for (const c of chars)
    prefix.push(prefix[prefix.length - 1] + pieceWidth(c.piece, c.ch, spec));
  const span = (a: number, b: number) => prefix[b] - prefix[a];
  const n = chars.length;
  const cuts: number[] = [];
  let start = 0;
  while (start < n && span(start, n) > limit) {
    // The farthest end that fits; a lone glyph wider than the line gets the line.
    let end = start;
    while (end < n && span(start, end + 1) <= limit) end += 1;
    if (end === start) end = start + 1;
    // A combining mark goes with the character before it.
    while (end < n && end > start + 1 && MARK.test(chars[end].ch)) end -= 1;
    while (end < n && MARK.test(chars[end].ch)) end += 1;
    if (end >= n) break;

    // Prefer the last separator that fits, unless it leaves the line mostly empty.
    let cut = end;
    for (let k = end; k > start; k -= 1) {
      if (SEPARATOR.has(chars[k - 1].ch)) {
        if (span(start, k) >= MIN_SEPARATOR_FILL * limit) cut = k;
        break;
      }
    }
    cuts.push(cut);
    start = cut;
  }
  return { cuts, rest: span(start, n) };
}
