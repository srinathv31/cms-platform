import "server-only";

import type { RenderInline } from "@/domain/render/types";
import { measure, type FontFace } from "./pdf-fonts";
import type { TypeSpec } from "./pdf-styles";

// Line breaking for the PDF channel. The adapter breaks every line itself, greedily, the way a
// browser sets ragged-right text, and hands react-pdf one line per "\n":
//
// - react-pdf's own breaker (Knuth-Plass) squeezes word spaces by up to a third to fit one more
//   word, even in left-aligned text, which leaves some lines visibly tighter than their
//   neighbours. Lines measured here never exceed the box, so spacing stays even.
// - Words are never hyphenated. Dictionary hyphenation is off (pdf-fonts.ts) and every <Text>
//   forbids react-pdf's run-boundary breaks, so "Featherstonehaugh-Villiers" and
//   "Alexandria-Marguerite," stay whole.
// - A single token wider than its line (a long URL, a long name in a narrow table cell) starts a
//   new line and is cut there: after a hyphen, slash or other separator when one fits, otherwise
//   between letters with a hyphen. Nothing runs past the margin.
// - Short resolved variables get non-breaking spaces ("September 30, 2027",
//   "District of Columbia"), so a date or a state never wraps mid-value.
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
}

export type PreparedInline = Piece | { kind: "break" };

export interface PreparedText {
  inlines: PreparedInline[];
  /** Lines the text will set in. */
  lines: number;
}

const NBSP = " ";
/** Slack kept between a measured line and its box, for rounding. */
const SAFETY = 1;
/** A variable keeps its words together up to this many words. */
const MAX_JOINED_WORDS = 4;
/** A separator cut is preferred unless it leaves the line less than this full. */
const MIN_SEPARATOR_FILL = 0.4;

const SEPARATOR = new Set(["-", "/", ".", "_", "?", "&", "=", "#", ":", ",", ";", "+", "~", "|", "\\", "@", NBSP, "–", "—"]);
const LETTER = /\p{L}/u;

export const faceOf = (spec: TypeSpec, piece: Pick<Piece, "bold" | "italic">): FontFace => ({
  family: spec.family,
  weight: piece.bold ? 700 : spec.weight,
  italic: piece.italic,
});

/** Resolves marks and breaks the text into lines for a box `width` points wide. */
export function prepareText(inlines: readonly RenderInline[], spec: TypeSpec, width: number): PreparedText {
  const limit = width - SAFETY;
  const out: PreparedInline[] = [];
  for (const inline of inlines) {
    if (inline.type === "break") {
      out.push({ kind: "break" });
      continue;
    }
    if (inline.text.length === 0) continue;
    const piece: Piece = {
      kind: "text",
      text: inline.text,
      bold: inline.bold === true,
      italic: inline.italic === true,
      underline: inline.underline === true,
      ...(inline.href ? { href: inline.href } : {}),
    };
    if (inline.variable !== undefined && piece.text.includes(" ")) {
      const words = piece.text.trim().split(/ +/).length;
      if (words <= MAX_JOINED_WORDS && measure(piece.text, faceOf(spec, piece), spec.size) <= limit) {
        piece.text = piece.text.replace(/ /g, NBSP);
      }
    }
    out.push(piece);
  }
  const lines = breakLines(out, spec, limit);
  return { inlines: out, lines };
}

// ── Greedy line breaking ─────────────────────────────────────────────────────

interface Char {
  piece: Piece;
  /** Code-unit offset of this character inside `piece.text`. */
  offset: number;
  ch: string;
}

type Unit =
  | { kind: "word"; chars: Char[]; width: number }
  | { kind: "gap"; chars: Char[]; width: number }
  | { kind: "break" };

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Breaks `stream` in place (inserting "\n") and returns the line count. */
function breakLines(stream: PreparedInline[], spec: TypeSpec, limit: number): number {
  const units = toUnits(stream, spec);
  const edits = new Map<Piece, Edit[]>();
  const edit = (piece: Piece, e: Edit) => {
    const list = edits.get(piece) ?? [];
    list.push(e);
    edits.set(piece, list);
  };

  let lines = 1;
  let used = 0; // width of the current line
  let empty = true; // nothing on the current line yet
  let gap: Extract<Unit, { kind: "gap" }> | null = null;

  for (const unit of units) {
    if (unit.kind === "break") {
      lines += 1;
      used = 0;
      empty = true;
      gap = null;
      continue;
    }
    if (unit.kind === "gap") {
      gap = unit;
      continue;
    }
    const gapWidth = gap && !empty ? gap.width : 0;
    if (!empty && used + gapWidth + unit.width > limit) {
      // Break in the gap before this word: the spaces become the line break.
      gap?.chars.forEach((c, i) => edit(c.piece, { start: c.offset, end: c.offset + 1, text: i === 0 ? "\n" : "" }));
      lines += 1;
      used = 0;
      empty = true;
    } else if (!empty) {
      used += gapWidth;
    }
    gap = null;
    if (unit.width <= limit) {
      used += unit.width;
      empty = false;
      continue;
    }
    // Wider than a line: it starts on a line of its own (above) and is cut to fit.
    const cuts = cutWord(unit.chars, spec, limit);
    for (const cut of cuts) {
      const at = unit.chars[cut.index - 1];
      edit(at.piece, { start: at.offset + at.ch.length, end: at.offset + at.ch.length, text: cut.hyphen ? "-\n" : "\n" });
    }
    lines += cuts.length;
    used = cuts.length > 0 ? cuts[cuts.length - 1].rest : unit.width;
    empty = false;
  }

  for (const [piece, list] of edits) {
    list.sort((a, b) => b.start - a.start);
    let text = piece.text;
    for (const e of list) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    piece.text = text;
  }
  return lines;
}

/** Words (non-space runs, possibly across pieces), gaps (spaces) and hard breaks, measured. */
function toUnits(stream: PreparedInline[], spec: TypeSpec): Unit[] {
  const units: Unit[] = [];
  let current = null as { kind: "word" | "gap"; chars: Char[] } | null;
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
    let offset = 0;
    for (const ch of item.text) {
      const kind = ch === " " ? "gap" : "word";
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
    width += measure(text, faceOf(spec, piece), spec.size);
  }
  return width;
}

/**
 * Cut points for a word wider than `limit`: `index` is the character count before the cut,
 * `rest` the width of what follows the last cut.
 */
function cutWord(chars: Char[], spec: TypeSpec, limit: number): { index: number; hyphen: boolean; rest: number }[] {
  const prefix = [0];
  for (const c of chars) prefix.push(prefix[prefix.length - 1] + measure(c.ch, faceOf(spec, c.piece), spec.size));
  const span = (a: number, b: number) => prefix[b] - prefix[a];
  const n = chars.length;
  const cuts: { index: number; hyphen: boolean; rest: number }[] = [];
  let start = 0;
  while (span(start, n) > limit) {
    // The farthest end that fits.
    let end = start;
    while (end < n && span(start, end + 1) <= limit) end += 1;
    if (end === start) end = start + 1; // a lone glyph wider than the line: it gets the line

    // Prefer the last separator that fits, unless it leaves the line mostly empty.
    let cut = end;
    let hyphen = false;
    for (let k = end; k > start; k -= 1) {
      if (SEPARATOR.has(chars[k - 1].ch)) {
        if (span(start, k) >= MIN_SEPARATOR_FILL * limit) cut = k;
        break;
      }
    }
    if (cut === end && isLetter(chars[end - 1]) && isLetter(chars[end])) {
      // Mid-word: hyphenate, leaving room for the hyphen.
      const hyphenWidth = measure("-", faceOf(spec, chars[end - 1].piece), spec.size);
      while (cut > start + 1 && span(start, cut) + hyphenWidth > limit) cut -= 1;
      hyphen = isLetter(chars[cut - 1]) && isLetter(chars[cut]);
    }
    cuts.push({ index: cut, hyphen, rest: 0 });
    start = cut;
  }
  if (cuts.length > 0) cuts[cuts.length - 1].rest = span(start, n);
  return cuts;
}

const isLetter = (c: Char | undefined) => c !== undefined && LETTER.test(c.ch);
