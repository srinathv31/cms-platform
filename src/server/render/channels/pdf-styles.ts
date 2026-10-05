import "server-only";

import { StyleSheet } from "@react-pdf/renderer";
import { CALLOUT_SHAPE, PALETTE } from "./look";
import { SANS, SERIF } from "./pdf-fonts";

// Page geometry and type scale for the PDF channel. Units are PostScript points (72 per inch).

/** US Letter, 1 in side margins, a footer band inside the bottom margin. */
export const PAGE = {
  width: 612,
  height: 792,
  marginX: 72,
  marginTop: 68,
  marginBottom: 72,
  /** Distance from the bottom edge to the footer's baseline box. */
  footerBottom: 36,
} as const;

export const CONTENT_WIDTH = PAGE.width - 2 * PAGE.marginX; // 468 pt, about 85 characters a line
export const CONTENT_AREA = PAGE.height - PAGE.marginTop - PAGE.marginBottom;

/**
 * Print colors, by the PDF's names, from the shared PALETTE (look.ts): the callout's are the same
 * values the web and email callouts use.
 */
export const INK = {
  ...PALETTE.print,
  calloutFill: PALETTE.callout.fill,
  calloutLine: PALETTE.callout.line,
  calloutGlyph: PALETTE.callout.glyph,
} as const;

/** A printer's hairline that still reads on screen at 100% (about 1 px). */
export const HAIRLINE = 0.75;

export interface TypeSpec {
  family: typeof SANS | typeof SERIF;
  size: number;
  weight: 400 | 500 | 700;
  lineHeight: number;
}

export const TYPE = {
  body: { family: SANS, size: 10.5, weight: 400, lineHeight: 1.45 },
  h1: { family: SANS, size: 19, weight: 700, lineHeight: 1.22 },
  h2: { family: SERIF, size: 15, weight: 500, lineHeight: 1.25 },
  h3: { family: SANS, size: 11, weight: 700, lineHeight: 1.35 },
  table: { family: SANS, size: 9.5, weight: 400, lineHeight: 1.4 },
  callout: { family: SANS, size: 10, weight: 400, lineHeight: 1.45 },
  footer: { family: SANS, size: 7.5, weight: 400, lineHeight: 1.15 }, // the font's own line gap
} as const satisfies Record<string, TypeSpec>;

/** Line box height in points. */
export const lineBox = (spec: TypeSpec) => spec.size * spec.lineHeight;

/** Vertical rhythm, in points. */
export const SPACE = {
  /** Below a heading, by level: tight, so the heading reads as part of its section. */
  afterHeading: { 1: 10, 2: 6, 3: 4 },
  /** Above a heading, by level. */
  beforeHeading: { 1: 22, 2: 20, 3: 13 },
  paragraph: 7,
  /** Around lists, tables and callouts. */
  block: 10,
  rule: 12,
  listItem: 3.5,
  /** Between blocks inside a list item, cell or callout. */
  inner: 5,
} as const;

export const LIST = {
  /** Gap between the marker's right edge and the item text. */
  markerGap: 6,
  /** Narrowest marker column, so bullets and short numbers line up. */
  minMarker: 15,
} as const;

export const TABLE = {
  padX: 6.5,
  padY: 4.5,
} as const;

/** The shared callout shape (look.ts) in points of the callout's 10 pt text. */
const calloutPt = (em: number) => Math.round(em * TYPE.callout.size * 100) / 100;

export const CALLOUT = {
  padTop: calloutPt(CALLOUT_SHAPE.padY), // 9
  padBottom: calloutPt(CALLOUT_SHAPE.padY), // 9
  padRight: calloutPt(CALLOUT_SHAPE.padX), // 12
  /** Room for the info glyph on the left. */
  padLeft: calloutPt(CALLOUT_SHAPE.glyphGutter), // 30
  iconSize: calloutPt(CALLOUT_SHAPE.glyphSize), // 10.5
  iconLeft: calloutPt(CALLOUT_SHAPE.glyphLeft), // 11
  radius: calloutPt(CALLOUT_SHAPE.radius), // 4
} as const;

export const styles = StyleSheet.create({
  // No lineHeight on the page or any View: react-pdf re-resolves the styles of nodes it lays out
  // again on every page (the footer's page number) and multiplies an inherited lineHeight by the
  // font size each time. Every <Text> sets its own.
  page: {
    paddingTop: PAGE.marginTop,
    paddingBottom: PAGE.marginBottom,
    paddingHorizontal: PAGE.marginX,
    fontFamily: SANS,
    fontSize: TYPE.body.size,
    color: INK.text,
  },
  h1: {
    fontFamily: TYPE.h1.family,
    fontSize: TYPE.h1.size,
    fontWeight: TYPE.h1.weight,
    lineHeight: TYPE.h1.lineHeight,
  },
  h2: {
    fontFamily: TYPE.h2.family,
    fontSize: TYPE.h2.size,
    fontWeight: TYPE.h2.weight,
    lineHeight: TYPE.h2.lineHeight,
  },
  h3: {
    fontFamily: TYPE.h3.family,
    fontSize: TYPE.h3.size,
    fontWeight: TYPE.h3.weight,
    lineHeight: TYPE.h3.lineHeight,
  },
  link: {
    color: INK.link,
    textDecoration: "underline",
  },
  listItem: {
    flexDirection: "row",
  },
  marker: {
    color: INK.marker,
    textAlign: "right",
  },
  listBody: {
    flexGrow: 1,
    flexShrink: 1,
  },
  // Every cell draws its own box and each row overlaps the one above by a hairline, so the lines
  // read as single rules and a table split across pages stays closed on both sides. (A split
  // container would stretch to the page bottom, so the table itself draws nothing.)
  tableRow: {
    flexDirection: "row",
  },
  rowAfterFirst: {
    marginTop: -HAIRLINE,
  },
  cell: {
    paddingHorizontal: TABLE.padX,
    paddingVertical: TABLE.padY,
    borderTopWidth: HAIRLINE,
    borderRightWidth: HAIRLINE,
    borderBottomWidth: HAIRLINE,
    borderColor: INK.hairline,
    borderStyle: "solid",
  },
  firstCell: {
    borderLeftWidth: HAIRLINE,
  },
  headerCell: {
    backgroundColor: INK.tint,
  },
  callout: {
    position: "relative",
    backgroundColor: INK.calloutFill,
    borderWidth: HAIRLINE,
    borderColor: INK.calloutLine,
    borderStyle: "solid",
    borderRadius: CALLOUT.radius,
    paddingTop: CALLOUT.padTop,
    paddingBottom: CALLOUT.padBottom,
    paddingLeft: CALLOUT.padLeft,
    paddingRight: CALLOUT.padRight,
  },
  calloutIcon: {
    position: "absolute",
    left: CALLOUT.iconLeft,
    width: CALLOUT.iconSize,
    height: CALLOUT.iconSize,
  },
  rule: {
    borderBottomWidth: HAIRLINE,
    borderColor: INK.hairline,
    borderStyle: "solid",
  },
  footer: {
    position: "absolute",
    left: PAGE.marginX,
    right: PAGE.marginX,
    bottom: PAGE.footerBottom,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: SANS,
    fontSize: TYPE.footer.size,
    color: INK.muted,
  },
});
