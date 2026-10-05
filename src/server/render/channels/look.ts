// The customer look every channel shares: the one block of raw colors (PALETTE) and the callout's
// shape. Customer output, not UCOMP UI, so raw colors are allowed here, and only here. The renderer
// can't read the CSS tokens; stone and teal values mirror src/styles/tokens.css by name.
//
// - Web and email set documents in the top-level colors: a neutral look that a bank's own site or
//   email template can restyle.
// - The PDF prints in `print` (pdf-styles.ts names it INK).
// - Callouts are the print palette's stone note in every channel, so a note looks the same in a
//   PDF, on the web and in an email.

export const PALETTE = {
  page: "#ffffff",
  canvas: "#f4f5f7", // email: the area around the 600px card
  text: "#1f2328",
  muted: "#57606a",
  hairline: "#d0d7de",
  rule: "#d8dee4",
  link: "#0b57d0",
  tableHead: "#f3f5f7",
  /** Every channel's callout: a warm stone tint, a stone hairline and a muted (i) glyph. */
  callout: {
    fill: "#f9f7f4", // stone-50
    line: "#d9d4cb", // stone-300
    glyph: "#6f6b65", // stone-600
  },
  /**
   * The PDF. Its rules are a step darker than the app's hairline: stone-250/300 vanish once a
   * 0.75 pt line is anti-aliased on screen.
   */
  print: {
    text: "#1b1b1b", // stone-900
    muted: "#6f6b65", // stone-600
    marker: "#55524c", // stone-700
    hairline: "#c9c3b8", // stone-400: table and divider rules
    tint: "#f5f3ef", // stone-100: table header fill
    link: "#2d5a5c", // teal-700, the brand
  },
} as const;

/**
 * The callout's shape in ems of its text, so it keeps its proportions in every channel: the PDF
 * sets it in points (10 pt callout text), the web in em, the email in whole pixels of 16 px text.
 * `glyphGutter` is the left padding that makes room for the (i) glyph; a channel that draws no
 * glyph pads its left side like its right (`padX`).
 */
export const CALLOUT_SHAPE = {
  padY: 0.9,
  padX: 1.2,
  glyphGutter: 3,
  glyphSize: 1.05,
  glyphLeft: 1.1,
  radius: 0.4,
} as const;
