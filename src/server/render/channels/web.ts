// Web channel: a complete, responsive HTML document. No scripts, no external resources, one
// <style> block. A neutral document look (system fonts, a readable measure, hairline tables) that a
// bank's site can restyle by replacing the stylesheet; the markup itself is plain semantic HTML.
//
// The template name is internal metadata: it goes in <title>, never in the body.

import type { RenderDoc } from "@/domain/render/types";
import { FONT_STACK, blocksHtml, escapeHtml, type HtmlFlavor } from "./html";
import { CALLOUT_SHAPE, PALETTE } from "./look";

const C = PALETTE;
const S = CALLOUT_SHAPE;
/** Body line height; the callout glyph centers on the first line with it. */
const LINE = 1.6;
const em = (n: number) => `${Math.round(n * 1000) / 1000}em`;

// Tables keep word-sized columns (`break-word` doesn't shrink min-content, unlike `anywhere`), so a
// wide table scrolls inside .table-wrap on a phone instead of squeezing to one letter per line.
const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:${C.page};color:${C.text};font-family:${FONT_STACK};font-size:1.0625rem;line-height:${LINE};overflow-wrap:anywhere}
.doc{max-width:42rem;margin:0 auto;padding:clamp(1.5rem,5vw,3.5rem) clamp(1rem,5vw,2rem)}
.doc>:first-child{margin-top:0}
.doc>:last-child{margin-bottom:0}
p{margin:0 0 1rem}
h1,h2,h3{color:${C.text};font-weight:650;letter-spacing:-0.01em;overflow-wrap:break-word}
h1{font-size:clamp(1.75rem,1.45rem + 1.4vw,2.25rem);line-height:1.2;margin:2.5rem 0 1.25rem}
h2{font-size:clamp(1.3rem,1.2rem + 0.5vw,1.5rem);line-height:1.3;margin:2.25rem 0 0.75rem}
h3{font-size:1.125rem;line-height:1.4;margin:1.75rem 0 0.5rem}
h1+h2,h2+h3,h1+h3{margin-top:0}
a{color:${C.link};text-decoration:underline;text-underline-offset:0.15em}
ul,ol{margin:0 0 1rem;padding-left:1.5rem}
li{margin:0}
li+li{margin-top:0.375rem}
li>p{margin:0 0 0.5rem}
li>:last-child{margin-bottom:0}
li>ul,li>ol{margin:0.375rem 0 0}
.table-wrap{margin:1.25rem 0 1.5rem;overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:0.9375rem;line-height:1.5;overflow-wrap:break-word}
th,td{border:1px solid ${C.hairline};padding:0.5rem 0.75rem;text-align:left;vertical-align:top}
th{background:${C.tableHead};font-weight:600}
th>p,td>p{margin:0 0 0.5rem}
th>:last-child,td>:last-child{margin-bottom:0}
.callout{position:relative;margin:1.5rem 0;padding:${em(S.padY)} ${em(S.padX)} ${em(S.padY)} ${em(S.glyphGutter)};background:${C.callout.fill};border:1px solid ${C.callout.line};border-radius:${em(S.radius)}}
.callout-glyph{position:absolute;left:${em(S.glyphLeft)};top:${em(S.padY + (LINE - S.glyphSize) / 2)};width:${em(S.glyphSize)};height:${em(S.glyphSize)};color:${C.callout.glyph}}
.callout>:first-child{margin-top:0}
.callout>:last-child{margin-bottom:0}
hr{border:0;border-top:1px solid ${C.rule};margin:2rem 0}
strong{font-weight:650}
`
  .trim()
  .replace(/\n/g, "");

/**
 * The callout's (i): Lucide's "info", the same vectors the PDF draws, in currentColor. Decorative
 * (the note role carries the meaning). Its width and height attributes keep it glyph-sized even if
 * a site replaces the stylesheet.
 */
const GLYPH =
  '<svg class="callout-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01" stroke-width="2.4"/></svg>';

/** The web flavor: semantic tags, styled from the stylesheet; only callouts and table wrappers carry a class. */
const WEB: HtmlFlavor = {
  attrs: () => "",
  wrapTable: (table) => `<div class="table-wrap">\n${table}\n</div>`,
  callout: (content) => `<div class="callout" role="note">\n${GLYPH}\n${content}\n</div>`,
};

export function renderWeb(doc: RenderDoc): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(doc.templateName)}</title>`,
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    '<main class="doc">',
    blocksHtml(doc.blocks, WEB),
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
