// The PDF's text blocks (extract-pdf.ts) read back as content, to be compared with the reference
// from content-text.ts. See the header of content-text.ts for what the PDF is compared with.

import { TABLE_MARK, norm, type Content } from "./content-text";
import { eq } from "./diff";
import { JOIN_MARK, type PdfBlock } from "./extract-pdf";

/**
 * PDF blocks -> content. The PDF does not mark where one reference line ends: a page break splits a
 * paragraph, and a blank paragraph or a second paragraph inside a list item leaves a gap that reads
 * as a new block. Walking the reference with a cursor, a block is joined with the blocks after it
 * when, together, they are the reference's next line. A block that matches as it is never joins, so
 * a real difference still shows. A table cell is never joined (its own block, whole: a table row
 * never splits across pages).
 */
export function contentFromPdf(
  blocks: readonly PdfBlock[],
  links: { text: string; url: string }[],
  ref: Content,
): Content {
  const MAX_JOIN = 12;
  const lines = ref.lines;
  const render = (b: PdfBlock) =>
    b.blank
      ? "\u2205"
      : b.table
        ? TABLE_MARK + b.text
        : `${b.heading ? "#".repeat(b.heading) + " " : ""}${b.text}`;
  const out: string[] = [];
  let e = 0; // the next reference line
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]!;
    let text = render(b);
    if (e < lines.length && !eq(lines[e]!, text) && !b.blank && !b.table) {
      let acc = b;
      for (let k = 1; k <= MAX_JOIN && i + k < blocks.length; k += 1) {
        const next = blocks[i + k]!;
        if (next.blank || next.table || next.heading !== b.heading) break;
        acc = { ...acc, text: acc.text + JOIN_MARK + next.text };
        if (eq(lines[e]!, render(acc))) {
          text = render(acc);
          i += k;
          break;
        }
      }
    }
    out.push(text);
    e += 1;
  }
  return {
    lines: out,
    links: links.map((l) => ({ text: norm(l.text), url: l.url })),
  };
}
