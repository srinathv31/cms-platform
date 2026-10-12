# Review: the render pipeline (`render` slice)

Repo at main @ 0cca665, 2026-10-12. Scope: `src/server/render/**`, `src/domain/render/**`, `src/domain/messages/**`,
`docs/render-spec.md`, decisions 0011, 0034–0039, 0046, 0047, the preview route and the `/api/v1` render route.
Evidence tags: `measured` (ran it), `verified` (read the code/file), `traced` (followed, not run).

## 1. Summary

This is the best-built part of the codebase I would expect to see in a prototype, and the owner's claim that it is the template for the rest holds. The render engine is a real seam: `runEngine` (stages 6–9) takes a plain `EngineInput` and a `Date`, reads no database, clock or request, and is the one implementation the consumer route, the CMS preview, the 60 golden cases and the fresh-process determinism test all run (`verified`: `src/server/render/engine.ts`, `golden/pipeline.ts:79`, `testing/fresh-process.ts`). Business rules (value grammar, link check, list markers, removal rule, GSM-7 tables, grapheme clusters pinned to Unicode 17.0) live in pure TypeScript under `src/domain` and `src/editor/model`, and the message renderer runs byte-identically in the browser (`src/components/preview/message-preview.ts`) and on the server. I checked about 35 normative statements of `docs/render-spec.md` against the code and a golden file each and found no behavioural disagreement; the two disagreements I found are stale doc comments in `src/domain/render/types.ts`, not code. The slice's 1,222 tests pass in 4.2 s wall-clock (`measured`), including 60 golden cases × 3 checks, 300 parity assertions, 24 planted-defect detections, and two fresh Node processes rendering every case in opposite orders. Escaping is correct and `javascript:`/`data:` hrefs are refused by a single scheme whitelist that the resolver and both HTML adapters each apply. The weaknesses are concentrated in the PDF adapter's lower layers (`pdf-text.ts`, `pdf-fonts.ts`) and the golden tooling (`extract-pdf.ts`, `content.ts`), which depend on react-pdf/fontkit/pdf.js internals and on calibrated magic numbers; a human will need an afternoon with each. The golden corpus has a few holes a Java engine would fall through (no `invalid_values`-only case, no 1,000-character refusal, no push/SMS field-shape refusal, no RTL or CJK text, no `round`-labelled preview). The spec is long (16k words) and in places written as a changelog ("unchanged", "before this change", "as today"), which a Java engineer with no history cannot resolve.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 9 | `runEngine` is a genuine seam used by route, goldens and fresh processes; domain is pure and browser-shared; lint boundaries hold (`npx eslint` on the slice: 0 problems, `measured`). |
| 2 | Correctness & robustness | 8 | No behavioural spec/code disagreement in ~35 sampled rules; determinism proven across processes; residual: an unbounded glyph-coverage cache, unverified react-pdf concurrency, 500 on legitimate non-Latin input by design (R3). |
| 4 | API & contract | 8 | One error shape, 17 stable codes with a status table, typed `details`, exact sentences, consumer/preview split (0047); still TypeScript-only (A5 open), `preview_forbidden` in the public code set, `RenderBody` is an untagged union read through casts. |
| 6 | Readability for humans | 7 | `resolve.ts`, `engine.ts`, `render-template.ts`, `html.ts`, `email.ts`, `gsm7.ts`, `list-markers.ts` read in minutes; `pdf-text.ts`, `pdf-fonts.ts`, `extract-pdf.ts`, `content.ts` need library internals and calibration knowledge; comment prose is dense everywhere. |
| 7 | Test quality | 9 | 1,222 tests in 4.2 s; goldens + parity + parity-detects + determinism form a layered net; Unicode conformance file and Twilio cross-check for SMS; gaps are in the corpus (below), not in the mechanism. |
| 8 | Documentation | 8 | The spec and golden README are the best docs in the repo; against that: stale `types.ts` comments that contradict the spec, history-relative wording in §7/§10/§11/§14, hardcoded case counts in §13, a server README sentence that misstates logging. |
| 11 | Handoff readiness (Java) | 8 | Explicit character sets, pinned Unicode version, JSON-number source-text rule, a 60-case corpus and a "how Java consumes them" section; open: PDF cell detection for Java (already filed), pagination rules not marked non-normative, fonts pending, byte-exact CSS requirement for web/email. |

## 3. Strengths

- **The engine seam is real, not aspirational.** `runEngine(input, target, at)` (`src/server/render/engine.ts:95`) has four callers: `render-template.ts:263`, `golden/pipeline.ts:79`, `testing/fresh-process.ts`, and the golden README documents it. The route adds only lookup, who-is-asking, version rules, channel checks and the log row, each numbered in the file header (`render-template.ts:31-51`). `verified`.
- **Spec and code agree on everything I sampled.** Values grammar and no-rounding (`values-formats/expected/content.txt`: `6.875%`, `$1,000,000,000,000,000,000,000`, `21.90%` from a JSON number), per-list renumbering after removal (`optional-variables/expected/content.txt`: `1. 2. a. b. 3. a. 4.` then `7.`), marker fallbacks (`lists-start-numbers`: `MMMCMXCIX.` then `4000.`, `(0)`, `10000)`), soft hyphen removed (`characters-soft-hyphen`), NFC and zero-width removal (`unicode-nfc-zero-width`), 12-column cap (`table-12-columns` renders; `error-table-too-wide` refuses with the exact sentence), SMS parts at 160/161/306/307 (1/2/2/3), push bytes (iOS 5,046 vs Android 5,057, the 11-byte envelope difference), link normalization (`links/expected/links.json`: `caf%C3%A9`, scheme lowercased, host case kept). `verified` against both code and golden files.
- **Determinism is tested the only way it can be.** `golden/determinism.test.ts` spawns two fresh Node processes via Vite's module runner, renders all 60 cases in opposite orders plus probes for the exact bugs that bit before (soft hyphen, leading NBSP, shared glyphs, unrenderable character), and demands identical bytes. Ran in 1.8 s. `measured`.
- **The parity check checks itself.** `parity-detects.test.ts` plants 24 defects (a changed marker, a dropped blank paragraph, swapped PDF cells, a changed link address, `<ol start>`, `aria-hidden` on a marker) and requires `parityProblems` to catch each. This is what makes "golden:update is not a pass" true in practice. `measured` (24 tests pass).
- **XSS is handled at one chokepoint per channel.** `escapeHtml` (`html.ts:36`) covers `& < > " '` and NBSP for both content and attributes; `groupByLink` re-runs `normalizeLink` on every href so no RenderDoc can smuggle a scheme (`html.ts:141`); `checkLink` refuses `javascript:`, `data:`, `ftp:`, backslashes, userinfo and non-ASCII hosts (`links.ts:105-128`), and the `links` golden input contains all of those (`verified`). The `escaping` golden's web.html shows `<script>` values entity-escaped in paragraphs, cells, callouts and list items. The web response carries a `default-src 'none'` CSP (`render-http.ts:99`).
- **Messages are measured like a carrier measures them.** `gsm7.ts` is sourced to 3GPP TS 23.038/23.040, GSM0338.TXT and Twilio's calculator, with the Ç/ç decision written down; `graphemes.ts` implements UAX #29 over a generated 6 KB table and passes Unicode's own 766-case `GraphemeBreakTest.txt` (`measured`); `push.ts` counts UTF-8 bytes of the actual APNs/FCM JSON and documents it as a lower bound. The browser and server share the function (decision 0036; `message-preview.ts` imports `renderMessage`, `verified`).
- **Error taxonomy is one table.** `RenderErrorCode` (17 codes) and `RENDER_ERROR_STATUS` sit in `types.ts:357-394`; every message is built by one function in `errors.ts`; `errors.test.ts` asserts "every code has a status" and that no value is ever echoed. `render-template.test.ts:538` scans every `render_log` column for any submitted or formatted value. `verified`.
- **Human-reviewable goldens.** `expected/content.txt` is one logical block per line with `∅` for blanks and markers inline; `node/pdf.layout.txt` shows wraps, page breaks and footers as text (sample: `seed-cash-back-v2-typical`). The README tells a reviewer to read `content.txt` first and why. `verified`.
- **Hostile-input hardening is not theoretical.** Table grids use merged ranges so a colspan of a billion costs nothing (`table-grid.ts:81-84`); the PDF bounds width and spans again defensively (`pdf.tsx:434-474`); list depth, start and columns are capped at save and at render; the body reader counts bytes and cancels the stream (`read-body.ts`). R1/R4/R5 are genuinely closed. `verified`.

## 4. Findings

### Medium

**M1. The golden corpus cannot catch a Java engine that gets `invalid_values` wrong.** `verified`
- Where: `src/server/render/golden/cases/` (60 cases); `focused-cases.ts:573` (`error-invalid-values`).
- What: `grep -l '"code": "invalid_values"'` over the cases returns nothing. The one "invalid values" case also omits a required variable, so its `error.json` is `missing_variables` (the spec's precedence rule). There is also no case for the 1,000-character refusal (`maxLength` appears in no golden), none for a push or SMS field-shape refusal (`pushField`/`smsField` sentences appear in no golden), and the fixture has no `round`, so the `UC-… · v3 · Round 2` footer/subject is pinned only by `render-template.test.ts:182`.
- Why it matters: the spec (§13) and README name the goldens as the acceptance test for the Java engine. Of the five error codes the engine itself can return, one (`invalid_values`) has no golden at all, and the `maxLength` detail that decision 0011 made part of the contract is untested there.
- Fix: add `error-invalid-values-only`, `error-value-too-long` (a 1,001-code-point value, with an emoji), `error-push-field` and `error-sms-field` to `focused-cases.ts`; add an optional `round` to `RenderFixture` and one `*-round-2` case.

**M2. `types.ts` contradicts the spec in two doc comments, and the spec says `types.ts` is its TypeScript form.** `verified`
- Where: `src/domain/render/types.ts:52` and `:33-36`.
- What: `RenderBreak` says "Paragraph and heading content never ends with one (they are stripped)". The spec (§4 "Hard breaks", §8 "Every break stays, one at the end of the content included") and `resolve.ts:419-423` say the opposite, and `spaces-and-breaks/expected/renderdoc.json:133-137` ends a paragraph with two breaks. `RenderText` lists only "U+200B–U+200D, U+2060, U+FEFF" as the removed zero-width set; the spec §4 and `INVISIBLE_CHARACTERS` (`links.ts:72-75`) remove a far larger set (soft hyphen, bidi controls, variation selectors, tags).
- Why it matters: a Java developer is told (`types.ts:2-3`, spec §9) to read this file as the shape of the contract. Both comments would lead them to drop a trailing break and to keep a soft hyphen, and the goldens would then fail for a reason they would have to debug.
- Fix: rewrite the two comments to match §4/§8, or replace them with a pointer to the spec section.

**M3. `pdf-text.ts` and `pdf-fonts.ts` are the two files a human will struggle with, and they hold the slice's riskiest knowledge.** `verified`
- Where: `src/server/render/channels/pdf-text.ts:222-329` (`breakLines`), `pdf-fonts.ts:118-142, 62-70, 200-209`.
- What: `breakLines` is ~110 lines with six mutable locals (`used`, `room`, `empty`, `lead`, `gap`, `lines`), a `Map<Piece, Edit[]>` of in-place string surgeries applied in reverse offset order, and identity-keyed `Set`s (`leads`, `joined`) passed from `prepareText`; the loop body has four nested state transitions and single-letter names (`c`, `e`, `k`). `pdf-fonts.ts` monkeypatches react-pdf's registry (`families.Helvetica.sources = families[SANS].sources`), reaches into `Font.getFont(...).data` for fontkit's object, primes fontkit's private glyph cache in a specific order, and `hangsAtLineStart` depends on react-pdf's layout treating a glyph as whitespace when its cached `codePoints` include U+0020. `pdf.tsx:80-90` patches bytes of the finished PDF to rename `/ModificationDate`.
- Why it matters: none of this is wrong today and all of it is tested (R9/R10 fresh-process tests, `pdf.test.ts` pins `/ModDate`, determinism). But `package.json` uses caret ranges (`@react-pdf/renderer ^4.9.0`, lockfile pins 4.9.0), and a minor bump that changes fontkit's cache or react-pdf's font registry fails in ways only these tests explain. A maintainer who has not read the 20-line comment at `pdf-fonts.ts:118-131` cannot reason about the file.
- Fix: pin `@react-pdf/renderer` and `pdfjs-dist` exactly in `package.json` (not only the lockfile) and say why in a comment; split `breakLines` into `placeLead`, `placeWord`, `applyEdits`; replace the identity `Set`s with flags on `Piece` (`isLead`, `isJoined`).

**M4. `content.ts` (788 lines) mixes five concerns in one file.** `verified`
- Where: `src/server/render/golden/content.ts`; functions at lines 92–767.
- What: content-text derivation from the RenderDoc (`contentFromRenderDoc`), DOM extraction from HTML with happy-dom (`contentFromHtml`, `verbatimFromHtml`), the plain-text expectation (`plainTextFromRenderDoc`, duplicating the layout rules of `email.ts` so the test can be independent), PDF block comparison (`contentFromPdf`), generic diffing (`diffLines`, `diffBy`, `eq`) and list-markup linting (`listMarkupProblems`). Nine lines exceed 160 characters.
- Why it matters: it is test-only, but the spec names it as "the reference implementation" the Java build repeats (§13), so a Java engineer must read it. The file's 55-line header is good; the body is a long scroll.
- Fix: split into `content-text.ts` (reference), `content-html.ts`, `content-plaintext.ts`, `content-pdf.ts`, `diff.ts`. Keep the header where it is and point to the four.

**M5. The spec leans on history a Java reader does not have.** `verified`
- Where: `docs/render-spec.md` §7 ("before this change it showed `a.`"), §10 PDF ("Pagination rules are unchanged (keep-with-next headings, widows and orphans, …)"), §11 ("(as today)"), §14 (a 35-row "Before / Now" table).
- What: AGENTS.md says "Describe what the code does now, not how it got there." §14 is a changelog inside a normative document; "unchanged" in §10 refers to a state nobody porting from the spec has seen. The pagination constants (intro ≤ 3 lines, items ≤ 5 lines move whole, callouts ≤ 200 pt, 2 orphan/widow rows, keep ≤ 45% of the page, runs ≤ 50%, rows split past 60%) exist only in `pdf.tsx:168,205,371,477-485,593`.
- Why it matters: layout is correctly declared non-normative ("not compared across engines"), but the sentence says "unchanged", not "not normative; these are the Node engine's choices". A reader has to guess whether Java must reproduce them.
- Fix: move §14 to `docs/archive/` or a decision record; replace "unchanged" with the list of rules and the words "Node engine only; a second engine chooses its own"; delete "(as today)" and "before this change".

### Low

**L1. The glyph-coverage cache has no eviction.** `verified` — `pdf-fonts.ts:174` `coverage = new Map<string, boolean>()` grows one entry per `(face, codePoint)` ever checked and is never cleared, while the neighbouring `widthCache` is capped at 20,000 (`:163`). A consumer sending values that walk the Unicode space (1,000 code points per value, many variables, many requests) grows it monotonically; worst case is ~9M entries. Fix: the same `if (size > N) clear()` as `widthCache`, or a per-render `Map` inside `GlyphCheck`.

**L2. No golden contains right-to-left or CJK body text.** `measured` — `grep -P '[\x{0590}-\x{08FF}]'` over `cases/*/input.json` matches only the two emoji message cases (Arabic-range code points inside emoji sequences); no CJK anywhere. Web and email would render Hebrew or Chinese as-is (no `dir` attribute, `lang="en"` hardcoded in `web.ts:101`); the PDF would refuse with `render_failed` (R3). The spec is silent on bidi. For a US bank this may be acceptable, but a customer name in Arabic is R3's own example class. Fix: one `characters-scripts` case rendering web/email only (channels `["web","email"]`), and a sentence in §10 saying bidi is left to the client.

**L3. Spec §13 hardcodes the case census.** `verified` — "There are 60 cases: 52 hand-built (13 of them `error-*`…) and 8 `seed-*`" is true today (counted on disk) and will be false after M1. Fix: drop the numbers or derive the sentence in the README from `caseSlugs()`.

**L4. The server README misstates what the log does with a 422 message refusal.** `verified` — `src/server/README.md:198` says `push_payload_too_large`/`sms_too_long` are refused "which the route doesn't log as a failure". `render-template.ts:162-163` writes a `render_log` row with `outcome: "error"` and the code for every result after stage 2; what it skips is the `console.error` in `reportFailure` (`:282`). Fix: "which the route logs like `invalid_values` (a row, no server-log line)".

**L5. `RenderBody` is an untagged union read through `as` casts.** `verified` — `engine.ts:73` `type RenderBody = Uint8Array | string | EmailRender | PushRender | SmsRender`; `render-http.ts:126,134,141,150,154` and `pipeline.ts:107-117` cast by the sibling `channel` field. A tagged union (`{ channel: "pdf"; body: Uint8Array } | …`) would let `assertNever` do the work. Readability and type-safety, not a bug.

**L6. react-pdf concurrency under parallel requests is not verified anywhere.** `traced` — `renderPdf` (`pdf.tsx:61`) calls `renderToBuffer` with a process-global `Font` registry and no queue; all tests render serially or in separate processes. react-pdf 4.x is generally safe for concurrent `renderToBuffer`, but nothing here proves it, and a BFF under load will do exactly that. Fix: one test that fires 8 concurrent `renderPdf` calls on different docs and compares each to its serial bytes.

**L7. `extract-pdf.ts` is calibrated, not derived.** `verified` — `NODE_PROFILE` (`:47-58`) holds `paragraphStepEm: 2.12`, `blockGapEm: 1.6`, the `0.85` rounding in `blanksBetween` (`:346`), and `0.2 * size` for word gaps (`:216,275`). The README's Gotchas section says so and `parity-detects` guards it, which is the right design; it is still a file no one will change confidently. Fix: a comment on each constant naming the `pdf-styles.ts` value it mirrors (some do, `0.85` and `0.2` do not).

**L8. No `README.md` in `src/server/render` or `src/domain/render`.** `verified` — `docs:check` requires READMEs only directly under `src/` (`scripts/docs-check.ts` lines 5, 172-178), so this passes; the server README's render paragraph (`src/server/README.md:198`) is one 1,100-word paragraph. The owner's memory says they want READMEs beside modules (golden has one and it is the model). Fix: a short a README in src/server/render that lists the files and points at the spec, the golden README and `engine.ts`.

**L9. `focused-cases.ts` (904 lines) is the only place the 52 hand-built inputs exist.** `verified` — By design (the README explains why). A Java team reading `input.json` files won't see the intent comments; a Node reader has to scroll a 900-line file. Fix: none needed now; if it grows, split by the section headers already in the file (lists, spaces, links, tables, messages).

### Readability notes a Java developer should hear (one sentence per file asked for)

- `src/domain/render/resolve.ts`: a depth-first walk of TipTap JSON with one function per node type and a `Scope` for depth and cell context; readable top to bottom in ten minutes and portable line for line.
- `src/domain/render/types.ts`: mostly documentation of the RenderDoc, the response bodies and the error table; read it after the spec, and note M2.
- `src/server/render/engine.ts`: a 200-line stage machine (6 validate, 7 check, 8 resolve, 9 adapt) with `assertNever` on every switch; the clearest file in the slice.
- `src/server/render/render-template.ts`: the ten stages as numbered comments over two functions, with database and time as arguments so tests can inject them; clear.
- `src/server/render/channels/pdf.tsx`: a custom layout model (`Laid { head, height, render }`) steering react-pdf's page breaker with keep-with-next chains, orphan/widow runs and a grid approximation; well commented, but you need to know react-pdf's `wrap`, `fixed` and `minPresenceAhead` to follow it.
- `docs/render-spec.md`: yes, a Java engineer can implement stages 6–9 from it alone, with three caveats: the schema's "misplaced node" semantics are summarised in §2's table rather than stated as content expressions; pagination is Node-only but not labelled so (M5); and byte-exact `web.html`/`email.html` means copying the CSS strings from the goldens, not from the spec.

## 5. Backlog check

| Finding | Status line | Is it true? |
| --- | --- | --- |
| R9 Critical (soft hyphen drops hyphens) | Fixed, PR #6/#7 | **True.** `pdf-fonts.ts:136-142` primes the cache in code-point order; `pdf-fonts.test.ts:130,136` and `determinism.test.ts` probes run in fresh processes (`measured`, 1.0 s and 0.48 s). |
| R1 High (span/list number hangs) | Fixed | **True.** `table-grid.ts:81-84` merged ranges; `pdf.tsx:434-474` `bounded`; `list-markers.ts:76` roman fallback past 3999; `pdf.test.ts:529` "bounds a malformed table's width and spans instead of hanging" (`measured`). |
| R2 High / D5 High (rounding) | Fixed | **True.** `variables.ts:195-252` never touches `Number`; `values-formats/expected/content.txt` shows `6.875%`, `$0.000001`, 22-digit currency (`verified`). |
| R3 High (missing glyphs) | Partly fixed; waits for the font | **True.** `GlyphCheck` refuses before layout (`pdf.tsx:64-66`); `pdf-error-glyphs/node/pdf.error.json` names 7 characters. The font swap is still open and correctly parked under "The enterprise font". |
| R10 High (leading NBSP) | Fixed | **True.** `pdf-text.ts:69,139-150` and `hangsAtLineStart`; `pdf-fonts.test.ts:192,199` and `spaces-leading-*` goldens. |
| R4 Medium (exponential nesting) | Fixed | **True.** `pdf.tsx:388-390` explicit widths; `pdf.test.ts:543` "lays out deep lists in linear time" (`measured`). |
| R5 Medium (34+ columns) | Fixed | **True.** `MAX_TABLE_COLUMNS = 12`; `pdf-text.ts:114-115` guards `limit <= 0`; `pdf.test.ts:620` "never loops or throws in a box narrower than a glyph". |
| R6 Medium (channels disagree) | Fixed | **True.** Markers, blanks and links are decided in the RenderDoc; parity enforces it (`pipeline.ts:222-245`). |
| R7 Low (non-deterministic PDF) | Fixed | **True.** Dates from `at` (`pdf.tsx:62,92-96`); byte comparison in `parity.test.ts:68-73` and across processes. |
| A1 High (preview on the public endpoint) | Done (0047) | **True.** Two routes; `/api/v1` ignores `round` and refuses `"draft"` (`render/route.ts:27`); preview reads `getViewer()` (`preview/route.ts:57`). |
| N23 Low (log lacks platform) | Fixed (0039) | **True.** `render-template.ts:159`, `log.ts:20`. |
| N7 Low (sample values no 1,000 limit) | Fixed (0011 amendment) | Not in this slice's files; the decision record is amended consistently with `MAX_VALUE_LENGTH` in `variables.ts:106` (`verified`). |

New, not in the backlog: M1, M2, M3 (the pinning half), M4, M5, L1, L2, L3, L4, L5, L6, L8. The backlog's "Follow-ups from the render work" already lists PDF cell detection for Java and the font swap.

## 6. For the Java team

**Ports cleanly (translate, don't redesign):**
- Stages 6–8 entirely: `validate.ts`, `json-number-text.ts` (use Jackson's raw token text or `BigDecimal.toPlainString()` — never a `double`), `resolve.ts`, `variables.ts` (dates from a fixed table, no `Locale`), `links.ts`, `list-markers.ts`, `characters.ts`, `table-grid.ts`, `document-check.ts`. Every character set is written as an explicit range; the spec names `java.text.Normalizer`, `codePointCount`, `toUpperCase(Locale.ROOT)` where Java differs.
- Messages entirely: `gsm7.ts` (two tables, one split loop), `push.ts` (UTF-8 length of compact JSON — make sure your serializer does not escape non-ASCII), `graphemes.ts` with ICU4J 78 or a port of the 6 KB table, checked against the shipped `GraphemeBreakTest.txt`.
- The web and email HTML adapters, with one warning: `web.html` and `email.html` are compared byte for byte, so the CSS and inline-style strings are copied from the goldens, not designed in Java.
- The error table (`types.ts:357-394`, `errors.ts`): codes, statuses, sentences and `details` shapes are the contract.

**Needs rethinking or new work:**
- The PDF. Node's layout (react-pdf + a hand-rolled greedy line breaker) is not portable and is declared non-normative. Java needs its own PDF library (PDFBox is the obvious choice: embedded TTF subsets, link annotations, `/Lang`, info dictionary dates), its own line breaking under the rule "break only at U+0020, never insert a glyph, cut a too-wide word bare", its own glyph check before layout, and its own `PdfProfile`-equivalent to extract text and table cells for the parity comparison (filed in the backlog's follow-ups).
- Fonts: today Liberation Sans + Newsreader from `node_modules`. The enterprise font decision (R3/T8) must land as a coverage statement in the spec before Java chooses its embedded set; `pdf-error-glyphs` must then be re-aimed at characters the new font lacks.
- Stages 1–5 and 10 are SQL and identity: `findRound`, `checkVersion` (pure; port it), `previewAllowed` (reads approval stages and approvals), the `render_log` row with `platform` nullable (0039). The 90-day consumer-notice window keys off `render_log.consumer_id`, so keep the row shape.

**The corpus:** `src/server/render/golden/cases/<slug>/input.json` + `expected/*`; ignore `node/`. Read `src/server/render/golden/README.md` § "How Java uses them" and spec §13. Add the cases in M1 before you start, so your first green run means more.

**Read first, in this order:** `docs/render-spec.md` (§1, §5, §6, §7, §8, §9, §11, §13), `src/domain/render/types.ts`, `src/domain/render/resolve.ts`, `src/editor/model/variables.ts` + `links.ts` + `list-markers.ts`, `src/server/render/engine.ts`, `src/server/render/golden/README.md`.

## 7. Files that are models of good code / files a human will struggle with

**Models of good code in this slice**
- `src/server/render/engine.ts` — the stage machine; every branch ends in `assertNever`.
- `src/domain/render/resolve.ts` — one function per node, explicit character sets, a `Scope` instead of globals.
- `src/server/render/render-template.ts` — numbered stages, database and time as parameters.
- `src/server/render/channels/html.ts` + `web.ts` + `email.ts` — one structure, two flavors; the no-break-space technique and the plain-text layout are spec'd line for line.
- `src/domain/messages/gsm7.ts` and `src/domain/messages/README.md` — sourced, cross-checked, and honest about where it differs from Twilio.
- `src/editor/model/list-markers.ts` and `links.ts` — small, pure, with the spec section named at the top.
- `src/server/render/golden/README.md` and `golden/golden.test.ts` — the golden mechanism explained in the order a reviewer needs it.
- `src/server/render/golden/parity-detects.test.ts` — a test that proves the test.

**Files a human will struggle with**
- `src/server/render/channels/pdf-text.ts` — `breakLines`'s in-place edit log and identity sets (M3).
- `src/server/render/channels/pdf-fonts.ts` — fontkit cache priming and react-pdf registry patching; correct, but you must trust the 20-line comment (M3).
- `src/server/render/golden/extract-pdf.ts` — pdf.js operator-list parsing with `any`, matrix math and calibrated thresholds (L7).
- `src/server/render/golden/content.ts` — five concerns, 788 lines (M4).
- `src/server/render/channels/pdf.tsx` — readable, but the pagination heuristics (`keepAheadOf`, `introduces`, `keepRuns`, `grid`) take a react-pdf mental model to follow.
- `docs/render-spec.md` — excellent and exhausting at 16k words; §14 is history in a reference document (M5).
