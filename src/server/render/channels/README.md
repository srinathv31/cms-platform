# Render channels

One adapter per channel: [web.ts](web.ts), [email.ts](email.ts), [push.ts](push.ts), [sms.ts](sms.ts) and the PDF
adapter ([pdf.tsx](pdf.tsx), with [pdf-fonts.ts](pdf-fonts.ts), [pdf-text.ts](pdf-text.ts) and
[pdf-styles.ts](pdf-styles.ts)). What each prints is specified in [docs/render-spec.md](../../../../docs/render-spec.md);
how a request reaches them is in [src/server/README.md](../../README.md#render-import-autosave-and-route-helpers).

## The PDF adapter's pinned packages

`package.json` pins `@react-pdf/renderer` (4.9.0) and `pdfjs-dist` (6.4.299) to exact versions, without a `^`. JSON has no
comments, so the reason is here. The adapter reaches below both packages' public API, and a minor release can change
what it reaches. The failure shows up as a different PDF or a failing test in this folder, not as a build error.

**To bump either one:**

1. Run `npm install --save-exact <package>@<version>`, so the pin stays exact.
2. Run `npm test` and read every failure against the tables below before changing a test.
3. Run `npm run golden:update` and read the diff in `src/server/render/golden/cases/`. A bump that is not meant to change
   the output must leave the goldens as they are (see [the golden README](../golden/README.md)).
4. Update the table here if an internal moved.

`@react-pdf/renderer` takes its own parts (`@react-pdf/font`, `layout`, `textkit`, `fontkit`) from caret ranges that
`package-lock.json` resolves. Keep the lockfile when you install; don't run `npm update` on them apart from a bump.

### What `@react-pdf/renderer` has to keep doing

| Where                                             | Depends on                                                                                                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerFonts` in [pdf-fonts.ts](pdf-fonts.ts)   | `Font.getRegisteredFonts()` returns the live registry, so assigning `families.Helvetica.sources` repoints react-pdf's last-resort family at Liberation Sans. It sets every character the main face lacks in it.                        |
| `loadedFont` in [pdf-fonts.ts](pdf-fonts.ts)      | `Font.getFont(descriptor).data` is the fontkit font object: `unitsPerEm`, `characterSet`, `layout()`, `hasGlyphForCodePoint()` and `glyphForCodePoint()`.                                                                              |
| `primeGlyphCache` in [pdf-fonts.ts](pdf-fonts.ts) | fontkit caches a glyph with the code points of the first lookup that reaches it, and react-pdf's layout reads them (a leading glyph hangs only if it includes U+0020; soft hyphens are dropped).                                       |
| `measure` in [pdf-fonts.ts](pdf-fonts.ts)         | The adapter measures with the same fontkit font and breaks lines itself ([pdf-text.ts](pdf-text.ts)), so its lines must match the ones react-pdf's text layout would set.                                                              |
| `registerFonts`, the font `src`                   | A string `src` is opened as a file unless it looks like a URL. Keep the native `path.join` result: on Windows `C:\...`, never a `file:` URL or a `//` path ([pdf-fonts-paths.test.ts](pdf-fonts-paths.test.ts)).                       |
| `withModDate` in [pdf.tsx](pdf.tsx)               | The document information dictionary uses the key `/ModificationDate`, the trailer says `/Info N 0 R` after a `\ntrailer\n` line, and the dictionary is written in the clear (no object streams). It is renamed to `/ModDate` in place. |
| The page breaker, in [pdf.tsx](pdf.tsx)           | `wrap`, `fixed` (only when true), `minPresenceAhead`, `orphans` and `widows`, and `hyphenationPenalty`, as the pagination comment at the top of the file describes them.                                                               |

The tests that pin these: [pdf.test.ts](pdf.test.ts), [pdf-fonts.test.ts](pdf-fonts.test.ts) (fresh processes, with
the glyph-cache poisoning documents first) and the golden suite.

### What `pdfjs-dist` is used for here

- [pdf-fonts.ts](pdf-fonts.ts) reads Liberation Sans from `node_modules/pdfjs-dist/standard_fonts/` (Regular, Italic,
  Bold and BoldItalic `.ttf`). Moving or changing those files changes every PDF.
- The tests and the golden files read the PDF back with `pdfjs-dist/legacy/build/pdf.mjs`
  ([extract-pdf.ts](../golden/extract-pdf.ts), [pdf.test.ts](pdf.test.ts)).
- Two more uses sit elsewhere, and a bump has to check them too: the import's worker
  ([convert-worker.mjs](../../import/convert-worker.mjs)) and the in-app viewer
  ([src/components/preview/pdf](../../../components/preview/pdf/README.md)).
