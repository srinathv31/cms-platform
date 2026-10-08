import "server-only";

import type { RenderInline } from "@/domain/render/types";
import { canDraw, hangsAtLineStart, measure, type FontFace, type GlyphCheck } from "./pdf-fonts";
import type { TypeSpec } from "./pdf-styles";

// Line breaking for the PDF channel. The adapter breaks every line itself, greedily, the way a
// browser sets ragged-right `white-space: pre-wrap` text, and hands react-pdf one line per "\n":
//
// - react-pdf's own breaker (Knuth-Plass) squeezes word spaces by up to a third to fit one more
//   word, even in left-aligned text, which leaves some lines visibly tighter than their
//   neighbours. Lines measured here never exceed the box, so spacing stays even.
// - Spaces are content (docs/render-spec.md, "Spaces"); every U+0020 stays a U+0020. Runs of
//   spaces keep their width. Spaces of every kind (U+0020, the no-break space, the en, em, thin
//   and other Unicode spaces) that begin a line the author started (the paragraph's start, or
//   after a hard break) are set as a run of their own, and print where they were typed: react-pdf
//   hangs the ones it counts as white space into the margin (and counts them against the line),
//   so the run gets a first-line indent of exactly their width (pdf-fonts.ts, hangsAtLineStart).
//   The spaces where a line wraps, and spaces at the end of a line past its edge, are absorbed, as
//   a browser hangs them; they are never carried to the start of the next line. Lines wrap only at
//   U+0020; the other spaces hold their words together, as no-break spaces do.
// - A space is never "a character the PDF can't draw": a Unicode space the font has no glyph for
//   (an em space, a thin space, …) is set as the face's no-break space, widened or narrowed to the
//   space's own width (SPACE_WIDTHS) with letter spacing.
// - Nothing is ever inserted. Dictionary hyphenation is off (pdf-fonts.ts) and every <Text>
//   forbids react-pdf's run-boundary breaks, so "Featherstonehaugh-Villiers" and
//   "Alexandria-Marguerite," stay whole. A single token wider than its line (a long URL, a long
//   name in a narrow table cell) starts a new line and is cut there, bare: after a hyphen, slash
//   or other separator when one fits, otherwise between two characters. Nothing runs past the
//   margin (except a lone glyph wider than its whole box).
// - A short resolved variable never wraps mid-value ("September 30, 2027", "District of
//   Columbia"): its spaces aren't break points. Its characters are left exactly as they are.
//
// Measurements use the same embedded fonts react-pdf sets the text with (fontkit, with kerning).

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
const SPACE_WIDTHS: ReadonlyMap<number, number | string> = new Map<number, number | string>([
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

const SEPARATOR = new Set([" ", "-", "/", ".", "_", "?", "&", "=", "#", ":", ",", ";", "+", "~", "|", "\\", "@", NBSP, "–", "—"]);
/** A combining mark stays on the line of the character it sits on. */
const MARK = /\p{M}/u;

export const faceOf = (spec: TypeSpec, piece: Pick<Piece, "bold" | "italic">): FontFace => ({
  family: spec.family,
  weight: piece.bold ? 700 : spec.weight,
  italic: piece.italic,
});

/**
 * Resolves marks and breaks the text into lines for a box `width` points wide. Every character is
 * checked against the face that will draw it (`glyphs`).
 */
export function prepareText(inlines: readonly RenderInline[], spec: TypeSpec, width: number, glyphs: GlyphCheck): PreparedText {
  // A box narrower than its padding (deep nesting in a narrow cell) still sets its text: a glyph a line.
  const limit = Number.isNaN(width) ? 0 : Math.max(0, width - SAFETY);
  const out: PreparedInline[] = [];
  const leads = new Set<Piece>();
  const joined = new Set<Piece>();
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
          const spaces: Piece = { ...piece, text: piece.text.slice(0, lead) };
          leads.add(spaces);
          out.push(spaces);
          piece.text = piece.text.slice(lead);
        }
        lineStart = piece.text.length === 0;
        if (lineStart) continue;
      }
      kept.push(piece);
      out.push(piece);
    }
    if (inline.variable !== undefined && kept.some((piece) => piece.text.includes(" "))) {
      const words = kept.map((piece) => piece.text).join("").trim().split(/ +/).length;
      const wide = kept.reduce((sum, piece) => sum + pieceWidth(piece, piece.text, spec), 0);
      if (words <= MAX_JOINED_WORDS && wide <= limit) for (const piece of kept) joined.add(piece);
    }
  }
  const lines = breakLines(out, spec, limit, leads, joined);
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
      const wide = typeof target === "number" ? target * size : measure(target, face, size);
      pieces.push({ ...run, text: NBSP.repeat(text.length), spacing: wide - measure(NBSP, face, size) });
    }
    text = "";
  };
  for (const ch of run.text) {
    const codePoint = ch.codePointAt(0)!;
    const substitute = SPACE_WIDTHS.has(codePoint) && !canDraw(codePoint, face) ? ch : null;
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

interface Char {
  piece: Piece;
  /** Code-unit offset of this character inside `piece.text`. */
  offset: number;
  ch: string;
}

type Spaces = { kind: "lead" | "gap"; chars: Char[]; width: number };
type Unit = Spaces | { kind: "word"; chars: Char[]; width: number } | { kind: "break" };

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Breaks `stream` in place (inserting "\n", absorbing spaces) and returns the line count. */
function breakLines(
  stream: PreparedInline[],
  spec: TypeSpec,
  limit: number,
  leads: ReadonlySet<Piece>,
  joined: ReadonlySet<Piece>,
): number {
  const units = toUnits(stream, spec, leads, joined);
  const edits = new Map<Piece, Edit[]>();
  const edit = (piece: Piece, e: Edit) => {
    const list = edits.get(piece) ?? [];
    list.push(e);
    edits.set(piece, list);
  };
  const remove = (c: Char) => edit(c.piece, { start: c.offset, end: c.offset + c.ch.length, text: "" });
  const newlineAfter = (c: Char) => edit(c.piece, { start: c.offset + c.ch.length, end: c.offset + c.ch.length, text: "\n" });
  /** Keeps the spaces that fit in `room` and absorbs the rest (they would hang past the line's end). */
  const fit = (spaces: Spaces, room: number) => {
    let width = 0;
    for (const c of spaces.chars) {
      width += pieceWidth(c.piece, c.ch, spec);
      if (width > room) remove(c);
    }
  };

  let lines = 1;
  let used = 0; // width of the current line
  let room = limit; // the current line's width: less on a line indented for its leading spaces
  let empty = true; // nothing on the current line yet
  let lead: Spaces | null = null; // the leading spaces of a line the author began
  let gap: Spaces | null = null; // spaces after the last word placed

  const endLine = () => {
    if (lead) fit(lead, limit);
    else if (gap && !empty) fit(gap, room - used);
  };

  for (const unit of units) {
    if (unit.kind === "break") {
      endLine();
      lines += 1;
      used = 0;
      room = limit;
      empty = true;
      lead = null;
      gap = null;
      continue;
    }
    if (unit.kind === "lead") {
      lead = unit;
      continue;
    }
    if (unit.kind === "gap") {
      gap = unit;
      continue;
    }
    if (lead) {
      // react-pdf hangs the spaces it counts as white space into the margin; a first-line indent of
      // their width puts them back. It counts every space against the line, indented: the spaces
      // and the first word must fit in what's left. Otherwise, as in a browser, the word wraps and
      // the spaces stay behind on a line of their own.
      const hang = hangingWidth(lead, spec);
      if (hang + lead.width + unit.width <= limit) {
        if (hang > 0) lead.chars[0].piece.indent = hang;
        room = limit - hang;
        used = lead.width;
        empty = false;
      } else {
        fit(lead, limit);
        newlineAfter(lead.chars[lead.chars.length - 1]);
        lines += 1;
      }
      lead = null;
    }
    const gapWidth = gap && !empty ? gap.width : 0;
    if (!empty && used + gapWidth + unit.width > room) {
      // Wrap in the gap before this word: the spaces there become the line break.
      gap?.chars.forEach((c, i) => edit(c.piece, { start: c.offset, end: c.offset + 1, text: i === 0 ? "\n" : "" }));
      lines += 1;
      used = 0;
      room = limit;
      empty = true;
    } else if (!empty) {
      used += gapWidth;
    }
    gap = null;
    if (used + unit.width <= room) {
      used += unit.width;
      empty = false;
      continue;
    }
    // Wider than a whole line: it starts on a line of its own (above) and is cut, bare, to fit.
    const { cuts, rest } = cutWord(unit.chars, spec, limit);
    for (const index of cuts) newlineAfter(unit.chars[index - 1]);
    lines += cuts.length;
    used = rest;
    empty = false;
  }
  endLine();

  for (const [piece, list] of edits) {
    list.sort((a, b) => b.start - a.start);
    let text = piece.text;
    for (const e of list) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    piece.text = text;
  }
  return lines;
}

/**
 * Leading spaces (the author's, at the start of a line), words (runs of anything but U+0020,
 * possibly across pieces), gaps (runs of U+0020 between words, where a line may wrap) and hard
 * breaks, measured. A joined variable's spaces belong to its word.
 */
function toUnits(stream: PreparedInline[], spec: TypeSpec, leads: ReadonlySet<Piece>, joined: ReadonlySet<Piece>): Unit[] {
  const units: Unit[] = [];
  let current = null as { kind: "lead" | "word" | "gap"; chars: Char[] } | null;
  const close = () => {
    if (current) units.push({ ...current, width: widthOf(current.chars, spec) });
    current = null;
  };
  for (const item of stream) {
    if (item.kind === "break") {
      close();
      units.push({ kind: "break" });
      continue;
    }
    const lead = leads.has(item);
    const keep = joined.has(item);
    let offset = 0;
    for (const ch of item.text) {
      const kind = lead ? "lead" : ch === " " && !keep ? "gap" : "word";
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
  while (end < lead.chars.length && hangsAtLineStart(lead.chars[end]!.ch.codePointAt(0)!, faceOf(spec, lead.chars[end]!.piece))) end += 1;
  return end === lead.chars.length ? lead.width : widthOf(lead.chars.slice(0, end), spec);
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
function cutWord(chars: readonly Char[], spec: TypeSpec, limit: number): { cuts: number[]; rest: number } {
  const prefix = [0];
  for (const c of chars) prefix.push(prefix[prefix.length - 1] + pieceWidth(c.piece, c.ch, spec));
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
