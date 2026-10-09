# `src/editor`: the UCOMP document editor

A self-contained React module for authoring regulated content: a calm document page, blocks you can
drag, and typed variables that are impossible to break. Built on open-source TipTap v3 (MIT) with
shadcn/ui (Base UI) for every visible control. It knows nothing about Next.js, the database,
personas or the template lifecycle: the host passes data in and receives events out.

**Status: Phase 2 complete, ready to lift; Phase 4 adds review-comment mechanics.** The public API
below is frozen for Phase 2: later phases may add props and exports, but won't change or remove
these. Phase 4 additions are marked as such.

Contents: [Public API](#public-api-frozen-for-phase-2) · [Composition](#composition) ·
[Document contract](#document-contract-tiptap-json) · [Behavior](#behavior) ·
[Keyboard](#keyboard) · [Paste](#paste) · [Alignment](#alignment) ·
[Performance](#performance) · [Lifting it into another app](#lifting-it-into-another-app) ·
[Changes since Phase 1](#changes-since-phase-1) · [Changes since Phase 2](#changes-since-phase-2) ·
[Changes since Phase 3](#changes-since-phase-3) · [Changes since Phase 4](#changes-since-phase-4) ·
[Changes since Phase 7a](#changes-since-phase-7a) ·
[How it's built](#how-its-built)

## Public API (frozen for Phase 2)

There's no barrel (no `index.ts`): hosts import each export from the module that defines it, so a
route compiles only the parts of the editor it uses. The entry modules:

| Module | Exports |
| --- | --- |
| `@/editor/components/editor-root` | `EditorRoot`, `useContractState`, `useEditorHistory` |
| `@/editor/components/document-editor` | `DocumentEditor` |
| `@/editor/components/variables-panel` | `VariablesPanel` |
| `@/editor/components/inline-variable-field` | `InlineVariableField` |
| `@/editor/components/static-document` | `StaticDocument` |
| `@/editor/components/variable-chip` | `VariableChipView`, `VariableChipViewProps` |
| `@/editor/types` | The component contract: the props types, `DocumentEditorHandle`, `FocusTarget`, `DocumentAlign`, `ContractState`, `ThreadAnchor`, `CommentRequest`, `EditorHistory`. |
| `@/editor/model/types` | `Variable`, `VariableType`, `VARIABLE_TYPES`, `VariableValue(s)`, `SampleSet`, `RequiredSection`, `ContractChange(Kind)`, `JSONContent`, `VariableNodeJSON`, `NODE`. |
| `@/editor/model/contract` | `diffVariables`, `flaggedKeys`, `isBreaking`, `DiffOptions` |
| `@/editor/model/variables` | `formatValue`, `validateValue`, `toKey`, `labelFromKey`, `isValidKey`, `TYPE_META`, `US_STATES` and their types |
| `@/editor/model/sample-sets` | `DEFAULT_SAMPLE_SETS`, `defaultSampleSets`, `sampleSetValues`, `DefaultSampleSetId` |
| `@/editor/model/section-title` | `sectionTitleKey`, `matchesSectionTitle` |
| `@/editor/schema` | `baseExtensions`, `BaseExtensionOptions`, `ensureBlockIds` |
| `@/editor/paste/normalize-html`, `paste/chips`, `paste/markdown` | `normalizePastedHtml`; `chipsInJSON`, `variableKeys`; `looksLikeMarkdown`, `markdownToHtml` |
| `@/editor/model/normalize`, `model/document-check`, `model/table-grid`, `model/characters` | `normalizeDocument`, `normalizeField`, `normalizeFragment`, `HEADING_LEVELS`, `CELL_BLOCKS`, `MAX_SPLIT_COLUMNS`; `documentProblem`, `fieldProblem`, `normalizeAndCheckBody`, `normalizeAndCheckField`, `DOCUMENT_MESSAGES`; `tableGrid`, `linesUp`, `spanValue`, `MAX_TABLE_COLUMNS` (the one export); `LINE_BREAKS`, `CONTROL_CHARACTERS`, `cleanCharacters` (the text rules save normalization and the resolver share) |

Server and domain code use only the server-safe ones: `schema`, `model/*` and `paste/*`.
`model/*` and `paste/*` load no React at all; `schema` reaches only the chip's node view (through
`extensions/variable-view.ts`). Domain rules use the pure model only (`@/editor/model/*`). ESLint
(`eslint.config.mjs`) holds `src/domain` to the model and bans `@/editor` itself in `src/server`.

### Components

| Export | What it is |
| --- | --- |
| `EditorRoot` | Holds one variable list for everything inside it (document, panel, inline fields). |
| `DocumentEditor` | The document. Inside a root, or standalone (it then makes a private root). |
| `VariablesPanel` | The template's variables: insert, drag, edit, delete, contract flags. Inside a root. |
| `InlineVariableField` | A one-line field with chips (email subject, preheader). Inside a root. |
| `StaticDocument` | Server-safe render of a document (no JS), identical markup to the live editor. |
| `VariableChipView` | The presentational chip, to show a variable outside the editor the same way. |
| `useContractState()` | Inside a root: `{ variables, changes }`, the live contract diff against `baseline`. |
| `useEditorHistory()` | Inside a root: `{ canUndo, canRedo, undo, redo }` for a host's own undo and redo buttons. They act on the last-focused field (the document until another field has had focus), where ⌘Z would, without scrolling to the change; read-only, both are false. |

### Props

```ts
interface EditorRootProps {
  variables: Variable[];                          // read once; the root owns the list from then on
  onVariablesChange?: (variables: Variable[]) => void;  // after every list change; never on mount
  baseline?: Variable[] | null;                   // the list consumers render now: contract flags
  requiredSections?: RequiredSection[];           // the content type's sections (for reference; see Behavior)
  readOnly?: boolean;                             // view only
  requiredNote?: string;                          // default "Required for disclosures"
  children: ReactNode;
}

interface DocumentEditorProps {
  content: JSONContent;                           // read once; remount with a new `key` to switch
  onChange?: (doc: JSONContent) => void;          // every edit (debounce in the host); not for
                                                  // mount-time normalization (ids, trailing line)
  autoFocus?: "start" | "end" | "first-section" | false;
  align?: "center" | "start";                     // default "center"; see Alignment
  ref?: Ref<DocumentEditorHandle>;                // { focus(target?), focusThread(id), ... }: see the handle below
  className?: string;
  // Standalone only (inside a root these come from the root and are ignored):
  variables?: Variable[]; requiredSections?: RequiredSection[]; readOnly?: boolean;
  onVariablesChange?: (variables: Variable[]) => void; requiredNote?: string;
  // Review comments (Phase 4; see Behavior → Comments):
  threads?: readonly ThreadAnchor[];              // open ones are highlighted; resolved ones aren't
  activeThreadId?: string | null;                 // the stronger highlight
  onThreadClick?: (threadId: string) => void;     // a click on a highlight
  onCaretThreadChange?: (threadId: string | null) => void;  // the thread under the caret changed
  onRequestComment?: (anchor: CommentRequest) => void;      // turns commenting on (read-only too)
  renderThread?: (thread: ThreadAnchor) => ReactNode;       // accepted, not drawn (the host places cards)
}

interface ThreadAnchor { id: string; blockId: string; quote?: string | null; status: "open" | "resolved" }
interface CommentRequest { blockId: string; quote?: string }   // quote absent: about the whole block

interface VariablesPanelProps { className?: string }

interface InlineVariableFieldProps {
  label: string;                                  // accessible name; how "where it's used" names it
  value: JSONContent | null;                      // one paragraph; read once
  onChange?: (value: JSONContent) => void;
  hidden?: boolean;                               // not shown, still in the root (see Composition)
  id?: string; className?: string;
}

interface StaticDocumentProps {
  content: JSONContent; variables: readonly Variable[]; align?: "center" | "start"; className?: string;
  threads?: readonly ThreadAnchor[]; activeThreadId?: string | null;   // Phase 4: the same highlights
}
```

`DocumentEditorHandle.focus(target?)` works before the editor has mounted (it's applied on mount);
without a target it returns the caret to where it was.

Phase 4 adds to the handle (each works read-only, before mount and while hidden in `<Activity>`).
All are required members of the type, so a test double or adapter of the handle implements every one
(no-ops are fine); call them as `ref.current?.focusThread(id)`.

```ts
interface DocumentEditorHandle {
  focus(target?: FocusTarget): void;
  focusThread(threadId: string): void;            // reveal in its scroll container + mark active
  getBlockRect(blockId: string): DOMRect | null;  // viewport coordinates; null when not rendered
  getThreadRect(threadId: string): DOMRect | null;  // the highlight (first text run), else its block
  subscribeBlockRects(listener: () => void): () => void;  // block positions may have changed
  requestComment(blockId: string): void;          // block-level: onRequestComment({ blockId })
}
```

### Types and utilities

| Export | Use |
| --- | --- |
| `Variable`, `VariableType`, `VARIABLE_TYPES`, `RequiredSection`, `SampleSet`, `VariableValue(s)`, `JSONContent`, `VariableNodeJSON`, `NODE` | The model. |
| `ContractChange`, `ContractChangeKind`, `ContractState`, `diffVariables`, `flaggedKeys`, `isBreaking`, `DiffOptions` | The consumer contract (Submit and review dialogs). |
| `formatValue`, `validateValue`, `ValidationResult`, `toKey`, `labelFromKey`, `isValidKey`, `TYPE_META`, `VariableTypeMeta`, `VariableIconKey`, `US_STATES` | Typed values and keys (render, sample sets, server validation). `labelFromKey` keeps whole-word acronyms in capitals ("purchase_apr" → "Purchase APR"). |
| `DEFAULT_SAMPLE_SETS`, `DefaultSampleSetId`, `defaultSampleSets(variables, today)`, `sampleSetValues(set, variables, today)` | Sample sets (Phase 3): the three default sets for a variable list, and the values to render a set with (its own values, gaps filled from its kind's defaults). `today` is `YYYY-MM-DD`; deterministic for a given day. |
| `baseExtensions(opts)`, `BaseExtensionOptions` | The schema for server work: `@tiptap/html`, `@tiptap/static-renderer`, import, render. |
| `ensureBlockIds(doc)` | Adds stable block ids server-side. Call it in seeds, import and server writes. |
| `normalizePastedHtml(html, { parse? })`, `NormalizeHtmlOptions` | Word / Google Docs / web HTML → clean schema HTML. Pure DOM; pass `parse` (e.g. happy-dom's DOMParser) on the server. |
| `chipsInJSON(doc)`, `variableKeys(doc)` | Import: `{{key}}` text → chips in TipTap JSON, and the keys a document uses. |
| `normalizeDocument(doc)`, `normalizeField(doc)`, `normalizeFragment(nodes, edges)` | Save normalization (docs/render-spec.md §3), pure JSON: tabs, control, invisible and line-break characters, heading levels 4–6, cell `align`/`colwidth`, TipTap's list `type`, links (`links.ts`), content in cells, ragged and wide tables. Paste (as a slice), import and autosave run it. Idempotent; never drops content. |
| `documentProblem(doc)`, `fieldProblem(doc)`, `DOCUMENT_MESSAGES` | The document check's limits beyond the schema (heading levels, list start and style, depth ≤ 9, cell content, table shape, ≤ 12 columns), with the author-facing sentences. `src/server/render/schema-check.ts` adds the schema parse. |
| `normalizeAndCheckBody(doc)`, `normalizeAndCheckField(doc)` | What every save does first: normalize, then the check (`{ doc, problem }`). The autosave's pre-check and `src/server/documents/prepare.ts` (autosave and import) both call them. |
| `sectionTitleKey(text)`, `matchesSectionTitle(text, title)` | Phase 7a: how a heading's text is compared with a required section's title (case, spacing, leading numbering and a trailing colon ignored). Import and the section-merging paste use it. |
| `looksLikeMarkdown(text)`, `markdownToHtml(markdown)` | Phase 7a: whether plain text reads as Markdown, and Markdown → schema HTML (pure strings; `{{key}}` left as written, text escaped). The document's paste uses them; so can import. |
| Component types | `EditorRootProps`, `DocumentEditorProps`, `DocumentEditorHandle`, `FocusTarget`, `DocumentAlign`, `VariablesPanelProps`, `InlineVariableFieldProps`, `StaticDocumentProps`, `VariableChipViewProps`, `ThreadAnchor`, `CommentRequest`. |

## Composition

```tsx
import { DocumentEditor } from "@/editor/components/document-editor";
import { EditorRoot } from "@/editor/components/editor-root";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import { VariablesPanel } from "@/editor/components/variables-panel";

<EditorRoot key={versionId} variables={version.variables} baseline={active?.variables ?? null}
            requiredSections={contentType.sections} readOnly={!canEdit}
            onVariablesChange={saveVariables}>
  <InlineVariableField label="Email subject" value={version.emailSubject} onChange={saveSubject} />
  <DocumentEditor content={version.body} onChange={saveBody} ref={editorRef} align="start" />
  <VariablesPanel />
</EditorRoot>
```

- **One root, one list.** Chips, panel rows and inline fields always agree. A key renamed in the
  panel re-points every chip in every field; a deleted variable can take its chips with it.
- **Remount to switch.** `variables`, `content` and `value` are initial values. Give the root a
  `key` per version.
- **Server render.** Everything renders on the server. Put the document before the panel in the tree
  (same Suspense boundary) and the panel's usage counts are in the server HTML; otherwise they fill
  in after hydration on the same line (rows keep their height).
- **Hidden routes.** Survives React `<Activity>` hiding: an editor destroyed while hidden comes back
  with its latest content and re-registers with its root.
- **Hide a field, don't unmount it.** A field that leaves the tree leaves the root: its chips stop
  counting, and a key renamed meanwhile never reaches them (they come back as unknown chips). To put
  an inline field away for a while (the email subject while Email is off), pass `hidden`: it isn't
  shown, but its chips still count in the panel and follow renames and deletes (reported through
  `onChange`). Click-to-insert, undo and redo pass it by, as if it had gone, until it shows again.

## Document contract (TipTap JSON)

- `doc` → blocks. Every `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `table`,
  `callout`, `horizontalRule` has `attrs.id` (UniqueID). Existing ids are kept.
- `heading { level: 1|2|3, requiredKey?: string|null }`; HTML `data-required="<key>"`. A
  `requiredKey` appears at most once per document; pasted copies never carry one.
- `callout` → `paragraph+`; HTML `<div data-callout>`.
- `bulletList` / `orderedList` → `listItem` → `paragraph` then blocks. `orderedList { start,
  markerFormat, markerDelimiter }`: the numbering style the author chose (null = the default for the
  list's depth); HTML `start`, `data-marker-format`, `data-marker-delimiter`.
- `table` → `tableRow` → `tableHeader | tableCell` → `(paragraph | bulletList | orderedList)+`; at
  most 12 columns (the table menu disables "Insert column" at 12, with the reason).
- Inline `variable { key }`; HTML `<span data-variable="key">Label</span>`; plain text `{{key}}`.
  The node never stores label or type: those come from the variable list.
- Marks: `bold`, `italic`, `underline`, `link { href }`.
- One-line fields: `{ type: "doc", content: [{ type: "paragraph", content: [text | variable…] }] }`.

## Behavior

### Variables

- **Chips** read label and type from the list. Click (or Enter/Space on a selected chip) opens a
  popover: label, key, type, sample value and where it's used (sections and fields, with counts).
  Backspace/Delete remove a chip whole. A key that isn't in the list shows the key, in the warning
  style.
- **Three ways to insert**, each one undo step: drag a panel row into the text; type `{{` for the
  picker (filter by label or key, spaces allowed; **Create** pinned at the bottom unless the query
  already names a variable; Create turns the picker into the compact form, and Enter creates the
  variable and inserts its chip); click or Enter on a panel row (inserts at the last caret of the
  last-focused field, or at the start of the first required section if nothing had focus yet).
  Typing `{{key}}` in full also makes a chip. A chip gets a space only where it would touch a word;
  the caret lands right after it.
- **Panel rows**: type, label, key, uses, Required switch; unused rows are muted. The pencil
  (revealed on hover and focus) opens the same form as Create, with Delete. Deleting a variable in
  use asks: Cancel, Keep chips (they become unknown chips), Remove chips (undo brings back both the
  chips and the variable). With a `baseline`, rows carry contract flags (breaking ones in the
  warning style), and removed variables are listed once under the rows.
- **The form**: label, key (follows the label as snake_case until edited; unique), type, required
  (on by default), sample (optional; validated for its type). Messages only once a save is blocked.

### Required sections

Headings with a `requiredKey` (the content type's sections, e.g. Offer details, Rates and fees,
Legal notices) can't be deleted, renamed, retyped, reformatted or moved:

- Refused, with a small note at the heading for about 2 s ("Required for disclosures", the
  `requiredNote` prop; announced politely to screen readers; one at a time): typing or pasting
  into one; Backspace/Delete that would join a line into one; bold, italic, underline or a link on
  one; turning one into text, another level or a list; deleting one as a selected block; dragging
  one away; Alt+Shift+↑/↓ on one.
- **Range edits keep the headings**: select-all + Delete or typing, cut, and paste over a selection
  that spans required headings apply to everything else. Select-all + Delete leaves the bare
  sections. Cut still copies everything.
- Content under a heading is free, and blocks move freely between sections (including above the
  first one). Enter at the start of a required heading adds a line above it; Backspace at its start
  removes an empty line above it.
- Protection follows the document's `requiredKey` attributes; `requiredSections` is accepted for
  the host's reference.

### Blocks

- **Block handle**: hovering a block shows + and ⋮⋮. + adds a line below and opens the `/` menu
  there (Esc right away takes the line back out). ⋮⋮ drags; clicked (no drag), it opens the block
  menu. Required headings show the + only.
- **Block menu** (⋮⋮ click, a second click closes it; or Alt+F10 from the caret: a focused button in
  the gutter, Enter opens it), named "Block options". For a numbered list: **Numbering** lists
  Default (the style by depth, previewed) and the ten styles, each previewed ("1. 2. 3.",
  "(a) (b) (c)"…), the list's own checked; **Start at…** swaps its row for a small number field
  (0–9999; Enter applies, anything else is explained and not applied; Esc goes back to the item,
  and focus moving to another row cancels it). Each choice is one undo step and an ordinary edit
  (autosaved). The list is the one the caret is in when the caret is inside the block (so a nested
  level is reached by clicking into it; the menu names the level), else the block itself, else the
  first numbered list inside it. Any other block: both items disabled, with the reason. Nothing
  scrolls; focus goes back to the text.
- **Lists**: every item's marker is the text `model/list-markers.ts` writes ("1.", "(b)", "iv)",
  "•"), the same string every channel prints: default 1. → a. → i. by numbered-list depth, bullets
  • ◦ ▪ by bulleted-list depth, the author's style and start, out-of-range numbers in digits. Drawn
  as text (`data-list-marker`), never by CSS counters, in the live editor and the static paint alike,
  in a column as wide as the list's widest marker (never into the handle's gutter).
- **`/` menu**: Text, Heading 1–3, Bulleted and Numbered list, Table, Callout, Divider, with keycap
  shortcuts. **Menus** (`/`, `{{`) open from typing only (undo bringing back a `/query` or
  `{{query` doesn't reopen them), open below the caret (scrolling to make room first; flipping
  above only when they can't) and render inside the editor's wrapper.
- **Callout**: Enter on an empty last line leaves it; Backspace at its start lifts the first line
  out (an empty callout unwraps).
- **Tables**: with the caret in a table, a small control on its top border opens Insert row
  above/below, Insert column left/right, Delete row/column, Delete table.
- **Format toolbar** on selected text: Bold, Italic, Underline, Link. Not on required headings.
- **Placeholder**: only "Type / for blocks", only on an empty focused line.
- **`focus("first-section")`**: the end of the first required section's last top-level paragraph
  (its last text block when it has no paragraph); an empty section gets an empty line under its
  heading, outside undo history.
- **Read-only**: no menus, handles, toolbar or table control; chip popovers still open; the panel
  shows counts and Required states without controls. Text can be selected (and copied); with
  `onRequestComment`, a selection gets a toolbar with Comment alone.

### Comments (Phase 4)

Mechanics only: the editor highlights, reports and asks; the host stores threads and draws them
(a list, popovers or margin cards) with the handle's rect methods.

- **Highlights.** Each open thread highlights the first match of its `quote` in its block (the block
  with `attrs.id === blockId`, top-level first). Matching ignores whitespace differences; chips read
  as their label. No quote, or a quote that's no longer in the block: the whole block is washed
  instead. Resolved threads, unknown blocks and the whole-document thread (`blockId: "doc"`) draw
  nothing. Markup: `<mark class="ucomp-thread" data-thread="id">` per text run (chips stay
  outside), `class="ucomp-thread-block" data-thread-block="id"` on a block; the active thread's
  carries `data-active`. Warning tokens (`--warning-soft` wash with a `--warning-border` underline;
  active: `--warning-border` with a `--warning` underline), apart from the teal of selection and
  dragged blocks. Backgrounds and inset shadows only: blocks and chips don't move (text after a
  highlight on its line can move ≤0.1 px: kerning across the highlight's edge).
- **Edits.** Highlights are mapped decorations: they follow typing, moves, paste and undo, and are
  never part of the document or undo history. Typing inside a quote grows its highlight; deleting the
  quoted text falls back to the block; an edit to that block tries the quote again (so undo restores
  the text highlight); a deleted block's thread comes back with the block. New `threads` with the
  same anchors keep their mapped highlights (a re-render with an equal list costs nothing).
- **Server paint.** `<StaticDocument threads activeThreadId>` (and the editor's own first paint)
  draws the same markup, so the swap to the live editor shows no change.
- **Active.** `activeThreadId` is the stronger highlight. `focusThread(id)` also makes a thread
  active, until `activeThreadId` changes.
- **Clicks and the caret.** A click on a highlight (quoted text, or a block washed as a whole) calls
  `onThreadClick(id)`; a drag that selects text doesn't count, nor does a click on a chip.
  `onCaretThreadChange(id | null)` fires whenever the thread under the caret changes (quote edges
  count as inside; an overlap reports the active thread, else the shorter highlight); mouse and
  keyboard alike.
- **Asking for a comment** (only with `onRequestComment`):
  - Selected text inside one top-level block gets **Comment** in the toolbar, after Link and a
    divider: the icon with the label "Comment" beside it (the one toolbar button that says its name;
    tooltip "Comment ⌘⌥M" for the shortcut). On a required heading (no formatting) or read-only, the
    toolbar holds Comment alone. A drag that runs on to the very start of the next block still counts.
  - **Across blocks there's no Comment** (the formatting buttons still show; ⌘⌥M does nothing):
    a thread anchors to one block, and quoting part of a selection would be a surprise.
  - The request is `{ blockId, quote }`: the top-level block's id and the selected text, trimmed,
    whitespace runs as one space, chips as their label; highlighted again it's the block's first
    occurrence of that text (a phrase that appears twice in a block marks the first). The toolbar
    hides; the host opens its composer. To keep the text marked while the composer is open, add a
    provisional open thread with that anchor and make it active.
  - Block-level: `requestComment(blockId)` on the handle, or ⌘⌥M with a caret (the caret's
    top-level block): `{ blockId }`.
- **Placing threads.** `getBlockRect` / `getThreadRect` return viewport boxes (subtract the box of an
  element that scrolls with the document). `subscribeBlockRects` calls back at most once a frame
  when the document's size changes (typing that wraps, width, fonts, showing again after being
  hidden) or blocks are added, removed or reordered; typing within a line doesn't. `focusThread`
  scrolls only the document's own scroll container (centered when out of view; smooth unless
  reduced motion), or the page when the document has none.

## Keyboard

| Where | Keys |
| --- | --- |
| Document | `/` block menu · `{{` variable picker · ↑ ↓ Enter Tab Esc in either menu · ⌘B ⌘I ⌘U · ⌘K link (on selected text) · ⌘⌥M comment (selected text, or the caret's block; read-only too) · Alt+Shift+↑/↓ move block · Alt+F10: block options for the caret's block (Enter opens the menu, Esc back to the text) · Home/End line start/end · ⌘Z / ⇧⌘Z |
| Highlights | arrows into a highlight report it (`onCaretThreadChange`) |
| Chip | arrow onto it (selects it) · Enter or Space: popover · Esc: close · Backspace/Delete: remove |
| Table | Tab / Shift+Tab next / previous cell (Tab in the last cell adds a row) · Alt+F10: table options (Enter opens the menu, Esc back to the cell); in a numbered list inside a cell, block options instead |
| Required heading | Enter at its start adds a line above · edits show the note |
| Panel | Tab through each row: insert (Enter), edit, Required switch (Space) · ↑ ↓ between rows · New variable · in a form: Enter saves, Esc cancels |

⌘ is Ctrl outside Apple platforms (⌥ is Alt). Every control has a visible focus ring
(`--focus-ring`). The editor, its menus, popovers, forms and dialogs pass axe (all rules) in
`/editor-lab`, including the Comments toggle's highlights and the Comment toolbar and tooltip
(editable and read-only).

A read-only document can't hold a keyboard caret, so keyboard-only reviewers reach comments
through the host (`requestComment(blockId)` from a control of its own).

## Paste

- **From Word** (Windows and Mac) and **Google Docs**: headings H1–H3 (Word's Heading 1–3 and
  Title; h4–h6 become H3), real nested bulleted and numbered lists (Word's `MsoListParagraph` lists:
  bullet or number from the marker, nesting from `levelN`, consecutive lines of one list grouped),
  tables (header rows when marked: `thead`, `th` or Word's repeated heading rows; no widths,
  borders or styles), bold, italic and underline (tags or inline styles) and links. Everything
  else goes: fonts, sizes, colors, line heights, classes, `<o:p>`, conditional comments, images,
  empty `&nbsp;` lines. HTML copied out of the editor itself is kept as is.
- **`{{key}}`** in pasted or dropped text becomes a chip. Keys the list doesn't have are created as
  **optional** Text variables labelled from the key (`promo_code` → "Promo code"), so a paste
  never silently adds a breaking change; a deleted variable pasted back returns as it was. Invalid
  `{{…}}` stays text. The paste is one undo step; created variables stay.
- **Markdown** (Phase 7a): in the document, plain text with no HTML on the clipboard that looks like
  Markdown (a `#` heading, a list, a pipe table, a rule, a code fence, `**bold**` or a
  `[link](https://…)`) pastes as structure: `#`–`###` headings (deeper ones become H3), `-`/`*`/`+`
  and `1.` lists nested by indent, pipe tables with a header row, `---` rules, blank-line
  paragraphs, bold, italic and http/https/mailto links. Code, quotes, strikethrough and images keep
  their text only. `{{key}}` still becomes a chip. Other text pastes line by line as before, and so
  does a paste as plain text (⇧⌘V).
- **Required sections** (Phase 7a): a pasted top-level heading that matches one of the document's
  required headings (`matchesSectionTitle`) merges into it instead of adding a second one. Blocks
  before the first match paste at the caret (below the heading when the caret is in a required
  heading); each match's blocks go to the end of its section (a section runs to the next H2), after
  its last line with something in it, replacing it when it holds only empty lines; headings that
  match nothing stay headings, and so does a copied required heading (it pastes as a plain heading,
  as above). Over a selection spanning required headings (select-all) the range
  rule runs first, so an answer pasted over the whole draft replaces it section by section. One
  undo step, and still a paste: chips and created variables as above. Works for HTML pastes too.
- Links only form on their own from URLs with a protocol (`https://…`).
- **One-line fields** join pasted lines with spaces (no Markdown, no section merging).

## Alignment

`align="center"` (default) centers the text column with a symmetric gutter that holds the block
handle. `align="start"` puts the text's left edge on the column's left edge (lined up with a page
title above it) and hangs the gutter into the left margin, so give the column that much room on its
left. Sizes are CSS custom properties, settable on any ancestor:

| Property | Default | What |
| --- | --- | --- |
| `--doc-width` | token (`47.5rem`) | the text column |
| `--ucomp-doc-gutter` | `3.5rem` | the handle gutter (each side when centered, left only with `start`) |

Give the document's container generous bottom padding (the workspace uses `max(3.5rem, 40svh)`) so
menus near the end of a document can open below the caret.

## Performance

- `useEditor({ immediatelyRender: false, shouldRerenderOnTransaction: false })`: typing never
  re-renders React. The toolbar reads state through `useEditorState` selectors; chips and panel
  rows subscribe to their own key in the root's zustand stores; menus mount only while open.
- Usage is counted at most once per frame; each top-level block is summarized once and cached by
  node identity, so a recount after a keystroke walks only the edited block.
- **Typing latency** (`node e2e/perf/typing-latency.mjs [baseURL]`: Event Timing API, ~190
  keystrokes on the lab's long fixture, next to chips, in a table cell and in a list item): input
  delay plus handler work per keystroke ≈ 1.5 ms median, under 4 ms max. Budget 16 ms.
  With three threads highlighted (the lab's Comments toggle): 1.3 ms median (Phase 4).
- **No visible swap**: the server and the hydration pass render `<StaticDocument>`; the live editor
  mounts after hydration with identical markup. Measured: 0 px movement of every block and chip,
  CLS 0 (lab and workspace).

## Lifting it into another app

1. **Copy** `src/editor/` as is (tests and fixtures included).
2. **Install** (all MIT; versions as used here):

   | Package | Version |
   | --- | --- |
   | `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extensions`, `@tiptap/extension-unique-id`, `@tiptap/extension-drag-handle`, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-node-range`, `@tiptap/extension-mention`, `@tiptap/suggestion`, `@tiptap/static-renderer` | ^3.31.4 |
   | peers of the drag handle: `@tiptap/extension-collaboration`, `@tiptap/y-tiptap` | 3.31.4, 3.0.9 |
   | `@floating-ui/dom` (imported directly; here it arrives through TipTap) | ^1.8.0 |
   | `@base-ui/react` | ^1.8.0 |
   | `react`, `react-dom` | 19.2 |
   | `motion` | ^14.0.0 |
   | `zustand` | ^5.0.15 |
   | `lucide-react` | ^1.51.0 |
   | for the shadcn components: `cmdk` ^1.1.1, `class-variance-authority` ^0.7.1, `cn` ^0.4.0 | |
   | tests only: `vitest`, `happy-dom` | |

3. **shadcn/ui** (base-nova style, Base UI) at `@/components/ui/*`: `alert-dialog`, `button`,
   `command`, `dropdown-menu`, `input`, `kbd`, `select`, `switch`, `toggle` (and what they import:
   `dialog`, `input-group`). Adjust the `@/` alias if yours differs.
4. **Tokens.** Tailwind v4 with the UCOMP semantic theme. Utilities used: `bg-surface`,
   `bg-surface-tinted`, `bg-surface-sunken`, `bg-hover`, `bg-selected`, `border-hairline`,
   `bg-control-off`, `text-text`, `text-text-muted`, `text-text-subtle`, `text-label`,
   `bg-chip`, `border-chip-border`, `text-chip-text`, `text-chip-icon`, `bg-warning-soft`,
   `border-warning-border`, `text-warning-text`, `text-warning`, `text-danger-text`,
   `bg-danger-soft`, `bg-popover`, `ring-ring`, `bg-scrim` (dialogs), `shadow-pop`,
   `rounded-md…4xl`, `font-mono`, `.caps-label`, `sr-only`. CSS variables read by `styles.css`:
   `--text`, `--text-muted`, `--text-subtle`, `--hairline`, `--surface-tinted`, `--brand`,
   `--brand-1`, `--brand-3`, `--brand-soft`, `--warning`, `--warning-text`, `--warning-soft`,
   `--warning-border`, `--radius-chip`, `--radius-control`, `--radius-card`, `--doc-width`,
   `--ui-font-sans`, `--ui-font-display` (section heads), `--dur-fast`, `--ease-out-soft`; and a
   global `:focus-visible` ring from `--focus-ring`. Theming = changing tokens, never this folder.
   Make sure Tailwind scans the copied folder.
5. **CSS**: `styles.css` is imported by the components; bundlers that handle CSS imports (Next,
   Vite) need nothing else. Otherwise import it once globally.
6. **Wire it**: wrap the document and panel in an `<EditorRoot>` per version (`key`), persist from
   `onChange` and `onVariablesChange` (debounced), set `readOnly` from your permissions, pass
   `baseline` for drafts of live templates. Run `ensureBlockIds` wherever documents are created
   outside the editor. Render `<StaticDocument>` (or the editor itself, which paints it first) on
   the server.
7. **Check**: `npx vitest run src/editor` (includes a portability test that fails if any file
   imports outside the allowed set), `/editor-lab`-style page for a visual pass,
   `node e2e/perf/typing-latency.mjs` for latency.

The folder imports only `react`, `react-dom`, `@tiptap/*`, `@base-ui/react`, `@floating-ui/dom`,
`@/components/ui/*`, `lucide-react`, `motion` and `zustand` (`portability.test.ts`; in this repo
ESLint enforces it too: no `next/*`, no app code).

## Changes since Phase 1

For anyone who wired the Phase 1 editor:

- **New composition**: `<EditorRoot>` owns the variable list; `<VariablesPanel>` and
  `<InlineVariableField>` render inside it. `DocumentEditor`'s `variables`, `requiredSections`,
  `readOnly` and `onVariablesChange` are now for standalone use only (inside a root they're
  ignored). Standalone, `variables` is read once (Phase 1 re-synced it on every change).
- **New props**: `align` on `DocumentEditor` and `StaticDocument`; `ref` (`DocumentEditorHandle`
  with `focus()`); `requiredNote` and `baseline` on the root. `onVariablesChange` now fires.
- **New exports**: `EditorRoot`, `VariablesPanel`, `InlineVariableField`, `useContractState`,
  `diffVariables`, `flaggedKeys`, `isBreaking`, `labelFromKey`, `normalizePastedHtml`,
  `chipsInJSON`, `variableKeys`, and the contract types.
- **Removed exports** (internal now): `editorExtensions`, `EditorExtensionOptions`,
  `BLOCK_ID_TYPES`, `EMPTY_LINE_PLACEHOLDER`.
- **Behavior**: required headings are locked (Phase 1 only kept their key unique); chips are
  interactive (popover, insert, delete); unknown chips use the warning tokens; section heads (H2)
  use the display serif and H3 is medium weight; Home/End move along the visual line; pasted Word
  and Google Docs content is normalized; bare-domain text no longer turns into links on its own.

## Changes since Phase 2

Phase 3 additions (additive only; nothing above changed or went away):

- **New exports**: `DEFAULT_SAMPLE_SETS`, `DefaultSampleSetId`, `defaultSampleSets`,
  `sampleSetValues` (`model/sample-sets.ts`, pure TS).
  - `DEFAULT_SAMPLE_SETS`: `typical` "Typical customer", `long` "Long name and maximum values",
    `minimum` "Minimum values" (the same ids and names the seed uses).
  - `defaultSampleSets(variables, today)`: those three sets with a canonical value for every
    variable. Typical uses each variable's sample when it's valid for its type. Long stresses layout:
    long names ("Alexandria-Marguerite", "Featherstonehaugh-Villiers"), a ~60-character phrase for
    other text, 1,000,000 for amounts and numbers, 99.99%, the next September 30, the longest state
    name. Minimum: short names ("Al", "Li"), zeros, the next May 1, the shortest state name. Text
    defaults follow the key, then the label (first, last or full name, company, email, city, street
    address; anything else uses its label for typical).
  - `sampleSetValues(set, variables, today)`: the set's value for each variable when it has one,
    otherwise the default for the set's kind (custom sets fall back to typical). Keys that aren't in
    the list are dropped; values pass through as given (the render route validates them).

## Changes since Phase 3

Phase 4 additions: review-comment mechanics (additive only; nothing above changed or went away).

- **New `DocumentEditor` props**: `activeThreadId`, `onThreadClick`, `onCaretThreadChange`; `threads`
  and `onRequestComment` (accepted since Phase 1) now work; `threads` takes a readonly array.
  `renderThread` stays accepted and not drawn.
- **New handle methods**: `focusThread`, `getBlockRect`, `getThreadRect`, `subscribeBlockRects`,
  `requestComment`.
- **New `StaticDocument` props**: `threads`, `activeThreadId`.
- **Behavior**: the toolbar's Comment action (icon and label "Comment") and ⌘⌥M; read-only documents
  show a Comment-only toolbar on selected text when `onRequestComment` is given. See Behavior → Comments.
- No new exports or dependencies (`ThreadAnchor` and `CommentRequest` were exported already; the
  tooltip uses `@base-ui/react/tooltip` directly so it renders inside the editor).

## Changes since Phase 4

Phase 7a additions: Markdown paste and section-merging paste for Copilot's answers (additive only;
nothing above changed or went away).

- **New exports**: `sectionTitleKey`, `matchesSectionTitle` (`model/section-title.ts`, pure TS),
  `looksLikeMarkdown`, `markdownToHtml` (`paste/markdown.ts`, pure strings).
- **Behavior** (document editor only; one-line fields unchanged): plain-text Markdown pastes as
  structure, and pasted headings that match required sections merge into them (see Paste).
- **New internals**: `extensions/section-paste.ts` (`SectionPaste`, in the client extension list at
  priority 1001, just ahead of the required-section guard); the field binding's
  `clipboardTextParser` for the document. No new props, handle methods or dependencies.

## Changes since Phase 7a

Undo and redo a host can show as buttons, undo history that survives a hidden route, and inline
fields a host can hide without taking them out of the root (additive only; nothing above changed or
went away).

- **New exports**: `useEditorHistory()` (`components/editor-root.tsx`) and its `EditorHistory` type
  (`types.ts`). The root runtime gains `history` (a store of `{ canUndo, canRedo }`), `undo()`,
  `redo()` and `noteHistory(fieldId)`, which the field binding calls on every update.
- **Behavior**: `undo()` / `redo()` take one step in the last-focused field, as ⌘Z / ⇧⌘Z do, but
  leave the scroll position alone (⌘Z scrolls to the change): a button pressed while reading one
  part of the document doesn't carry the page off to another.
- **Undo history across a hidden route**: Next destroys a hidden route's editors and builds new ones
  when it shows again. `lib/history-carry.ts` captures the documents each undo and redo leads to as
  the old editor goes, and replays them into the new editor's history, so ⌘Z still reaches back past a
  tab switch (document and one-line fields). Each step lands on the same document as before; a step
  is one replace of the range that changed, so the caret after an undo can sit at the start of a
  change rather than exactly where it was.
- **New prop**: `hidden` on `InlineVariableField`, backed by the root runtime's
  `setFieldHidden(fieldId, hidden)`. A hidden field still counts and follows renames and deletes;
  insert, undo and redo pass it by (see Composition).
- No new handle methods or dependencies.

## How it's built

| Need | Piece |
| --- | --- |
| Paragraph, H1–H3, lists, marks, link, divider, undo/redo, drop cursor, gap cursor, trailing line | `@tiptap/starter-kit` (code, code block, strike, blockquote off) |
| Tables | `@tiptap/extension-table` `TableKit` (not resizable; wrapper rendered so static = live) |
| Stable block ids | `@tiptap/extension-unique-id` |
| Variable chip, Backspace, `{{` trigger | `@tiptap/extension-mention`, extended (`extensions/variable.ts`) + React NodeView |
| `/` menu and `{{` picker | `@tiptap/suggestion` + shadcn `Command` (`slash-menu.tsx`, `variable-picker.tsx`); Floating UI `shift` + `size` (`extensions/menu-placement.ts`, `components/menu-layer.ts`) |
| Chip popover | Base UI `Popover` parts, anchored to the chip, never taking focus (`chip-popover.tsx`) |
| Panel, forms, dialogs, table menu | shadcn `Button`, `Input`, `Select`, `Switch`, `AlertDialog`, `DropdownMenu` |
| ⋮⋮ handle | `@tiptap/extension-drag-handle-react` + our `+` (`components/block-handle.tsx`) |
| Block menu (numbering) | Base UI `Menu` with a submenu and radio items (`components/block-menu.tsx`); target list, previews and edits in `lib/list-numbering.ts` |
| List markers | `model/list-markers.ts` text, drawn as a decoration (`data-list-marker`) live and as an attribute in the static paint (`extensions/list-markers.ts`); `::before` in `styles.css`, never CSS counters |
| Dragged-block highlight | `@tiptap/extension-node-range` decoration helper (`extensions/block-range-highlight.ts`) |
| Format toolbar (+ Comment) | `BubbleMenu` from `@tiptap/react/menus` (`components/format-bubble.tsx`, its link field `components/link-field.tsx`); Base UI `Tooltip` |
| Review-thread highlights | ProseMirror decorations, mapped through edits (`extensions/review-threads.ts`); anchors and quotes in `lib/threads.ts`; the static paint's equivalent mark and block attribute |
| Thread placement for hosts | `components/comment-bridge.ts` + `lib/block-rects.ts` (rects, ResizeObserver, reveal in the scroll container) |
| Placeholder | `Placeholder` from `@tiptap/extensions` |
| Markdown paste | Our parser (`paste/markdown.ts`): Markdown → schema HTML → ProseMirror's clipboard parser (no Markdown dependency) |
| Server first paint | `@tiptap/static-renderer` (`components/static-document.tsx`) |
| *Custom* (TipTap has nothing free) | `Callout` node; `RequiredSections` (attribute, dedupe, guard, note); block moves; the root runtime and field binding (usage, drop, focus, popover, rename forwarding, tombstones, paste); single-line fields; Home/End; the paste normalizer; the Markdown parser and the section-merging paste |

### Files

```
types.ts                  component contract
schema.ts                 the one extension list (+ the one-line field list, ensureBlockIds)
styles.css                document typography and editor states (tokens only)
model/                    pure TS: Variable types, values and keys, contract diff, usage, form rules,
                          default sample sets
state/                    zustand stores: variable list (renames, tombstones), root runtime, chip popover
extensions/               TipTap extensions (server-safe, except variable-view.ts)
components/               React: EditorRoot, DocumentEditor, VariablesPanel, InlineVariableField,
                          StaticDocument, chip + popover, `{{` picker, form, handle, toolbar, menus
paste/                    clipboard HTML normalizer, Markdown → HTML, `{{key}}` → chips;
                          __fixtures__/ Word (Windows, Mac) and Google Docs clipboard HTML
lib/                      small helpers (chip transforms, section positions, + insert, hooks,
                          thread anchors and quotes, block rects, platform keys)
testing/                  helpers for the tests (headless editors)
```

Every custom extension and model module is covered by unit tests in the folder (`*.test.ts`, on
headless editors in happy-dom; Word and Google Docs paste against real clipboard fixtures). Run
them with `npx vitest run src/editor`.
