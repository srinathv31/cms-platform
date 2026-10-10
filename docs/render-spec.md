# Render engine specification

This document specifies Stencil's render engine: how a template version's stored document and a request's variable values become a web page, an email (subject, preheader, HTML and plain text) and a PDF, and how a message template's own short fields become a push notification or an SMS. It is written so a second engine (the planned Java service) can be built from it without reading the TypeScript, and so the Node engine can be checked against it.

A template is a **document** or a **message**, never both ([decision 0033](decisions/0033-message-channels-families-and-the-fields-registry.md)). A document (a Disclosure) renders its one body to PDF, Web and Email. A message (an Alert) renders its own fields to Push and SMS and never reads a body. A content type allows the channels of one family only.

The product rule behind every section:

> Whatever the author types in the editor and sees in the preview renders exactly the same in every channel. The engine only converts what the author created into channel formats. No rounding, no optimization, no dropping, no renumbering, no altering.

Visual styling (fonts, sizes, spacing, colors) may differ per channel. Content and structure may not.

Where this document and the code disagree, one of them has a bug. The example tables in the test files named below are part of this specification; a Java port runs the same rows.

| Topic | Normative examples (TypeScript reference) |
| --- | --- |
| List markers | `src/editor/model/list-markers.test.ts` (`list-markers.ts`) |
| Links | `src/editor/model/links.test.ts` (`links.ts`) |
| Values | `src/editor/model/variables.test.ts` (`variables.ts`) |
| JSON numbers in requests | `src/domain/render/json-number-text.test.ts` |
| Value checks, the length limit among them | `src/domain/render/validate.test.ts` (`validate.ts`) |
| Push and SMS output | `src/domain/render/message.test.ts` (`message.ts`) |
| SMS encoding, characters and parts | `src/domain/messages/gsm7.test.ts` (`gsm7.ts`) |
| Push payload size | `src/domain/messages/push.test.ts` (`push.ts`) |
| Byte-level channel output | the golden files, `src/server/render/golden/` |
| RenderDoc shape | `src/domain/render/types.ts` |

Contents:

1. Pipeline
2. Stored document: the accepted TipTap JSON
3. Normalization and validation at save
4. Text: characters, spaces, breaks and blank lines
5. Values
6. Links
7. Lists and markers
8. Resolution: from TipTap JSON to RenderDoc
9. The RenderDoc
10. Channels: web, email, PDF, push, SMS
11. Errors
12. Determinism
13. Golden files
14. What stays the same, what changes

---

## 1. Pipeline

`POST /api/v1/templates/{templateId}/render` runs these stages in order. The first stage that fails ends the request with the error shown (section 11).

| # | Stage | Fails with |
| --- | --- | --- |
| 1 | Find the template (and its content type) | 404 `template_not_found` |
| 2 | Find the version by number, or the open draft (preview only) | 404 `version_not_found` |
| 3 | Preview: the viewer may see the template. Consumer: the consumer is registered | 403 `preview_forbidden` / `unknown_consumer` |
| 4 | Version rules (consumers only): released, not sunset, not revoked | 409 / 410 |
| 5 | The channel is allowed by the content type and enabled on the version | 422 `channel_not_allowed` / `channel_not_enabled` |
| 6 | **Validate values** against the version's variable list (section 5) | 422 `missing_variables` / `invalid_values` |
| 7 | **Check the document**: a document channel's body passes the document check (section 3); a message channel never reads the body. Then the rendered channel's own fields (for email, the subject and then the preheader; for push, the title, subtitle and body; for SMS, the message), each that has a value, pass the check for its shape (section 2, "Field shapes"), then the schema parse | 500 `render_failed` |
| 8 | **Resolve**: a document's TipTap JSON and the canonical values into a RenderDoc (section 8), and the channel's fields into text | 500 `render_failed` |
| 9 | **Channel adapter**: RenderDoc → web HTML, email, or PDF; or the message's text → a push for its platform, or an SMS, measured against its limit (section 10) | 500 `render_failed`; a message over its limit: 422 `push_payload_too_large` / `sms_too_long` |
| 10 | Write one `render_log` row for every request that reached stage 3, whatever the outcome (never values) | — |

Before stage 1 the route checks the request itself: the body's size (at most 1,000,000 bytes, else 413 `body_too_large`), then its shape, `version: "draft"` only with `preview: true`, a `platform` (`ios` or `android`) with channel `push` and with no other channel, no `encoding` with push or SMS, and an `X-Consumer-Id` header unless it is a preview (400 `bad_request` / `consumer_required`). The size is refused from a declared `Content-Length` before anything is read, and otherwise as soon as the bytes read pass the limit: a chunked body has no length, so the count is what holds. Nothing past the limit is buffered. Those refusals, and refusals at stages 1–2, are not logged. Something that fails outside the engine (the database, the log write) answers 500 `render_failed` with "… Try again.".

Stages 6 to 9 are the engine (in the Node code, `src/server/render/engine.ts`, which the route and the golden tests both run; for push and SMS, stages 8 and 9 are `renderMessage` in `src/domain/render/message.ts`, the same function the composer's preview runs in the browser). Stages 6 to 8 must give identical results in every engine. They are the same for every channel, except that stage 7 also checks the channel's own fields and stage 8 resolves them, a message channel skips the body, and a `render_failed` message names the channel (section 11). Stage 9 must give identical content in every channel.

Inputs to the engine (and nothing else): the version's `body` and `channelFields` (TipTap JSON; see "Channel fields" in section 2), the version's variable list, the request's `values`, the template id, the rendered version's name (a numbered version keeps the name it was submitted and approved with, so a later rename never reaches it; a draft preview uses the draft's name as it stands), the version number (or none for a draft), the channel and, for push, the platform, the content type's SMS footer (`content_types.sms_footer`, or none), and the render time `at` (used only as the PDF's creation and modification date).

---

## 2. Stored document: the accepted TipTap JSON

A template body is TipTap (ProseMirror) JSON: `{ "type": "doc", "content": [ … ] }`. Every node is `{ "type", "attrs"?, "content"?, "marks"?, "text"? }`. This is the full content model after this change. Anything else is refused by the document check (section 3). Attributes are the exception: one not listed below is ignored (and dropped at save), and a value is refused only where section 3 says so.

### Nodes

| Node | Allowed inside | Content | Attributes |
| --- | --- | --- | --- |
| `doc` | — (the root) | one or more blocks | — |
| `paragraph` | `doc`, `listItem`, `tableCell`, `tableHeader`, `callout` | inline nodes, zero or more | `id` |
| `heading` | `doc`, `listItem` (not inside a cell) | inline nodes, zero or more | `id`, `level`, `requiredKey` |
| `bulletList` | `doc`, `listItem`, `tableCell`, `tableHeader` | `listItem`, one or more | `id` |
| `orderedList` | `doc`, `listItem`, `tableCell`, `tableHeader` | `listItem`, one or more | `id`, `start`, `markerFormat`, `markerDelimiter`, `type` (ignored) |
| `listItem` | `bulletList`, `orderedList` | a `paragraph`, then zero or more blocks (inside a cell: paragraphs and lists only) | `id` |
| `table` | `doc`, `listItem` (not inside a cell) | `tableRow`, one or more | `id` |
| `tableRow` | `table` | `tableCell` / `tableHeader`, zero or more (an empty row passes only when rowspans from above cover every column) | — |
| `tableCell`, `tableHeader` | `tableRow` | `paragraph`, `bulletList` or `orderedList`, one or more | `colspan`, `rowspan`, `colwidth` (removed at save), `align` (removed at save) |
| `callout` | `doc`, `listItem` (not inside a cell) | `paragraph`, one or more | `id` |
| `horizontalRule` | `doc`, `listItem` (not inside a cell) | — | `id` |
| `text` | inline | — | marks: `bold`, `italic`, `underline`, `link` |
| `hardBreak` | inline | — | — |
| `variable` | inline (an atom) | — | `key`; marks: `bold`, `italic`, `underline`, `link` |

"Blocks" are `paragraph`, `heading`, `bulletList`, `orderedList`, `table`, `callout` and `horizontalRule`. Inside a table cell, at any depth, there are only paragraphs and lists: a cell's children, and the children of every list item inside a cell (in nested lists too), are paragraphs and lists. No tables, headings, rules or callouts anywhere inside a cell. Outside a table, a list item may hold any block after its first paragraph.

### Attributes and their allowed values

| Attribute | On | Allowed values | Absent / null means |
| --- | --- | --- | --- |
| `id` | blocks and list items | a non-empty string (stable block id); any other value is not refused and reads as no id | no id (`null` on RenderDoc blocks; a list item's id is not carried) |
| `level` | `heading` | `1`, `2`, `3` | `1` (the schema's default); `null` or any other value is refused |
| `requiredKey` | `heading` | a required section's key, e.g. `"legal_notices"`; anything but a non-empty string means an ordinary heading | an ordinary heading |
| `start` | `orderedList` | an integer from `0` to `9999` | `1` |
| `markerFormat` | `orderedList` | `"decimal"`, `"lower-alpha"`, `"upper-alpha"`, `"lower-roman"`, `"upper-roman"` | the default for the list's depth (section 7) |
| `markerDelimiter` | `orderedList` | `"period"`, `"paren-right"`, `"parens"` | `"period"` |
| `type` | `orderedList` | TipTap's own attribute, any value; ignored by the engine | — |
| `colspan`, `rowspan` | cells | an integer ≥ 1 that stays inside the table (section 3) | `1` |
| `key` | `variable` | a variable key (`[a-z][a-z0-9]*(_[a-z0-9]+)*`, at most 64 characters); not checked: one that isn't a string in the version's variable list renders nothing (section 8) | renders nothing |
| `href` | `link` mark | a link that passes the link check (section 6); not refused otherwise: a failing one loses its mark at save, and the resolver drops it | no link |

JSON numbers are compared by value (`3.0` is 3). Strings and fractions are refused where an integer is required. `align`, `colwidth` and TipTap's `type` may appear in stored documents with any value (documents stored before save normalization removed them) and are ignored.

The `link` mark may also carry `target`, `rel`, `class` and `title`; the engine ignores them.

In the editor's HTML (clipboard, static render) the numbering attributes appear as `data-marker-format` and `data-marker-delimiter` on the `<ol>`, and `start` as the `start` attribute.

### Channel fields

A channel can have short fields of its own, printed by that channel only. They are declared once, in a registry (in the Node code, `src/domain/channel-fields.ts`), each with a key, a label, a shape and whether submit requires it:

| Channel | Field | Shape | Required at submit | Notes |
| --- | --- | --- | --- | --- |
| Email | `subject` | `line` | yes | |
| Email | `preheader` | `line` | no | |
| Push | `title` | `line` | yes | |
| Push | `subtitle` | `line` | no | iPhone only: Android's push never carries it |
| Push | `body` | `paragraph` | yes | no public link shortener (submit) |
| SMS | `text` | `lines` | yes | GSM-7 as typed, no public link shortener (submit) |

PDF and Web have none. A version stores them as one JSON object, `channelFields` (the `versions.channel_fields` column), keyed by channel and then by field key: `{ "email": { "subject": { "type": "doc", … }, "preheader": { "type": "doc", … } } }`, `{ "push": { "title": …, "body": … }, "sms": { "text": … } }`. A field with no value is absent, and so is a channel with none, so a version without any holds `{}`. A field keeps its value while its channel is off; only its own channel's render reads it.

### Field shapes

Every channel field is a separate document, `{ "type": "doc", "content": [ one paragraph ] }`, whose paragraph holds only `text` and `variable` nodes, and `hardBreak` nodes in a `lines` field. Neither those nodes nor the paragraph carry marks: no bold, no links. The paragraph may be empty.

| Shape | Holds | Line breaks | Used by |
| --- | --- | --- | --- |
| `line` | one line of text and variables | none: a typed or pasted line break is saved as one space | the email subject and preheader, a push title and subtitle |
| `paragraph` | one paragraph of text and variables, shown wrapping | none, as `line` | a push body |
| `lines` | text and variables over several lines | each is a `hardBreak`; several pasted paragraphs join with one each, so a blank line stays | an SMS message |

The field check refuses anything else in the channel's own words (section 3).

### Limits

| Limit | Value |
| --- | --- |
| Heading levels | 1–3 |
| Ordered list `start` | 0–9999 |
| List nesting | at most 9 levels (a list may have at most 8 list ancestors, bullet or ordered) |
| Table columns | at most 12 |
| Table cell content | paragraphs and lists only, at every depth (in the cell's lists' items too) |

---

## 3. Normalization and validation at save

Some things can only arrive through paste, import or JSON. They are normalized when the document is saved (every autosave, the import, and paste into the editor), so the editor and every channel see the same document. Normalization is idempotent and never drops content: what can't stay where it is is moved or converted, and what can't be fixed without guessing (an unknown node, a bad span, a list start of 20000, lists ten deep) is left for the document check, which refuses it with a message instead of storing or rendering it.

Every write of a body (an autosave, an import) stores it as: normalize → check → add ids → normalize again (in the Node code, `prepareBody` in `src/server/documents/prepare.ts`; the editor's autosave runs the first two steps before sending, with the same sentences). Adding ids is a ProseMirror round trip: every attribute default is written, unknown attributes are dropped, adjacent text with equal marks merges, and every block without an `id` gets one; the second normalize takes the written defaults (`align: null`, `type: null`) out again. A channel field (the subject, the preheader): normalize for its shape → the check for its shape → store (`prepareField`). An autosave refusal answers `{ "ok": false, "error": "invalid", "message" }` with the check's sentence (anything else thrown while preparing gives the "unsupported" sentence), checked in the order name, body, then the channel fields in the registry's order (subject, preheader). An import whose converted body the check refuses is refused with the `content` code (400) and the reason "This file can't be imported as it is." followed by the check's sentence; nothing is stored or written. The engine's check before every render (pipeline stage 7) still applies to every stored document.

### Normalization (the CMS, at save; the resolver repeats the text rules defensively)

| What arrives | Saved as |
| --- | --- |
| A heading whose `level` is a number above 3 and at most 6 (3.5 and 5.5 included) | level 3; any other bad level (0, 7, `"2"`, `null`) is left for the check |
| A table cell with `align` or `colwidth` | those attributes removed |
| An `orderedList` with TipTap's `type` attribute | `type` removed (numbering is `markerFormat` / `markerDelimiter`) |
| Paste into the editor only: an `orderedList` whose `start` is a number outside 0–9999 or not whole | below 0 → 0, above 9999 → 9999, a fraction cut to its whole part, NaN (the clipboard's `start="x"`) → 1; so the editor shows the number every channel prints. At save and import an out-of-range `start` is left for the check, which refuses it |
| A tab (U+0009) in text | one space (U+0020) (also on paste and import) |
| A line break character inside a text node (CR LF once, CR, LF, U+2028, U+2029), after tabs and control characters | a `hardBreak` node; the pieces keep the node's marks |
| A text node that is empty, or left empty | removed |
| Other control characters in text (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F–U+009F) | removed |
| An invisible character in text (section 4: soft hyphen, zero-width and bidirectional marks, variation selectors, …) | removed (also on paste and import) |
| A paragraph or heading whose text was all removed | no `content` (its hard breaks, if any, stay: every hard break is kept) |
| A link mark whose `href` passes the link check | `href` replaced by its normalized form |
| A link mark whose `href` fails the link check | the mark removed, the text kept |
| A heading in a table cell (directly, or in a list item anywhere inside the cell) | a paragraph with the same content, keeping only `id` |
| A callout in a table cell (as above) | its children, converted by these same rules |
| A rule in a table cell (as above) | an empty paragraph keeping the rule's `id` |
| A table in a table cell (as above) | first normalized as a table (padded, split), then each of its cells' content, row by row and cell by cell, converted by these rules; its `id` is dropped |
| A table cell, or a list item inside one, left with nothing | one empty paragraph |
| A ragged table (its spans otherwise valid) | per row, one cell per uncovered slot, appended at the row end, holding one empty paragraph; a header cell if the row's first cell is one, else a data cell (what the editor's table plugin does on load) |
| A table wider than 12 columns (and at most 1,000) that lines up once padded | consecutive tables for columns 1–12, 13–24, …; every row appears in each, so header rows repeat (below) |

How a wide table is split: each piece's rows hold the cells that start in that row and overlap the piece's columns. A cell crossing a boundary keeps its content in the piece where it starts, its colspan cut to fit; the next piece gets a cell of the same type with all its other attributes and one empty paragraph, spanning the rest. The first piece keeps the table's attributes; later pieces lose `id`. Tables with bad spans, overlapping cells, overlong rowspans, no columns or more than 1,000 columns (a colspan of a billion would pad or split into a billion empty cells) are left unchanged for the check.

A paste that lands inside a table cell (at any depth, a list in a cell included) takes the pasted blocks as a cell's content by the rules above, except a table, which the editor's table plugin pastes cell by cell into the grid. The editor keeps typing inside the same limit: inside a cell, at any depth, the `/` menu offers only text and lists, `---` and `#` to `###` typed at the start of a line stay text, and the heading shortcuts (Mod-Alt-1 to 3) do nothing. Whatever else puts a block a cell can't hold into a cell (a block dragged into a list there, or any other change) is converted by the same rules in the same step (and the same undo step), so the editor never shows a cell the save would change.

A one-line field (subject, preheader) takes the same text rules, except: each line break character becomes one space (CR LF is one); each `hardBreak` becomes a separate `{ "type": "text", "text": " " }`, with no merging; all marks are removed; and when the doc has two or more blocks and all are paragraphs, the non-empty ones join into the first paragraph, which keeps its attributes, with a `{ "type": "text", "text": " " }` between them.

### The document check (refuses; used at save and again before every render)

The check walks the document depth-first, a node before its children, applying these rules at each node in this order; the first broken rule wins:

| Rule | Exact sentence |
| --- | --- |
| `heading.level` is absent, 1, 2 or 3 | "Headings can only be levels 1 to 3." |
| `orderedList.start` is absent, null or an integer from 0 to 9999 | "A numbered list can start at 0 to 9999." |
| `markerFormat` / `markerDelimiter` are absent, null, or one of the allowed values | "This list's numbering style isn't one Stencil knows." |
| A table: width ≥ 1; spans absent, null or an integer ≥ 1; each cell takes the next column a rowspan from above doesn't hold; no slot taken twice; nothing past the last column or row; every row full | "This table's cells don't line up into rows and columns." |
| A table is at most 12 columns wide | "Tables can have at most 12 columns." |
| A list has at most 8 list ancestors (bullet or ordered, counted through anything, cells included) | "Lists can nest at most 9 levels deep." |
| Every child of a cell, and of every list item inside a cell (at any depth), is a paragraph or a list (an unknown node or `text` there too) | "Table cells can hold only paragraphs and lists." |

Only then the document is parsed against the editor schema (section 2). The parse refuses an unknown node or mark, a misplaced node, an empty `doc` or a root that isn't `doc`, an empty text node, a node that isn't an object, duplicate marks and marks on a block, all with "This document has content Stencil doesn't support." A channel field takes the field check for its shape instead of these rules (section 2, "Field shapes"), then the same parse. The field check's sentence is its channel's:

| Channel | Sentence |
| --- | --- |
| Email | "The email subject and preheader can hold only one line of text and variables." |
| Push | "The push title, subtitle and body can hold only text and variables, with no line breaks." |
| SMS | "The SMS message can hold only text, line breaks and variables." |

Link hrefs are normalized at save rather than refused, so the check does not refuse a document for a link (the resolver drops a link that fails the link check, keeping its text).

The engine runs the same check before resolving (pipeline stage 7). A stored document that fails it is not rendered (section 11).

---

## 4. Text: characters, spaces, breaks and blank lines

### Characters

- Text is NFC-normalized at resolve (Unicode Normalization Form C). Java: `java.text.Normalizer.normalize(s, Normalizer.Form.NFC)`.
- The **invisible characters** render as nothing in every channel, because the editor shows nothing for them: they are removed at save (section 3) and again by the resolver, so the editor, the stored document and every channel agree, and the PDF never fails on a character the author can't see. They are the format and default-ignorable characters: U+00AD (soft hyphen), U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180B–U+180F, U+200B–U+200F (zero-width space, non-joiner, joiner, left-to-right and right-to-left marks), U+202A–U+202E (embeddings and overrides), U+2060–U+206F (word joiner, invisible operators, isolates), U+3164, U+FE00–U+FE0F (variation selectors), U+FEFF, U+FFA0, U+FFF0–U+FFFB, U+1BCA0–U+1BCA3, U+1D173–U+1D17A, U+E0000–U+E0FFF (tags, variation selectors supplement). The same set a link may not contain (section 6; `INVISIBLE_CHARACTERS` in `links.ts`). A soft hyphen is removed, not hyphenated: no channel inserts a hyphen.
- The control characters listed in section 3 never reach a channel (normalized at save, removed again by the resolver).
- A tab becomes one space (normalized at save, and again by the resolver).
- Line break characters in a text node become hard breaks (normalized at save, and again by the resolver). In a variable's display text and in the email subject and preheader they become one space (section 8).
- Every other character is kept exactly as typed, including U+00A0 (no-break space) and the other Unicode spaces.

### Spaces

Spaces are content. Leading spaces, trailing spaces and runs of spaces render exactly as typed in every channel:

| Channel | How |
| --- | --- |
| Web | paragraphs and headings (`p`, `h1`–`h3`) use `white-space: pre-wrap`; list items, cells and callouts hold their text in `<p>` |
| Email HTML | the no-break space technique below |
| Plain text (email) | the characters as typed |
| PDF | every U+0020 stays U+0020 in the text layer; nothing becomes a no-break space. Spaces of every kind (U+0020, U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000) that begin a line the author started (paragraph or heading start, or after a hard break) are set as a run of their own and print where they were typed, each at its own width; if those spaces and the first word don't fit on the line, the spaces stay alone on that line and the word starts the next. Runs inside a line keep their width. Lines wrap only at U+0020: at an automatic wrap the run of U+0020 there is absorbed (the first becomes the break, the rest are dropped), as a browser does with `pre-wrap`, never carried to the start of the next line; the other spaces hold their neighbours together, as a no-break space does. Spaces ending a line (before a hard break or the paragraph's end) are kept as far as they fit; the rest are absorbed. So a paragraph of only spaces is one blank line. A space is never a character the PDF can't draw (section 10) |

**Email no-break space technique.** Mail clients collapse whitespace and ignore `white-space`. For each line of a paragraph, heading or the preheader (the line's text across all its runs, split at hard breaks), walk the characters in order and replace a U+0020 with U+00A0 when it is the first character of the line, or the last character of the line, or the character written just before it is a U+0020. Every U+00A0 (the author's and the inserted ones) is written as `&nbsp;`. It applies to every paragraph and heading wherever it sits (top level, list items, cells, callouts) and to the preheader; not to `<title>`, markers or plain text.

| Line (· is a space) | Written |
| --- | --- |
| `a·b` | `a b` |
| `a···b` | `a &nbsp; b` (space, nbsp, space) |
| `··Lead` | `&nbsp; Lead` |
| `End··` | `End &nbsp;` |
| `···` | `&nbsp; &nbsp;` |

### Hard breaks

A hard break ends the current line and starts a new one. A paragraph's lines are its content split at hard breaks: a paragraph or heading with n breaks has n + 1 lines, in every channel and in the editor (live and static), exactly the lines the live editor shows. A break at the very start gives an empty first line (plain text must not trim it away). A break at the very end gives an empty last line: HTML holds it open (browsers and mail clients make no line of a block's final `<br>`, section 10), plain text and the PDF print it. Hard breaks are never removed, at save or by the resolver.

### Blank lines

1. **Blank paragraphs render.** A paragraph the author left empty, or filled only with spaces, no-break spaces or hard breaks, renders as what it is: blank line(s) of the paragraph's height (n hard breaks: n + 1 blank lines), in every channel, wherever it is (top level, list items, table cells, callouts).
2. **Except paragraphs of empty optional variables.** A paragraph whose content is only variables that have no value, plus blank characters and hard breaks, is removed in every channel (rule 8 of the decisions). The same holds for a heading. Removal cascades (section 8): a list item left with nothing is removed and the list renumbers; a list left with no items is removed; a callout left with no paragraphs is removed; a table cell is never removed (it stays, empty).
3. **The editor's trailing line is dropped.** Empty paragraphs at the very end of the document (top level only) are dropped, consistently in every channel.

"Blank characters" for rule 2: U+0020, U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000, the invisible characters above, tabs and line break characters. Control characters are not blank: `{{promo_note}}` beside a U+0007 keeps the paragraph, which resolves empty. "Empty" for rule 3: no inline content at all after resolution (a paragraph of hard breaks isn't empty: the author made those lines).

| Document (top level) | Every channel shows |
| --- | --- |
| `A`, empty paragraph, `B` | A, a blank line, B |
| `A`, paragraph `···`, `B` | A, a blank line (holding three spaces), B |
| `A`, paragraph `[br]`, `B` | A, two blank lines, B (the paragraph's two empty lines) |
| paragraph `[br]x` | an empty line, then x |
| paragraph `x[br]` | x, then an empty line |
| paragraph `x[br][br]` | x, then two empty lines |
| `Rate: {{promo_rate}}` with no value | `Rate: ` (the text stays; only all-variable paragraphs go) |
| `{{promo_note}}` with no value | nothing (the paragraph is removed) |
| `· {{promo_note}} ·[br]` with no value | nothing (only blanks and breaks besides the variable) |
| `A`, paragraph `[br]` (end of document) | A, two blank lines (breaks are content, not "empty") |
| `A`, `B`, empty, empty (end of document) | A, B |
| `A`, paragraph `··` (end of document) | A, a blank line (spaces are content, not "empty") |

---

## 5. Values

`src/editor/model/variables.ts` is the one formatting module, used by the editor's display, the preview, API validation and the render. `variables.test.ts` holds the normative example table (input → canonical → display, and refusals with their messages). The rules:

**Absent.** A value is absent when it is missing, `null`, or a string that is empty after trimming whitespace. Whitespace is JavaScript's set (what `String.prototype.trim` and `\s` use): U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. A Java port uses exactly this set, not `Character.isWhitespace`. A required variable that is absent is missing (`missing_variables`); an optional one renders nothing. Keys not in the version's list are ignored.

**Present.** A present value must be a string, or a JSON number (read from its exact source text, see below), and fit its type; otherwise it is invalid (`invalid_values`). Surrounding whitespace is ignored for every type but `text`.

**Length.** A present value is at most 1,000 characters as sent, whatever its type, counted in Unicode code points before any trimming (an emoji is one; Java: `codePointCount`, never `length()`). A longer value is invalid (`invalid_values`, "{key} must be at most 1,000 characters.") and its type isn't checked. It is never cut: a value prints exactly as sent or is refused. The check comes after the absent check, so a string of only whitespace is absent at any length. The published JSON Schema gives every property `"maxLength": 1000`, which counts the same way. The limit and why it is 1,000 are in [decision 0011](decisions/0011-cap-each-render-value.md).

**Decimals (currency, percent, number) are exact strings.** They are never converted to a binary number (no `Number`, `parseFloat`, `Intl`, `double`, `BigDecimal` arithmetic). Canonical = the digits as sent with the allowed decoration removed. Display = canonical plus the type's symbol and thousands commas. Nothing is rounded, cut, padded or rewritten; trailing zeros stay.

Accepted decimal grammar, after trimming:

```
currency  = [ "-" ] [ "$" ] digits          ("-$5"; "$-5" is refused)
percent   = [ "-" ] digits [ [ " " ] "%" ]  (at most one space before the %)
number    = [ "-" ] digits
digits    = whole [ "." 1*DIGIT ]
whole     = "0" | NONZERO *DIGIT | NONZERO 0*2DIGIT 1*( "," 3DIGIT )
```

ASCII digits only. The space before `%` is U+0020. There is no limit on the digits beyond every value's length limit. Refused: badly grouped commas (`1,00`, `1000,000`), `.5`, `5.`, `+5`, leading zeros (`007`, `00`; `0` and `0.5` are fine), negative zero in any form (`-0`, `-0.00`, `-$0`), exponents (`1e3`), anything else.

Display: currency `-$1,234.5` (the sign goes before the `$`), percent `21.90%`, number `1,234.567`. Commas go every three digits of the whole part, from the right.

**Dates.** Accepted: `YYYY-M-D` or `M/D/YYYY` (US order), where the month and day are one or two digits (a leading zero is fine) and the year is exactly four ASCII digits. Or: a month word of three or more ASCII letters that begins the English month name (`Sept`, `Septem`; any case), optionally followed directly by a point, then whitespace, then a one- or two-digit day, an optional comma directly after the day, whitespace, and the four-digit year (`March 4, 2027`, `mar 4 2027`, `Sept. 30, 2027`). Refused: ordinals (`1st`), `4 March 2027`, `March 4,2027`, `March 4 , 2027`. A real Gregorian day, years 0001–9999. Canonical `YYYY-MM-DD`. Display `March 4, 2027`: the English month name, the day without a leading zero, the four-digit year, from a fixed table (no `Intl`, no time zone).

**us_state.** A USPS code or the full name of one of the 50 states or DC, any case (runs of whitespace inside a name, the set above, count as one space). A code must be the whole trimmed value (`N J` and `N.J.` are refused). Case is compared with Unicode's locale-free mapping (Java: `toUpperCase(Locale.ROOT)` / `toLowerCase(Locale.ROOT)`, never the default locale). Canonical: the code. Display: the full name from the fixed table.

**text.** Canonical: as sent. Display, in this order: each run of whitespace (the set above) that contains at least one CR or LF becomes one space; the ends are trimmed (the set above); then, as in section 4 but on one line, each U+2028 or U+2029 becomes one space, a tab becomes one space, the invisible and control characters are removed, and the result is NFC. The ends are not trimmed again. Runs of spaces inside stay. A value never produces a hard break.

**JSON numbers.** A JSON number in a request's `values` is read from its exact source text (Node: the `JSON.parse` reviver's `context.source`; Java: the parser's raw token text) and then follows the same grammar as a string: `{"apr": 21.90}` is `"21.90"` and displays `21.90%`; `1e3` is refused; `1000000000000000000000` keeps every digit. This applies to the direct members of `values`. A number becomes a string, so a text variable gets its source text (`7` is `"7"`), and a date or us_state variable refuses it. `true`, `false`, objects and arrays are invalid for every type (`first_name must be text.`). When a key repeats, the last one counts. An engine that can't read a number's source text refuses the number; it never guesses digits.

| Type | Input | Canonical | Display |
| --- | --- | --- | --- |
| currency | `95` | `95` | `$95` |
| currency | `1000.5` | `1000.5` | `$1,000.5` |
| currency | `-$1,234.5` | `-1234.5` | `-$1,234.5` |
| currency | `$1,000,000.00` | `1000000.00` | `$1,000,000.00` |
| currency | `1000000000000000000000` | same | `$1,000,000,000,000,000,000,000` |
| percent | `6.875` | `6.875` | `6.875%` |
| percent | `21.90` | `21.90` | `21.90%` |
| percent | `21.99 %` | `21.99` | `21.99%` |
| number | `1.999999` | `1.999999` | `1.999999` |
| number | `1,234,567.891` | `1234567.891` | `1,234,567.891` |
| date | `3/4/2027` | `2027-03-04` | `March 4, 2027` |
| date | `Sept 30, 2027` | `2027-09-30` | `September 30, 2027` |
| us_state | `new  jersey` | `NJ` | `New Jersey` |
| text | `Maya\nChen` | `Maya\nChen` | `Maya Chen` |
| currency | `1,00` / `.5` / `5.` / `+5` / `007` / `-0` / `1e3` / `$-5` | refused | — |
| date | `2027-02-29` / `1/1/27` / `4 March 2027` | refused | — |

A variable whose display text is empty after the text rules (for example a text value made only of invisible or control characters) renders nothing and counts as having no value. It still satisfies a required variable: no `missing_variables`.

---

## 6. Links

`src/editor/model/links.ts` is the one link check (`checkLink`, `normalizeLink`), used by the editor's link field (it refuses with the reason), paste and import, save normalization, the resolver and every adapter. A link the editor shows is a link in every channel; a link that fails the check is a link nowhere (its text stays).

**Allowed:** `https://`, `http://`, `mailto:` and `tel:` links, with no whitespace and no control or invisible characters inside.

**Normalization (what changes, and nothing else):**

1. Whitespace and zero-width characters at either end are trimmed: U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+200B–U+200D, U+2060, U+FEFF.
2. NFC.
3. The scheme is lowercased (`HTTPS://` → `https://`, `MailTo:` → `mailto:`).
4. Every character above U+007F after the host (path, query, fragment), and anywhere in a `mailto:` link, is percent-encoded as its UTF-8 bytes with uppercase hex (`/café` → `/caf%C3%A9`). So the href is the same ASCII string in HTML, plain text and a PDF link annotation (PDF URIs are ASCII).

Everything else is kept exactly as written: the host's case, existing `%XX` escapes, every other ASCII character. Normalizing twice gives the same result. The tool does not guess a missing scheme (`coral.example` is refused, not turned into `https://coral.example`).

**Refusals, checked in this order (the first that applies is the reason):**

| # | Reason | When | Message |
| --- | --- | --- | --- |
| 1 | `empty` | nothing left after trimming | "Enter a link." |
| 2 | `invisible` | a lone surrogate | "Links can't contain invisible or control characters." |
| 3 | `space` | any whitespace from the list in step 1 (except the zero-width ones) inside | "Links can't contain spaces or line breaks." |
| 4 | `invisible` | a control, format or invisible character inside: U+0000–U+001F, U+007F–U+009F, U+00AD, U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180B–U+180F, U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+3164, U+FE00–U+FE0F, U+FEFF, U+FFA0, U+FFF0–U+FFFB, U+1BCA0–U+1BCA3, U+1D173–U+1D17A, U+E0000–U+E0FFF | "Links can't contain invisible or control characters." |
| 5 | `scheme` | after NFC: no scheme (`[A-Za-z][A-Za-z0-9+.-]*:`), or not `https`, `http`, `mailto`, `tel` (any case) | "Links must start with https://, http://, mailto: or tel:." |
| 6 | `backslash` | a `\` anywhere | "Links can't contain a backslash." |
| 7 | `web-address` | http(s): the scheme isn't followed by `//` | "Enter a full web address, like https://www.example.com." |
| 8 | `web-userinfo` | http(s): an `@` in the authority (`https://bank.example@evil.example`) | "Web links can't have a name or password before the site's address." |
| 9 | `web-address` | http(s): an empty host | (as 7) |
| 10 | `web-host` | http(s): a host with characters above U+007F | "Write an international site name in its xn-- form." |
| 11 | `web-address` | http(s): a host that isn't dot-separated labels of `[A-Za-z0-9_-]` (not starting or ending with `-`, an optional final dot) or `[`, one or more of `0-9 A-F a-f : .`, `]` (not otherwise validated); or a port that isn't 1–5 digits up to 65535 | (as 7) |
| 12 | `email` | mailto: the part before the first `?` is not one or more comma-separated `local@domain` addresses (exactly one `@`, both sides non-empty) | "Enter an email address after mailto:, like mailto:help@example.com." |
| 13 | `phone` | tel: not an optional `+`, then digits and `-` `.` `(` `)` with at least one digit, then optionally `;ext=` and one or more digits | "Enter a phone number after tel:, like tel:+18005550100." |

The authority is what follows `//` up to the first `/`, `?` or `#`; the port is what follows its last `:` (unless the authority ends with `]`).

| Input | Result |
| --- | --- |
| `·https://coral.example·` | `https://coral.example` |
| `HTTPS://Coral.Example/Terms` | `https://Coral.Example/Terms` |
| `https://coral.example/café` | `https://coral.example/caf%C3%A9` |
| `mailto:help@coral.example?subject=Card%20terms` | unchanged |
| `tel:+18005550100` | unchanged |
| `javascript:alert(1)`, `data:…`, `ftp://…`, `coral.example`, `/terms` | refused: `scheme` |
| `https://coral.example/card terms` | refused: `space` |
| `https://bank.example@evil.example/` | refused: `web-userinfo` |
| `https://café.example/` | refused: `web-host` |

**In the channels:** web HTML, email HTML and plain text group links the same way. Consecutive text runs with the same href are one link, whatever their other marks (variable runs included). A hard break belongs to the link only when the nearest text runs before and after it both carry that href (`<a>a<br>b</a>`); otherwise it stands outside any link (`<a>a</a><br>b`). HTML writes each group as one `<a href="…">` with the normalized href (HTML-escaped). Plain text writes each group as `text (address)` (section 10), with a break inside it as `\n` and the address after the link's last line. The PDF writes a link annotation with the normalized href for every linked run.

---

## 7. Lists and markers

`src/editor/model/list-markers.ts` defines markers once for the editor, the resolver and every adapter. The rules:

### Numbering styles

An ordered list's style is a **format** and a **delimiter**:

| Format | Writes 1, 2, 3, 4 as | Range | Outside the range |
| --- | --- | --- | --- |
| `decimal` | 1 2 3 4 | every integer ≥ 0 | — |
| `lower-alpha` | a b c d … z aa ab … | ≥ 1 | 0 is written `0` |
| `upper-alpha` | A B C D … Z AA AB … | ≥ 1 | 0 is written `0` |
| `lower-roman` | i ii iii iv | 1–3999 | 0 and ≥ 4000 are written in decimal digits |
| `upper-roman` | I II III IV | 1–3999 | 0 and ≥ 4000 are written in decimal digits |

| Delimiter | Marker for 4 in lower-roman |
| --- | --- |
| `period` | `iv.` |
| `paren-right` | `iv)` |
| `parens` | `(iv)` |

- Decimal: ASCII digits, no grouping, no padding (`10003`).
- Alpha is bijective base 26 (spreadsheet columns): 26 → `z`, 27 → `aa`, 52 → `az`, 53 → `ba`, 702 → `zz`, 703 → `aaa`.
- Roman is subtractive (`iv`, `ix`, `xl`, `xc`, `cd`, `cm`): 1994 → `mcmxciv`, 3999 → `mmmcmxcix`.
- A fallback keeps the delimiter: 4000 in upper-roman with parens is `(4000)`; 0 in lower-alpha with period is `0.`. This matches CSS Counter Styles 3 for the built-in styles. Nothing is clamped.
- The marker has no surrounding spaces; each channel sets its own gap between marker and text.

The "Numbering" menu (the list's block menu) offers exactly ten styles, in this order: `1.` `a.` `A.` `i.` `I.` `(1)` `(a)` `(i)` `1)` `a)`, plus "Start at…". A stored document may hold any of the fifteen format × delimiter pairs; all of them render.

### Defaults by depth

A list's **ordered depth** is the number of `orderedList` nodes among its ancestors, wherever they are (through bullet lists, list items and tables alike). Its **bullet depth** is the number of `bulletList` nodes among its ancestors.

- An ordered list whose `markerFormat` is absent or null takes the format for its ordered depth: 0 → `decimal`, 1 → `lower-alpha`, 2 → `lower-roman`, 3 → `decimal`, and so on (depth mod 3). Its delimiter, when absent or null, is `period`. The two fall back independently. A styled parent does not change a child's default.
- A bullet list's glyph cycles by bullet depth: 0 → disc `•` (U+2022), 1 → circle `◦` (U+25E6), 2 → square `▪` (U+25AA), 3 → disc, and so on.

| Structure | Markers |
| --- | --- |
| ordered › ordered › ordered › ordered | `1.` › `a.` › `i.` › `1.` |
| ordered › bullet › ordered | `1.` › `•` › `a.` (the bullet list doesn't count) |
| bullet › ordered › bullet › bullet | `•` › `1.` › `◦` › `▪` (the ordered list doesn't count) |
| ordered styled `(a)` › unstyled ordered | `(a)` › `a.` (depth 1 default) |

### Numbering

Item *i* (counting from 0) of an ordered list is number `start + i`. `start` is honoured everywhere, including 0. Numbering is assigned after the resolver removes items (section 8), so the list renumbers like deleting a numbered paragraph in Word.

| start, style, items | Markers |
| --- | --- |
| 1, `1.`, 3 | `1.` `2.` `3.` |
| 0, `1.`, 2 | `0.` `1.` |
| 25, `(a)`, 3 | `(y)` `(z)` `(aa)` |
| 3998, `I.`, 3 | `MMMCMXCVIII.` `MMMCMXCIX.` `4000.` |
| 9999, `1)`, 2 | `9999)` `10000)` |

### Every channel prints the RenderDoc's markers

The RenderDoc carries every item's marker text (section 9). Web and email HTML must not rely on browser or mail-client numbering (`list-style-type`, `<ol start>`, `type`): they print the marker as text. Plain text and the PDF print the same strings.

### The editor

The editor must show exactly the marker `formatMarker` gives, for every list, styled or not. The editor's third ordered level shows `i.` (before this change it showed `a.`).

CSS can't be trusted for this: the built-in counter styles match `formatMarker` only for in-range numbers with a period, `(…)` needs `@counter-style`, browsers differ on prefix and suffix when a value falls back, and Safari's `::marker` support is limited. The editor therefore draws markers from `formatMarker` itself: a decoration writes each list item's marker string into a `data-list-marker` attribute drawn with `::before` (the static render and the redline write the same attribute), and `list-style` is `none`. The default by depth is computed with `defaultMarkerFormat` / `bulletStyle`, counting ancestors exactly as above.

---

## 8. Resolution: from TipTap JSON to RenderDoc

The resolver is a pure walk over the JSON (no editor runtime). Inputs: the checked document, the variable list and the canonical values. It handles exactly the node and mark names of section 2. Anything else throws a ResolveError carrying one of the document check's sentences, and the render fails with `reason: "document"` (section 11). The walk is depth-first in document order, and the first problem found is reported. Removal never skips a check.

| Situation | Message |
| --- | --- |
| Body not a `doc`; an unknown node or mark; a known node in a wrong place (outside a cell); a list, list item or callout with no content; a field line that isn't a paragraph or heading | "This document has content Stencil doesn't support." |
| Any schema node other than `paragraph`, `bulletList` or `orderedList` in a cell, or in a list item anywhere inside a cell | "Table cells can hold only paragraphs and lists." |
| `level` present and not 1, 2 or 3 | "Headings can only be levels 1 to 3." |
| `start` not absent or null, and not an integer 0–9999 | "A numbered list can start at 0 to 9999." |
| `markerFormat` / `markerDelimiter` not absent or null, and not an allowed value (exact case) | "This list's numbering style isn't one Stencil knows." |
| A list with 9 or more list ancestors (bullet and ordered counted together, through tables) | "Lists can nest at most 9 levels deep." |
| A table wider than 12 columns | "Tables can have at most 12 columns." |
| A bad `colspan` / `rowspan`, no rows, any other grid failure | "This table's cells don't line up into rows and columns." |

A heading checks `level` before its content. An ordered list checks depth, then `start`, `markerFormat`, `markerDelimiter`, then its items. A table resolves every cell (content, then `colspan`, `rowspan`) before the grid checks.

### Blocks

| JSON | RenderDoc |
| --- | --- |
| `paragraph` | `paragraph` with resolved inline content |
| `heading` | `heading` with `level` (absent → 1), `section` = `requiredKey` when it is a non-empty string, otherwise null |
| `bulletList` | `list`, `ordered: false`, `bullet` from the bullet depth; each item's `marker` is the glyph |
| `orderedList` | `list`, `ordered: true`, `start` (absent → 1), `format` and `delimiter` resolved (section 7); item *i*'s `marker` is `formatMarker(start + i, format, delimiter)` |
| `listItem` | `{ marker, content }` |
| `table` | `table` with `columns` (the table's width) and `rows` |
| `tableRow` | `{ cells }`, the cells that start in this row |
| `tableCell` / `tableHeader` | `{ header: false / true, colspan, rowspan, content }` |
| `callout` | `callout` with its paragraphs |
| `horizontalRule` | `rule` |

`id` is `attrs.id` when it is a non-empty string, otherwise null.

### Inline content

For each paragraph and heading:

1. **Variables.** A `variable` gives nothing when its `key` isn't a string, isn't in the variable list, or has no canonical value. Otherwise: `formatValue(type, value)` (section 5); then each line break character left (CR LF once, CR, LF, U+2028, U+2029) becomes one space, a tab becomes a space, and invisible and control characters are removed. If that leaves `""`, the variable gives nothing and counts as having no value. Otherwise it is one run with the node's marks and `variable: key` (NFC at step 7).
2. **Text.** A `text` node's text carries its marks (`bold`, `italic`, `underline`, and `href` from the `link` mark when the link check passes; a failing link is dropped and the text kept).
3. **Breaks.** A `hardBreak` becomes `{ type: "break" }`. A `text` node is split at its line break characters (CR LF once; CR, LF, U+2028, U+2029), with a break between the pieces.
4. **Characters.** In each piece a tab becomes a space, and invisible and control characters (section 4) are removed.
5. **Empty pieces** are dropped before merging, so the runs around them merge (`a`, U+200B, `b`, all bold → `ab`).
6. **Merge.** A piece joins the run just before it when that is a text run that isn't a variable's and has the same `bold`, `italic`, `underline` and normalized `href`. Otherwise it starts a new run. Nothing merges across a break or with a variable's run.
7. **NFC.** Each run, after merging (`e` + U+0301 with the same marks → `é`; with different marks they stay two runs, uncomposed).

Every break stays, one at the end of the content included.

### Removal (decision rule 8)

Evaluated on the source JSON with the values, before building the output:

- A paragraph or heading is **removed** when it contains at least one `variable` node, every variable in it gives nothing (step 1 above, including a display text that is empty after step 4), and every `text` node in it consists only of blank characters (section 4), tested on the text as stored. Hard breaks may appear. Control characters are not blank: `{{promo_note}}` beside a U+0007 keeps the paragraph, which resolves empty.
- A list item is removed when all its blocks were removed.
- A list is removed when all its items were removed.
- A callout is removed when all its paragraphs were removed.
- A table, row or cell is never removed; a cell may end up with no content.

Ordered list items are numbered after removal (`start + index among the remaining items`).

### The end of the document

After removal, empty paragraphs (no inline content at all) at the end of the top-level block list are dropped, repeatedly. This includes a paragraph whose only content was invisible or control characters. Nothing else at the end is dropped: a trailing paragraph of spaces stays, so does one of hard breaks, and so does an empty heading.

### Channel fields: email subject and preheader, push, SMS

Each channel field resolves to a plain string; a missing field is `""`. Its lines are the `doc`'s children (a bare paragraph is one line), each a paragraph or heading. A `line` or `paragraph` field (the email's, a push's) writes each break as one space; a `lines` field (an SMS) writes each as `\n`:

- A `text` node gives its text, with each line break character (CR LF once) turned into the break, and then step 4 applied.
- A `hardBreak` gives the break.
- A `variable` gives its step 1 text, or nothing. A value is one line wherever it prints: a line break inside it is one space.
- Marks are checked, then ignored.

Lines are joined with the break. The whole string is NFC-normalized (text from different nodes composes), and then whitespace (section 5's set, line breaks included) is trimmed from both ends (a mail header can't carry leading whitespace, and an SMS doesn't start or end on an empty line). Runs of spaces inside, and spaces at the ends of an SMS's inner lines, stay as typed. There is no removal rule for fields.

### Tables: the width

`columns` is the table's width. The resolver checks the grid exactly as the document check does (section 3; in the Node code both call `tableGrid` and `linesUp` in `src/editor/model/table-grid.ts`), placing cells as prosemirror-tables' TableMap does:

1. The width is the largest number of columns any row covers: its cells' colspans plus the columns that rowspans from rows above carry into it.
2. Row by row, each cell takes the next column that a rowspan from above doesn't hold.
3. The grid sentence refuses a table with no rows (width 0), a span that isn't an integer ≥ 1, a cell running past the last column or over a column already taken, a rowspan running past the last row, or a row that leaves a column free. Only then, the 12-column sentence refuses a width above 12.

So in a resolved table every row covers exactly `columns` columns, from 1 to 12. Placement keeps, per row, the ranges of columns already taken rather than one slot per column, so a span of a billion columns costs no more than a span of two (a port must not allocate per column either).

---

## 9. The RenderDoc

The RenderDoc is the channel-neutral result of resolution, and the input of every adapter. Its TypeScript form is `src/domain/render/types.ts`; this is its JSON form, as written to `renderdoc.json` in the golden files (key order is not significant: golden JSON is compared parsed).

```jsonc
{
  "templateId": "UC-4F7K2Q",
  "templateName": "Cash Back Welcome Bonus",   // the version's name; metadata: PDF title, web <title>; never printed in the body
  "versionNumber": 2,                          // null for an unsubmitted draft
  "blocks": [ Block, … ]
}
```

```jsonc
// Blocks
{ "type": "paragraph", "id": "b1" | null, "content": [ Inline, … ] }
{ "type": "heading", "id": …, "level": 1 | 2 | 3, "section": "legal_notices" | null, "content": [ Inline, … ] }
{ "type": "list", "id": …, "ordered": false, "bullet": "disc" | "circle" | "square", "items": [ Item, … ] }
{ "type": "list", "id": …, "ordered": true, "start": 0..9999,
  "format": "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman",
  "delimiter": "period" | "paren-right" | "parens", "items": [ Item, … ] }
{ "type": "table", "id": …, "columns": 1..12, "rows": [ { "cells": [ Cell, … ] }, … ] }
{ "type": "callout", "id": …, "content": [ paragraph, … ] }
{ "type": "rule", "id": … }

// Item
{ "marker": "iv.", "content": [ Block, … ] }

// Cell
{ "header": true | false, "colspan": 1.., "rowspan": 1.., "content": [ paragraph | list, … ] }

// Inline
{ "type": "text", "text": "…", "bold": true?, "italic": true?, "underline": true?, "href": "…"?, "variable": "key"? }
{ "type": "break" }
```

Optional inline keys are absent (never `false` or `null`) when they don't apply. `id` and `section` are always present (a string or null). `bullet` appears only on bullet lists; `start`, `format` and `delimiter` only on ordered lists. `colspan` and `rowspan` are always present (1 when absent or null in the JSON). Items, rows and cells have no `id`.

**Invariants** (every RenderDoc the resolver produces):

- Text runs are non-empty, NFC, and contain no line break characters, tabs, control characters or invisible characters (section 4). Spaces are exactly as typed.
- No two adjacent text runs have identical marks unless one of them is a variable's run.
- An `href` is already normalized (`normalizeLink(href) === href`).
- Paragraphs and headings made only of variables without a value are gone.
- Lists have at least one item; every item has a `marker` and at least one block. Ordered markers are `formatMarker(start + i, format, delimiter)`; bullet markers are the glyph of `bullet`.
- Tables have 1–12 columns, at least one row, and every row covers exactly `columns` columns. Cells hold only paragraphs and lists, and so do the items of every list inside a cell; a cell's content may be empty.
- Callouts hold at least one paragraph.
- The top-level `blocks` never end with an empty paragraph.

Adapters only choose how the RenderDoc looks. They never drop, add, reorder, renumber or rewrite content, and never recompute markers, values or links.

---

## 10. Channels

Shared by every document channel (web, email, PDF): every block of the RenderDoc renders, in order; every list item shows its `marker` before its first line; blank paragraphs render as blank lines; spaces and hard breaks render per section 4; links per section 6; the version's name never appears in the body. The message channels (push, SMS) render no RenderDoc: only their own fields, below.

### Web (`text/html; charset=utf-8`)

- A complete, responsive HTML document: doctype, `<html lang="en">`, UTF-8, viewport, `<title>` = the version's name (escaped), one `<style>` block. No scripts, no external resources.
- Escaping: `&` `<` `>` `"` `'` as `&amp;` `&lt;` `&gt;` `&quot;` `&#39;` in text and attribute values. U+00A0 is written `&nbsp;`. Every other character is written as itself (UTF-8).
- `white-space: pre-wrap` is on `p`, `h1`, `h2` and `h3` only, not on `li`, `td`, `th` or the callout. List items, table cells and callouts always hold their content as blocks, so a paragraph there is always a `<p>`.
- Each text run is written on its own: its escaped text inside `<u>`, then `<em>`, then `<strong>` (all three: `<strong><em><u>…</u></em></strong>`). Adjacent runs never share a tag. A link's `<a>` wraps its runs (section 6).
- A hard break is `<br>`. An empty last line holds one more `<br>`, since a browser makes no line of a block's final `<br>`: an empty paragraph or heading is `<p><br></p>`, `<h2><br></h2>`, and content that ends with a hard break gets one after it (`x[br]` is `<p>x<br><br></p>`, `[br]` is `<p><br><br></p>`). A paragraph of spaces holds its spaces (`<p>   </p>`).
- A bullet list is `<ul>`, an ordered list `<ol>`, with no attributes (never `start` or `type`; the stylesheet sets `list-style: none`). Each item is `<li><span class="marker">MARKER</span><div>BLOCKS</div></li>`: the escaped marker as text (not hidden from assistive technology), then the item's blocks as in the body, joined by `\n`. The opening tag, each `<li>` and the closing tag are on separate lines. The stylesheet makes each list a grid its items share (`subgrid`): markers right-aligned in the first column, blocks in the second.
- A table is wrapped in `<div class="table-wrap">`. Leading rows made only of header cells go in `<thead>`, but the last row never does, so a table of header rows only has no `<thead>`. The other rows go in `<tbody>`. A header cell is `<th scope="col">` in `<thead>` and `<th scope="row">` elsewhere. `colspan="n"` and `rowspan="n"` come after `scope`, and only when n > 1. A cell with no content is empty (`<td></td>`).
- A callout is `<div class="callout" role="note">`, then the decorative glyph `<svg class="callout-glyph" … aria-hidden="true">`, then its paragraphs as `<p>`. A rule is `<hr>`.

### Email

The adapter returns `{ subject, preheader, html, text }`.

**Subject and preheader** are the resolved one-line strings (section 8), returned as they are.

**HTML:** the conservative layout mail clients need: a table-based 600 px card, inline styles on every element, the hidden preheader at the top of the body. `<title>` is the subject, escaped, with its spaces as typed (no no-break technique). A non-empty preheader is the body's first element: `<span class="preheader" style="display:none !important;…">`, its text (no-break technique, escaped), then `&#847;&zwnj;&nbsp;` repeated 60 times. An empty preheader writes no span; its line stays, empty.

- Escaping as on the web; every U+00A0 is written `&nbsp;`.
- Spaces use the no-break space technique (section 4), in the body and in the preheader text.
- A hard break is `<br>`. An empty last line holds `&nbsp;` so clients don't collapse it: an empty paragraph or heading is `&nbsp;`, and content that ends with a hard break gets one after it (`x[br]` is `x<br>&nbsp;`), wherever inline content is written (a bare paragraph in a list item or cell too).
- Lists (bullet and ordered alike) are `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`, one `<tr>` per item. Each row has a marker `<td>` (the marker as text; right-aligned, `white-space:nowrap`, `width:24px`, which grows for a wider marker, then an 8 px gap) and a content `<td>`. No `<ul>`, `<ol>`, `<li>` or `list-style`.
- A list item's or table cell's content: exactly one paragraph puts its inline content straight into the `<td>` (no `<p>`; empty is `&nbsp;`). Otherwise each block is written as in the body, joined by `\n`. A cell with no content is an empty `<td>`.
- Tables are `<table cellpadding="0" cellspacing="0" border="0" width="100%">` (no wrapper, no role), with the web's `<thead>`, `scope` and span rules. A callout is a one-cell `<table role="presentation">` holding its paragraphs as `<p>`, with no (i) glyph. Rules are `<hr>`. Every element except `<br>`, `<tr>`, `<thead>` and `<tbody>` has an inline `style`.

**Plain text:**

- UTF-8, `\n` line endings: the lines joined with `\n`, then one `\n` (no blocks: `\n`). Characters as typed, including U+00A0. Nothing is trimmed.
- Top-level blocks are separated by one empty line (`\n\n` between them).
- Paragraph: its lines (a hard break is `\n`, so a final break leaves an empty last line). An empty paragraph is an empty line. A paragraph of spaces is a line of those spaces.
- Heading: its lines. Level 1 is followed by a line of `=`, level 2 by a line of `-`, each as long as the heading's longest line in code points (at least 3); level 3 has none. A heading whose lines are all blank (only whitespace, section 5's set) has no underline and keeps its lines as typed.
- List: items follow each other with no empty line between. An item's lines are its blocks' lines, with no empty line between blocks. The first line is the `marker`, a space and that line, or the marker alone (no trailing space) when that line is empty. Each further line is indented by the marker's length in code points plus one. An empty line stays empty (no indent). A nested list is one of the item's blocks, so it takes that indent (`10. ten` / `    ◦ in` / `      a. deep`).
- Table: each row is written as lines. A cell's lines are its blocks' lines (joined with `\n`); an empty cell is one empty line. A row has as many lines as its tallest cell. Row line *j*: each cell contributes its line *j*, or an empty string when it has fewer lines; every cell but the last is padded with spaces to its longest line (in code points); the pieces are joined with ` | `, except that an empty last piece is joined with ` |` (no trailing space). A row whose cells are all single lines is therefore `a | b | c`, as before. After a row made only of header cells, unless it is the table's last row, comes a line of `-` as long as that row's longest line (at least 3). Cells are written in reading order; spans don't add or remove separators.
- Callout: a line `+` followed by 39 `-`, then each line of its content prefixed `| ` (an empty line is `|`), then the same frame line. Its paragraphs are separated by an empty line.
- Rule: 40 `-`.
- Links: `text (address)` once per link (grouped as in section 6). The text is the link's runs, breaks as `\n`. The address is the href without a leading `mailto:` or `tel:`. When the text is blank (only whitespace, section 5's set), just the address; the blank text isn't printed. Just the text when, after trimming the text (section 5's set), `normalizeLink(text)` is the href or the text is the address; both comparisons lowercase each side (Java: `toLowerCase(Locale.ROOT)`) and remove at most one trailing `/` from each. The text is printed untrimmed.

### PDF (`application/pdf`)

- US Letter pages, 1 inch side margins, real selectable text, embedded fonts. Pagination rules are unchanged (keep-with-next headings, widows and orphans, table rows that never split, repeated table header rows, list items and callouts that move whole up to a size).
- Document information: /Title = the version's name, /Subject = the footer label (`UC-4F7K2Q · v2`, or `UC-4F7K2Q · Draft`), /Creator (Stencil), /Producer (Stencil), no /Author or /Keywords. /CreationDate = /ModDate = the render time `at` truncated (not rounded) to whole seconds, UTC, written `D:20270304120000Z`. The catalog's /Lang is (en-US). (react-pdf writes /ModificationDate; the Node adapter renames that key in place to /ModDate, padded with spaces so no byte offset moves.)
- A footer on every page: the label on the left, `Page N of M` on the right. The footer is not document content.
- Prints exactly the RenderDoc: every item's `marker` (right-aligned in a hanging marker column), blank lines (an empty or blank paragraph takes one line of its type's line height per line; an empty paragraph exactly one), spaces and breaks per section 4 (the empty last line after a final hard break included).
- Spaces: U+0020 and U+00A0 print with the face's own glyphs. Every other Unicode space (U+1680, U+2000–U+200A, U+202F, U+205F, U+3000), which neither face has, is drawn as the face's no-break space with letter spacing that gives it its own width: en quad and en space ½ em; em quad, em space and ideographic space 1 em; three-per-em ⅓ em; four-per-em ¼ em; six-per-em ⅙ em; figure space the width of the face's `0`; punctuation space the width of `.`; thin space and narrow no-break space ⅕ em; hair space 1/10 em; medium mathematical space 4/18 em; Ogham space mark the width of U+0020. So a space is never a character the PDF can't draw, and leading spaces of every kind keep their indent. In the text layer a U+0020 reads U+0020; a space drawn with Liberation Sans's space glyph (U+00A0 and the drawn substitutes) reads U+0020 too.
- The fonts' glyph caches are filled once per process, before anything is measured or laid out (Node: fontkit caches each glyph with the code points of the first lookup that reached it; every code point a font maps is looked up, lowest first, private-use code points last). So a glyph two characters share always reads as the same one, the lowest (a space as U+0020, `-` as U+002D, `·` as U+00B7), whatever the process rendered before (section 12).
- The marker column is the widest marker of the list plus a 6 pt gap (at least 15 pt), never more than half the box; the gap shrinks to a third of the column. A marker too wide for its column wraps inside it, cut bare. The marker sits beside the item's first block, whatever it is (a list or table when the item's paragraph was removed).
- Line wrapping never inserts a hyphen or any other glyph. Lines break only at U+0020. A word wider than its line starts a new line and is cut bare, like the web: after the last separator that fits (space `-` `/` `.` `_` `?` `&` `=` `#` `:` `,` `;` `+` `~` `|` `\` `@`, U+00A0, `–`, `—`) when that fills at least 40% of the line, otherwise after the last character that fits. Combining marks stay with their base. A variable's value of at most 4 words that fits on one line never wraps inside. (Layout is not compared across engines; these are the Node engine's rules.)
- Table columns are equal: the width of the box the table sits in (the content width, or a list item's text column) divided by the grid width. The grid width is `columns` clamped to 1–12, widened by one per extra cell in a row; colspans are clamped to the right edge, rowspans to the last row (defensive: a resolved table never needs it). Cell side padding is 6.5 pt, at most a quarter of the cell's width.
- A link annotation with the normalized href covers every linked run.
- Before layout, every character that will be drawn is checked: the body in document order (an item's marker before its content), then the footer (the label, then `Page`, `of` and the digits). Each character is checked against the face that sets it (weight and style included: bold runs and header cells bold, italic runs italic, markers upright at their block's weight); it passes if that face, or the fallback family in the same weight and style, has the glyph. In the Node engine the faces are Newsreader 500 for level-2 headings and Liberation Sans (700 for levels 1 and 3, 400 elsewhere), with Liberation Sans as the fallback, and printable ASCII (U+0020–U+007E) is skipped because every face has it (a space, above, never fails). If any character can't be drawn, the render fails (section 11): no tofu boxes, no silent drops.
- Never crashes on legal input: tables of up to 12 columns at any nesting, spans and `start` within the limits, lists 9 deep (rendering well under a second).

### Push (`application/json`)

A push is one message for both platforms, rendered for the one the request names (`platform`). The response is `{ "title", "subtitle"?, "body", "payloadBytes", "newerVersion" }`:

- `title`, `subtitle` and `body` are the resolved fields (section 8), in full. Nothing is cut to a length: the phone cuts what doesn't fit its screen, never the engine.
- `subtitle` is iPhone's only. With `platform: "android"` it is never present; with `"ios"` it is present only when it resolved to text.
- `payloadBytes` is the UTF-8 length of the notification JSON this text makes, written compact (no whitespace, non-ASCII as raw UTF-8, only `"`, `\` and control characters escaped): `{"aps":{"alert":{"title":…,"subtitle":…,"body":…}}}` for iPhone (APNs; the subtitle only when present), `{"message":{"notification":{"title":…,"body":…}}}` for Android (FCM HTTP v1), keys in that order. It is a lower bound on what the consumer sends: its own keys (a deep link, data, badge, sound) add to it.
- Over 4,096 bytes on the requested platform, the render is refused: 422 `push_payload_too_large` (section 11). A value is never shortened to fit.

### SMS (`application/json`)

The response is `{ "text", "encoding", "parts", "characters", "newerVersion" }`:

- `text` is the message exactly as it must be sent: the resolved message field (section 8, its line breaks as `\n`), then, when the content type has an SMS footer, `\n` and the footer as written. An empty message is the footer alone. Nothing is cut and nothing is transliterated: a value prints as sent, even when it switches the message to UCS-2.
- `encoding`, `parts` and `characters` measure `text` (below).
- Over 10 parts, the render is refused: 422 `sms_too_long` (section 11).

Consumers must send `text` as is and turn off provider rewriting such as Twilio's Smart Encoding, which replaces ’ – … with ASCII: the counts are for the text exactly as rendered.

### SMS encoding

The reference is `src/domain/messages/gsm7.ts`; its README explains the sources ([decision 0034](decisions/0034-sms-characters-and-length.md)).

- **GSM-7 or UCS-2.** `text` is GSM-7 when every character is in the GSM 7-bit default alphabet (3GPP TS 23.038 §6.2.1; 127 characters, 1 septet each) or its extension table (§6.2.1.1: form feed, `^ { } \ [ ~ ] |` and `€`, 2 septets each: an escape and a code). Code 0x09 is `Ç` (capital): `ç` is not GSM-7. One character outside both switches the whole message to UCS-2 (UTF-16).
- **Units** are septets in GSM-7 and UTF-16 code units in UCS-2 (a character outside the Basic Multilingual Plane, such as most emoji, is 2).
- **Parts.** The empty text has 0 parts. Up to 160 septets, or 70 units in UCS-2, it is 1 part. Longer, each part holds at most 153 septets or 67 units, and a part ends before a piece that doesn't fit: an extension character stays with its escape, a surrogate pair stays whole, and in UCS-2 a grapheme cluster (a ZWJ emoji sequence, a flag, a letter and its combining marks, an Indic conjunct such as क्ष) stays whole. A CRLF may split between CR and LF. A cluster longer than 67 units splits between code points. So `parts` can be one more than `units ÷ per part` suggests.
- **`characters`** counts grapheme clusters: a ZWJ emoji sequence, a flag, an Indic conjunct and a CRLF are 1 each. It is informational; units fill the parts.
- **Grapheme clusters** are Unicode's extended grapheme clusters (UAX #29, "Grapheme Cluster Boundary Rules", rules GB3 to GB999 with GB9a, GB9b and GB9c) over the Unicode Character Database **17.0.0**: its Grapheme_Cluster_Break, Extended_Pictographic and Indic_Conjunct_Break properties. The version is pinned, never the runtime's (section 12): in the Node code, `src/domain/messages/graphemes.ts` and the table `scripts/unicode-graphemes.ts` generates from those three UCD files, checked against Unicode's own `GraphemeBreakTest-17.0.0.txt` (copied beside it). A Java port uses ICU4J 78, whose character `BreakIterator` is Unicode 17.0, or ports the module and its table; either way it runs that conformance file. Moving to a newer Unicode version is a change to this specification: the rules move between versions (GB9c arrived in 15.1 and changes again in 18.0), so `parts` and `characters` can move with it, in every engine at once.

---

## 11. Errors

Every error is JSON `{ "error": { "code", "message", "details"? } }`. The codes and statuses are in `src/domain/render/types.ts`. Messages are exact sentences; they never echo a submitted value, with one exception below.

| Situation | Code (status) | Message |
| --- | --- | --- |
| Required values missing | `missing_variables` (422) | "Missing required variables: first_name, purchase_apr." (keys joined by ", "), then each invalid sentence, separated by one space |
| A value doesn't fit its type | `invalid_values` (422) | one sentence per key, separated by one space: "{key} must be text." / "… an amount, like 1000 or 1000.50." / "… a percentage, like 21.99." / "… a date, like 2027-03-04." / "… a number, like 20000." / "… a US state, like NJ." |
| A value is longer than 1,000 characters | `invalid_values` (422) | "{key} must be at most 1,000 characters." in the same list, in the version's variable order |
| The body is larger than 1,000,000 bytes | `body_too_large` (413) | "The body must be at most 1,000,000 bytes." Before stage 1, not logged |
| A push without a platform or with one that isn't `ios` or `android`; a platform on another channel; an encoding on push or SMS | `bad_request` (400) | "platform must be ios or android." / "platform is only for channel push." / "encoding is only for channels pdf, web and email." Before stage 1, not logged |
| A push over 4,096 bytes on its platform, with these values | `push_payload_too_large` (422) | "The push is 4,321 bytes on iPhone. It can be at most 4,096 bytes." (the platform as "iPhone" or "Android") `details: { "platform", "payloadBytes", "maxBytes": 4096 }` |
| An SMS over 10 parts, with these values | `sms_too_long` (422) | "The SMS is 11 parts in UCS-2. It can be at most 10 parts." `details: { "parts", "maxParts": 10, "encoding", "characters" }` |
| The stored document fails the document check, or the resolver refuses it | `render_failed` (500) | "The PDF couldn't be rendered. {sentence}" e.g. "The PDF couldn't be rendered. Tables can have at most 12 columns." The sentence is one of section 3's (the limits, or "This document has content Stencil doesn't support." from the schema parse), or, for a channel field, its channel's field sentence (section 3). `details: { "reason": "document" }` |
| The PDF font can't draw some characters | `render_failed` (500) | "The PDF couldn't be rendered. Its font can't show these characters: U+1EA1 (ạ), U+20B9 (₹)." `details: { "reason": "glyphs", "characters": ["U+1EA1", "U+20B9"] }` |
| Anything else that fails in stages 7–9, or outside the engine (the database, the log write) | `render_failed` (500) | "The PDF couldn't be rendered. Try again." (as today), no `details` |

"The PDF" is the channel's subject: "The PDF", "The web page", "The email", "The push", "The SMS".

Both value codes carry `details: { "missing": [ key, … ], "invalid": [ { "key", "expected": type, "maxLength"? }, … ] }`, keys in the version's variable order. `maxLength` (1000) is there only for a value over the length limit. `missing_variables` is returned whenever anything is missing, otherwise `invalid_values`. Each invalid key reads `{key} must be {noun}.`, or `{key} must be at most 1,000 characters.` when it has `maxLength`; the nouns are text "text", currency "an amount, like 1000 or 1000.50", percent "a percentage, like 21.99", date "a date, like 2027-03-04", number "a number, like 20000", us_state "a US state, like NJ". Sentences are joined by one space.

Unrenderable characters are listed once each, in the order of each one's first occurrence that can't be drawn (the footer's last), as `U+` and at least four uppercase hex digits, a space and the character in parentheses, joined by `, `. At most ten are named; past ten, ` and N more` follows the tenth with no comma: "… U+1EA9 (ẩ) and 3 more." `details.characters` lists all of them. This is the one message that may show characters from a value: single characters, never a value.

The editor's link field shows the link refusal messages of section 6; the editor's value fields show the messages pinned in `variables.test.ts`; the document check's refusals at save use the sentences of section 3.

---

## 12. Determinism

- The output is a function of the inputs listed in section 1 and nothing else: no clock (the PDF dates come from `at`), no randomness, no locale, no time zone, no `Intl`, no environment, no hash-order iteration.
- No runtime's Unicode version either. Where a rule needs Unicode character data, the data is pinned and shipped with the engine: grapheme clusters (an SMS's parts and `characters`) follow UAX #29 over Unicode 17.0.0 (section 10, "SMS encoding"), not `Intl.Segmenter` or `java.text.BreakIterator` of whatever version the runtime has. That is what keeps the composer's preview (in any browser), the server and a second engine on the same parts. NFC (`String.prototype.normalize`, `java.text.Normalizer`) is the one place a runtime's Unicode data still reaches the output; Unicode's normalization stability policy keeps its result the same for every character both runtimes know.
- The same inputs give the same bytes, every time, in each engine (web HTML, email JSON and text, and PDF bytes for the same `at` to the second), whatever the process rendered before and in any order: nothing a render leaves behind (font and glyph caches, module state) may change a later one. An in-process test can't see this (every render there shares the same state), so the Node engine checks it in fresh processes: `golden/determinism.test.ts` renders every golden case in every channel, plus probe documents that would leave state behind (a soft hyphen, leading no-break spaces, characters that share a glyph, a character the PDF can't draw), in two new processes in opposite orders, and every output must be identical.
- Across engines: the engine-neutral golden files (section 13) are identical; PDF bytes are not compared (fonts and layout engines differ), but the PDF's content, markers, links, metadata and missing-glyph count are.

---

## 13. Golden files

The golden files pin the output (see **Comparison** below). They live in `src/server/render/golden/`; how to generate, review and add them is in `src/server/render/golden/README.md`.

```
src/server/render/golden/
  cases/
    <case-name>/
      input.json          the frozen input
      expected/           engine-neutral: Java must match these
        renderdoc.json    the RenderDoc
        web.html          the web document
        email.html        the email HTML
        email.json        { "subject", "preheader" }
        email.txt         the plain-text alternative
        content.txt       the canonical content text (below)
        links.json        [ { "text", "url" } ] in document order
        pdf.meta.json     { "title", "subject", "creator", "producer", "language", "creationDate", "modDate" }
                          (dates ISO 8601 UTC, "2027-03-04T12:00:00.000Z"; language is the catalog's /Lang;
                          absent when the PDF fails)
        error.json        only for a case that must fail before any channel: { "code", "message", "details" }
        push.ios.json     a push case: iPhone's push, { "title", "subtitle"?, "body", "payloadBytes" }
        push.android.json   … and Android's, never with a subtitle
        sms.json          an SMS case: { "text", "encoding", "parts", "characters" }
        push.ios.error.json, push.android.error.json, sms.error.json
                          in place of the file above when that render is refused (a message over its limit)
      node/               Node engine only: depends on fonts and the layout engine
        pdf.layout.txt    every text line by page, with its indent and heading level; footer and links
        pdf.json          { "pageCount", "missingGlyphs", "links": [ { "page", "url", "text" } ] }
        pdf.error.json    only when the PDF must fail (for example unrenderable characters)
```

**`input.json`:**

```jsonc
{
  "templateId": "UC-GOLDEN",
  "templateName": "Nested lists",
  "versionNumber": 1,                       // or null for a draft
  "at": "2027-03-04T12:00:00.000Z",         // render time: the PDF's dates
  "variables": [ { "key", "label", "type", "required", "sample" }, … ],
  "values": { "purchase_apr": 21.90, … },   // as a request sends them; JSON numbers are read from their source text
  "body": { "type": "doc", … },             // a message case's is never read
  "channelFields": { "email": { "subject": { "type": "doc", … }, "preheader": { … } } },  // or {} (section 2)
  "channels": [ "pdf", "web", "email" ],    // the channels the case renders: one family
  "smsFooter": "Coral Offers: Reply STOP to opt out, HELP for help."   // optional: the content type's footer
}
```

A case runs the engine (stages 6 to 9) on its input once per channel it lists, in the order pdf, web, email, push, SMS, and a push once per platform, iPhone then Android. The first run refused before its adapter (stage 6, 7 or 8) ends the case: `expected/error.json` holds that error and no other file exists (no `node/`). So a refused body reads "The PDF couldn't be rendered. …", and a refused subject or preheader (checked only for email) reads "The email couldn't be rendered. …". A PDF refused at stage 9 (unrenderable characters) leaves `node/pdf.error.json` (the error object) alone in `node/`, and `expected/` has no `pdf.meta.json`; the other channels' files are written as usual. A push or SMS refused at stage 9 (over its limit) writes its error as `push.<platform>.error.json` or `sms.error.json` in `expected/`, in place of its output. A message case writes no `renderdoc.json`, `content.txt` or `links.json`.

**Comparison:** JSON files are compared as parsed JSON (key order and whitespace don't matter). `.html` and `.txt` files are compared byte for byte (UTF-8, `\n`). Where this document leaves a byte-level detail to the implementation (CSS, attribute order, markup), the golden file is the reference.

**`content.txt`** is derived from `renderdoc.json` alone and is font-independent: one logical block per line in reading order, every line ending in `\n`.

- A heading is one line: `#`, `##` or `###`, a space, its text.
- A blank heading or paragraph is `∅` (U+2205), in any container.
- A list item is its marker, a space and its first paragraph's first line. An item whose first paragraph is blank, or whose first block isn't a paragraph, is its marker alone (that blank paragraph is not a separate `∅`).
- A table gives its cells' blocks row by row, cell by cell (an empty cell adds nothing); a callout gives its paragraphs; rules are omitted.
- Whitespace runs (JavaScript `\s`, U+00A0 included) become one space and the ends are trimmed. A hard break is a space, but two or more with only whitespace between them end the line (the paragraph is two lines).

`links.json` lists the links in document order: consecutive runs with the same href (hard breaks between them included, as a space) are one entry, whose text has whitespace runs collapsed to one space and the ends trimmed. The golden lane's `content.ts` is the reference implementation of both and documents any further detail at its top.

**The parity test** (`parity.test.ts`, plain assertions, never updated by `-u`) checks, per case:

- `error-*` cases are refused before any channel; `pdf-error-*` cases render everything but the PDF; `push-error-*` cases refuse the push on every platform, and `sms-error-*` cases the SMS; every other case renders each channel it lists.
- A push's title and body are the same on both platforms, Android's has no subtitle, and each `payloadBytes` is its platform's JSON measured again. An SMS's `encoding`, `parts` and `characters` are its `text` measured again, and the text ends with the footer on its own line when the case has one.
- The RenderDoc invariants of section 9 hold.
- The web and email HTML match `content.txt` line for line (markers and blank lines included).
- The email text is the plain text section 10 dictates, line for line. Every line is exact (characters, typed spaces, markers, each hard break's line, every empty line, the ` | ` between cells, link addresses), except the layout the format adds, compared loosely: the indent of an item's further lines, the padding after a cell's line and an underline's length.
- The PDF matches a reduced view of `content.txt` (`content.ts` explains why): `∅` only for a top-level blank paragraph between two paragraphs; an item's later paragraphs join the line above them (the item's, a paragraph's or a nested list's; not a heading's or a table cell's); a table is one line per cell that holds text, in reading order, the cell's lines joined. The Node extractor finds each cell from the rules it draws (`extract-pdf.ts`), so a cell's text, its row and column and its order are compared, but not a blank paragraph inside a cell. Typed spaces and single hard breaks are not compared in the PDF (a line ends at a break and at an automatic wrap alike, and leading spaces are an offset, not text); `pdf.test.ts` checks them directly.
- The links match in the web HTML, the email HTML and the PDF (the email text shows each address in its line).
- Every paragraph and heading with text, at any depth (top level, list items, cells, callouts), keeps its typed spaces and every hard break in the web HTML and the email HTML, in document order.
- No list markup lets a browser or mail client number a list.
- The PDF has zero missing glyphs, and its dates equal `at` to the second.
- A second run gives identical files and identical PDF bytes; and two fresh processes rendering every case in opposite orders give identical outputs (`determinism.test.ts`, section 12).

**Updating:** `npm run golden:update` rewrites `expected/` and `node/` (deleting stale files) and the hand-built cases' `input.json` from `focused-cases.ts`. `npm run golden:import -- <templateId|seedKey> <version|draft> <sampleSet> [case-name]` freezes a seeded version as a new `input.json`, which is never rewritten. Otherwise the test run (`npm test`) fails on a missing, extra or differing file, or a hand-built `input.json` out of step with `focused-cases.ts`. There are 58 cases: 50 hand-built (13 of them `error-*`, one `pdf-error-*`, one `push-error-*`, one `sms-error-*`, and 14 for push and SMS in all) and 8 `seed-*`. The import script is `scripts/golden-import.ts`.

**How Java consumes them:** the Java build reads the same `cases/` directory. For each case it renders `input.json` with its own engine and checks: `renderdoc.json`, `email.json`, `links.json`, `error.json`, `pdf.meta.json`, `push.*.json` and `sms*.json` (when present) as JSON; `web.html`, `email.html`, `email.txt` and `content.txt` byte for byte; its own PDF's extracted content against the PDF view (`content.ts` `VIEWS.pdf`, compared as `compareContent` does, each table cell read on its own) and its link annotations against `links.json`; zero missing glyphs. It ignores `node/`.

---

## 14. What stays the same, what changes

**Unchanged:** the route, its headers, request and response shapes, error codes and statuses (one sentence changes, and the body size and value length limits below add a code, `body_too_large`, and the optional `maxLength` in `invalid_values` details; the import gains one refusal code, `content`); the pipeline order; block ids; the `variable` key on resolved runs; link grouping; the template name staying out of the body; the email layout (600 px card, hidden preheader); the PDF's page size, fonts, footer and pagination rules; the callout's look in every channel; the web document's structure.

**Changed by this specification:**

| Area | Before | Now |
| --- | --- | --- |
| Numbering styles | none (depth only) | ten styles per ordered list, plus start; stored as `markerFormat` / `markerDelimiter` |
| Default third ordered level | `a.` in the editor, `i.` in the PDF, browser default on the web | `i.` everywhere |
| Bullets | by total list depth (PDF), CSS nesting (web) | by bullet depth only, • ◦ ▪ cycling, everywhere |
| Markers in web/email | the client's numbering | text from the RenderDoc |
| Markers in plain text | `1.` / `-` only | the RenderDoc's markers, including • ◦ ▪ |
| Blank paragraphs | dropped by web, email and text | rendered as blank lines everywhere |
| Paragraphs of empty optional variables | left as blank paragraphs (then dropped) | removed; list items removed and renumbered |
| Leading and repeated spaces | collapsed by email HTML and PDF, trimmed by text | as typed everywhere |
| Breaks at paragraph start | trimmed by text | kept everywhere |
| Trailing break | an extra line in some channels | kept: the empty line after it shows in every channel and in the static editor render, as in the live editor |
| PDF word cutting | inserted a hyphen | bare |
| Unicode | as stored | NFC; invisible characters (soft hyphen, zero-width and bidirectional marks, variation selectors, …) removed at save and by the resolver |
| Unicode spaces in the PDF | refused (no glyph), or a no-break space hung into the margin, depending on what the process rendered before | drawn at their own width; leading ones keep their indent |
| Values | rounded by `Intl`, `Number` | exact digits (section 5) |
| Currency `invalid_values` sentence | "… an amount, like 1000.00." | "… an amount, like 1000 or 1000.50." |
| Value forms | loose (`.5`, `5.`, `007`, `1,00`, `-0`, `$-5`, several spaces before `%` accepted) | the section 5 grammar; those are refused |
| JSON numbers in `values` | binary (21.90 read as 21.9) | exact source text |
| Value length | unlimited | at most 1,000 characters each; longer is `invalid_values`, and the schema says `maxLength: 1000` |
| Body size | 400 `bad_request` "The body is too large.", from `Content-Length` and the text read (a chunked body was buffered whole first) | 413 `body_too_large`, counted as the body is read |
| Dates | years 0100–9999 | 0001–9999 |
| Published values schema | any `-?digits(.digits)` | the canonical grammar; dates from 0001 |
| Links | three different checks | one check, with normalization |
| Subject and preheader | whitespace runs collapsed | runs kept, ends trimmed |
| Tables and cells | any width, any blocks in cells | ≤ 12 columns, paragraphs and lists in cells at every depth, rectangular |
| Heading levels 4–6, cell `align` / `colwidth` | stored as pasted | normalized at save |
| Unrenderable characters in the PDF | tofu or silently dropped | `render_failed` naming them |
| A stored document outside the content model | rendered approximately, or a crash | refused at save (autosave, and import with the new `content` refusal), and `render_failed` with `reason: "document"` and the check's sentence at render |
| A pasted list `start` outside 0–9999 | shown as pasted, refused at save | brought into 0–9999 on paste |
| PDF dates | the wall clock | the render time `at` |
| Channels | PDF, Web and Email | also Push and SMS, for message templates (an Alert): a push for `platform` `ios` or `android`, an SMS with its footer, measured and refused past their limits (section 10) |
