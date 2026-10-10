# `src/server/render/golden`: golden files for the render engine

The golden files freeze what the render engine prints. Each case is one template, with its variables
and values, and the exact output of every channel it lists: for a document, the RenderDoc, the web page,
the email (HTML, plain text, subject and preheader) and the PDF; for a message, the push for iPhone and for
Android and the SMS. Any change that moves one byte of output shows up here as a file diff that someone
has to read and accept.

They exist for two reasons:

- **Cross-channel parity.** The product rule (top of `docs/render-spec.md`): what the author types and
  sees renders the same in every channel. The parity test reads every case's web, email and PDF
  output back as content and requires it to match the RenderDoc. A channel that drops, adds or
  renumbers anything fails, whatever the files on disk say.
- **The acceptance test for a second engine.** A Java engine will be built from the spec. It renders
  every case's `input.json` and must reproduce the `expected/` files exactly. The golden files are the
  spec in executable form.

The rules live in `docs/render-spec.md` (section 13 is the golden file contract, section 12
determinism). This README covers how to work with the files.

Contents: [Layout](#layout) · [A case's files](#a-cases-files) · [Case names](#case-names) ·
[The tests](#the-tests) · [Generating](#generating) · [When to regenerate](#when-to-regenerate) ·
[Reviewing a golden diff](#reviewing-a-golden-diff) · [Adding a case](#adding-a-case) ·
[How Java uses them](#how-java-uses-them) · [Gotchas](#gotchas)

## Layout

```
src/server/render/golden/
  cases/<slug>/            one folder per case (see below)
  focused-cases.ts         the hand-built cases, as code; writes their input.json
  files.ts                 where cases live, reading an input.json, GOLDEN_UPDATE
  pipeline.ts              input.json → every artifact: runCase, expectedFiles, nodeFiles, parityProblems
  content.ts               the content text and every cross-channel comparison (reference implementation)
  extract-pdf.ts           PDF → lines, table cells, links, metadata (pdfjs-dist); NODE_PROFILE
  invariants.ts            the RenderDoc's invariants (spec section 9)
  golden.test.ts           every file on disk equals the engine's output
  parity.test.ts           every channel shows the RenderDoc's content
  parity-detects.test.ts   the parity check catches planted defects
  determinism.test.ts      the same bytes in fresh processes, in either order

src/server/render/testing/  shared with other render tests
  fixture.ts               RenderFixture: the shape of input.json; json(); parseRenderFixture()
  tiptap.ts                tiny builders for TipTap JSON (doc, p, t, h, ul, ol, table, v, …)
  fresh-process.ts         renders jobs in a brand-new Node process

scripts/golden-import.ts   npm run golden:import
```

Both `npm run golden:update` and `npm test` run the engine the render route runs (`runEngine` in
`src/server/render/engine.ts`, pipeline stages 6 to 9), so a golden file is what the API returns for
that input.

## A case's files

```
cases/<slug>/
  input.json
  expected/     engine-neutral: the Java engine must produce exactly these
  node/         the Node engine only: depends on its fonts and its PDF layout engine
```

| File | What it holds |
| --- | --- |
| `input.json` | The frozen input (`RenderFixture`): template id and name, version number (null for a draft), `at` (the render time, used as the PDF's dates), the variables, the values as a request sends them (JSON numbers are read from their source text, so `21.90` stays `21.90`), the body (a message case's is an empty document, never read), the channel fields as a version stores them (`channelFields`: `{}`, `{ "email": { "subject", "preheader" } }`, `{ "push": { … }, "sms": { "text" } }`), the channels the case renders (`channels`, one family), and for a message the content type's SMS footer (`smsFooter`, absent for none). |
| `expected/renderdoc.json` | The resolved document (spec section 9). |
| `expected/web.html` | The web page. |
| `expected/email.html` | The email HTML. |
| `expected/email.json` | `{ "subject", "preheader" }`. |
| `expected/email.txt` | The plain-text alternative. |
| `expected/content.txt` | The content text, derived from `renderdoc.json` alone: one block per line, markers and `∅` for blank lines included (rules at the top of `content.ts`). The quickest file to read. |
| `expected/links.json` | `[ { "text", "url" } ]` in document order. |
| `expected/pdf.meta.json` | The PDF's title, subject, creator, producer, language and dates. Absent when the PDF fails. |
| `expected/error.json` | Only for a case refused before any channel: `{ "code", "message", "details" }`, and then the only file besides `input.json` (no `node/`). |
| `expected/push.ios.json`, `expected/push.android.json` | A push case: the push the route returns for that platform, `{ "title", "subtitle"?, "body", "payloadBytes" }` (Android's never has a subtitle). `push.<platform>.error.json` instead when that render is refused (over 4,096 bytes). |
| `expected/sms.json` | An SMS case: `{ "text", "encoding", "parts", "characters" }`, the footer on the text's last line. `sms.error.json` instead when it is refused (over 10 parts). |
| `node/pdf.layout.txt` | A picture of the PDF's layout: the metadata (dates left out), then every text line by page, with its indent (in steps of `indentStep`), `#` marks for heading sizes, `∅` for a blank paragraph's gap, the footer and the links. Wraps and page breaks show here. |
| `node/pdf.json` | Page count, missing glyphs (always 0) and link annotations with their page. |
| `node/pdf.error.json` | Only when the PDF must fail: the error, alone in `node/`. |

JSON files are compared as parsed JSON (key order and whitespace don't matter); `.html` and `.txt`
files byte for byte.

A case renders only the channels it lists (`channels`), in the order PDF, web, email, push (iPhone, then
Android), SMS. A refusal before the adapter (values, the document check, the resolver) ends the case, so a
refused body reads "The PDF couldn't be rendered. …", and a refused subject or preheader (only email checks
them) reads "The email couldn't be rendered. …". A message case writes no `renderdoc.json`, `content.txt` or
`links.json`: a message has no document.

## Case names

The prefix is an assertion: `parity.test.ts` checks it.

| Prefix | Meaning |
| --- | --- |
| `error-` | Must be refused before any channel renders: `expected/error.json` only. |
| `pdf-error-` | Every channel renders except the PDF, which fails with `render_failed` (characters its font can't draw): `node/pdf.error.json`, no `pdf.meta.json`. |
| `push-error-` | The push is refused on both platforms (`push_payload_too_large`): `push.ios.error.json` and `push.android.error.json`. |
| `sms-error-` | The SMS is refused (`sms_too_long`): `sms.error.json`. |
| `seed-` | A realistic disclosure frozen from the seed by `golden:import`: `seed-<template key>-v<version>-<sample set>`, or `-draft-` for the open draft. Its `input.json` is never rewritten. |
| anything else | A hand-built case from `focused-cases.ts` that renders in every channel it lists. The first word groups it: `lists-`, `spaces-`, `characters-`, `table-`, `push-`, `sms-`, `alert-`, … |

Slugs are lowercase letters, digits and dashes.

## The tests

All four run in `npm test`.

| Test | What it checks | Can an update approve it? |
| --- | --- | --- |
| `golden.test.ts` | Per case: a hand-built case's `input.json` equals what `focused-cases.ts` writes; `expected/` and `node/` hold exactly the files the engine produces, with the same contents. A missing, extra or different file fails and names the file. | Yes: `npm run golden:update` rewrites them. It isn't a vitest snapshot, so `vitest -u` does nothing here. |
| `parity.test.ts` | Per case: the `error-` / `pdf-error-` / `push-error-` / `sms-error-` promise; a message's platforms agree (Android's push is iPhone's without the subtitle) and its `payloadBytes`, encoding, parts and characters are its text measured again, the footer on its own last line; the RenderDoc invariants; the web HTML, email HTML, email text and PDF all show the RenderDoc's content (markers, blank lines, links; typed spaces and every hard break in the HTML); no list markup a browser or mail client would number; zero missing glyphs; the PDF's dates equal `at`; a second run gives identical files and PDF bytes. | No. Plain assertions on the engine's output; nothing on disk changes the outcome. |
| `parity-detects.test.ts` | The parity check checks itself: it plants one defect at a time (a changed marker, a dropped paragraph, collapsed spaces, a changed link address, two cells swapped, a missing glyph, …) in one channel's output of `lists-mixed`, `links`, `blank-lines`, `spaces-and-breaks` and `tables`, and requires `parityProblems` to report it. | No. Renaming or removing those five cases breaks it. |
| `determinism.test.ts` | Every case in every channel, plus probe documents that would leave state behind (a soft hyphen, leading no-break spaces, characters that share a glyph, a character the PDF can't draw), rendered in two fresh Node processes in opposite orders: every output must be identical. | No. |

The golden and parity tests render every case in one long-lived process, so they can't see state a
render leaves for the next one (fontkit's glyph cache, module caches). Only `determinism.test.ts`
can. The PDF's own regression tests for that cache (`src/server/render/channels/pdf-fonts.test.ts`)
use the same fresh-process helper.

## Generating

**`npm run golden:update`** runs `golden.test.ts` with `GOLDEN_UPDATE=1`. It:

1. writes each hand-built case's `input.json` from `focused-cases.ts` (seed cases' `input.json` is
   left alone);
2. renders every case and rewrites its `expected/` and `node/`, deleting files the engine no longer
   produces (and a folder left empty).

It checks nothing else. Run `npm test` afterwards to see whether parity still holds.

**`npm run golden:import -- <templateId|seedKey> <version|draft> <sampleSet> [case-name]`** freezes
one seeded version as a new case: `cases/<slug>/input.json` holds a copy of the version's document,
variables, channel fields and one sample set's values, every channel of its family (and a message's SMS footer), with `at` set to `GOLDEN_AT`. It reads a
throwaway database built by the real seed, never `data/ucomp.db`, so it gives the same file on every
machine. It refuses to overwrite an existing case. Then write the case's output:

```sh
npm run golden:import -- UC-D6KSGY 2 typical                  # → cases/seed-balance-transfer-v2-typical/
npm run golden:import -- balance-transfer 2 long              # a seed key works too
npm run golden:import -- UC-1FY7CY draft long overdraft-long  # the open draft, with a chosen name
npm run golden:update                                         # writes expected/ and node/
```

Editing the seed later never moves a frozen case.

**Determinism.** Everything an output depends on is in `input.json`, including the render time. The
engine reads no clock, locale, time zone or environment. So the same input gives the same bytes on
every run, in any order, in any process (spec section 12). Two `golden:update` runs in a row write
identical files. A diff after an update always comes from a change in code or in `focused-cases.ts`,
never from the run itself.

## When to regenerate

Only when the output is meant to change:

- **An intended change to what the engine prints** (the resolver, an adapter, the spec). Update,
  review every changed file, and say in the commit why the output moved. If `expected/` changed,
  `docs/render-spec.md` must say the same thing, since the Java engine follows the spec.
- **A new or changed hand-built case.**
- **The enterprise font replaces the PDF's fonts** (Liberation Sans and Newsreader today), or the PDF's
  sizes or margins change:
  - `node/pdf.layout.txt` changes in nearly every case (wraps, indents, page breaks), and
    `node/pdf.json` wherever a page count or a link's page moves.
  - `pdf-error-glyphs` lists in `node/pdf.error.json` whatever the new font can't draw. If the new font
    draws all of them, the PDF no longer fails and `parity.test.ts` fails on the `pdf-error-` name:
    give the case characters the new font lacks.
  - `expected/` doesn't change: it's engine-neutral. The exception: if the web page and email adopt
    the font too, every `web.html` and `email.html` changes in its `font-family` only.
  - Recalibrate `NODE_PROFILE` (see [Gotchas](#gotchas)).

Never regenerate to make a test pass without knowing why the output moved.

## Reviewing a golden diff

1. `git diff --stat -- src/server/render/golden/cases` shows which cases and files moved. Changes
   only in `node/` are a PDF layout change. A change in `expected/` changes what the Java engine must
   produce.
2. Read `content.txt` first: it's the content, one block per line. A change there means the document
   reads differently (a marker, a blank line, a value), which is rarely what a layout or styling
   change should do.
3. Then `renderdoc.json` (the structure), then the channel files: `web.html`, `email.html`,
   `email.txt`.
4. In `node/pdf.layout.txt`, a wrap or page break that moves is expected after a layout change; a
   line that disappears is not.
5. Run `npm test`. The golden files were approved by the update; parity wasn't, and must still pass.
6. Invisible characters don't show in a diff. `git diff … | cat -v` makes them visible.

## Adding a case

A hand-built case pins one rule or group of rules:

1. In `focused-cases.ts`, build the document with the builders from `src/server/render/testing/tiptap.ts`
   (`doc`, `p`, `t`, `para`, `h`, `br`, `ul`, `ol`, `li`, `item`, `table`, `row`, `cell`, `callout`,
   `link`, `v` for a variable chip, `variable(...)` for its definition), and wrap it in
   `make(slug, templateName, { body, variables, values, channelFields })`, where `channelFields` is
   `{ email: { subject: line(…), preheader: line(…) } }` for a case about the email's own fields. A
   case renders PDF, web and email unless it says otherwise (`channels`). A push or SMS case uses
   `message(slug, templateName, { channels: ["push"] | ["sms"] | ["push", "sms"], channelFields, smsFooter? })`,
   with no body: `channelFields` is `{ push: { title, subtitle?, body }, sms: { text } }`, each a `line(…)`
   (an SMS's line breaks are `br`).
2. Values go in as a request sends them: strings for text, `num("21.90")` for a JSON number written
   exactly as typed.
3. Add the case to `FOCUSED_CASES`.
4. Run `npm run golden:update`, read the new folder (`content.txt` first), then run `npm test`.

For example (a made-up case):

```ts
const startAtZero = make("lists-start-zero", "A list that starts at 0", {
  variables: [variable("fee", "Fee", "currency", true, "95")],
  values: { fee: "-1234.50" },
  body: doc(
    ol({ start: 0, format: "lower-roman", delimiter: "parens" }, item("Zero"), item("One")),
    p(t("A fee of "), v("fee"), t(", waived\u00a0today.")),
  ),
});
```

A realistic document comes from the seed instead: `golden:import`, then `golden:update`.

New cases join `parity.test.ts` and `determinism.test.ts` automatically. To remove a case, delete it
from `focused-cases.ts` and delete its folder: a folder that still has an `input.json` counts as a
(frozen) case.

## How Java uses them

The Java build reads the same `cases/` folder. For each case it renders `input.json` with its own
engine and checks:

- `renderdoc.json`, `email.json`, `links.json`, `error.json` and `pdf.meta.json` (when present) as
  parsed JSON;
- `web.html`, `email.html`, `email.txt` and `content.txt` byte for byte;
- its own PDF's extracted content against the PDF view of the content text (`VIEWS.pdf` in
  `content.ts`, compared as `compareContent` does, each table cell read on its own), its link
  annotations against `links.json`, and zero missing glyphs.

It ignores `node/`: PDF bytes and layout differ between engines and fonts. Reading its own PDF needs a
`PdfProfile` with its own numbers (`extract-pdf.ts`). It must read the values' JSON numbers from their
source text (a `BigDecimal` or a string, never a double), as the Node route does. The full contract is
`docs/render-spec.md` section 13.

## Gotchas

- **Run from the repository root.** The PDF fonts load from paths joined to `process.cwd()`
  (`pdf-fonts.ts`), `files.ts` finds `cases/` from it, and the fresh processes load
  `vitest.config.mts` from it. npm scripts and vitest already run there. Anywhere else, the PDF fails
  with "PDF font missing".
- **Write invisible characters as `\u` escapes** in `focused-cases.ts` (`"Ver\u00adsicherung"`,
  `"\u00a0"`, `"\u200e"`), never as the literal character. A literal soft hyphen, no-break space or
  bidirectional mark can't be seen in review, and an editor or formatter may drop or change it
  silently. `input.json` holds them as literal characters (`JSON.stringify` doesn't escape them), so
  read those diffs with `cat -v`.
- **`NODE_PROFILE` is calibrated to the Node PDF.** `extract-pdf.ts` tells headings, paragraphs,
  blank lines, table cells and the footer apart by geometry: the footer's line, the body, table and
  heading sizes (headings are matched by exact size), the margin, the paragraph step and gap
  thresholds. These numbers mirror `pdf-styles.ts`. When the PDF's sizes, margins, spacing or font
  change, update them, then run `parity-detects.test.ts`: it fails if the reader stopped seeing
  defects.
- **An update is not a pass.** `golden:update` accepts whatever the engine printed. Only
  `parity.test.ts`, `parity-detects.test.ts` and `determinism.test.ts` decide whether the output is
  right.
- **Order-dependent output is a bug.** If a case gives different bytes depending on what rendered
  before it, a render left state behind. `determinism.test.ts` exists to catch exactly that; don't
  make it pass by changing the order.
