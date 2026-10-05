# Phase 7a brief: import, Copilot prompt, ⌘K (Track C)

Read this instead of the long plans. They're the source if this is silent: `docs/UCOMP-Implementation-Plan.md` §9 "Phase 7", and the build plan's "Starting points", "Experience principles" and "Demo script" scenarios 9 and 10. Track C runs in `$P/ucomp-import` (dev :3003, gate :3103); follow `docs/tracks/README.md` and `docs/agent-brief.md`.

**Gate:** scenarios 9 and 10 end to end (`e2e/scenario-09.spec.ts`, `e2e/scenario-10.spec.ts`), unit tests for every import rule, `e2e/api/imports.spec.ts`, and QA of the import row, the Original tab (docx, pdf, txt), the Copilot dialog and the palette.

**Contracts:** `src/domain/import-types.ts` (lead) holds the limits, refusals, storage scheme, placeholder and section rules, the report, the HTTP shapes, the Original read model, the Copilot input and the palette model. Don't change it; if it's wrong, make the smallest additive change and say so first in your report. Also in place: `src/editor/model/section-title.ts` (`sectionTitleKey`, `matchesSectionTitle`; exported from `@/editor`) and `src/components/library/library-intent.ts` (`requestLibraryIntent`, `takeLibraryIntent`, `subscribeLibraryIntent`).

**Decisions:** `docs/decisions/track-c.md`. Compare with original = the rail widens with an "Original" tab, like Preview. The lead logs the 7a calls listed at the end.

## What exists
- **No schema change.** `uploads` (id, template_id, filename, mime, size, path, created_by, created_at) and `versions.import_upload_id` exist; `resetDemo()` empties `./data/uploads`.
- **Deps:** `mammoth` 1.13.0 (new), `pdfjs-dist` 6.4.299 (already used by the preview's PDF viewer), `happy-dom` 20.14.5, `@tiptap/html` (use `@tiptap/html/server`'s `generateJSON` on the server), `jszip` 3.10.2 (new, dev only: fixture generation).
- **Editor paste path** (`src/editor/extensions/field-binding.ts`): `transformPastedHTML` = `normalizePastedHtml`, `transformPasted` = `chipsFromText` (`{{key}}` → chips; unknown keys created as optional Text). Plain text with `{{purchase_apr}}` already becomes a chip today; scenario 10 needs no editor change. `chipsInJSON`, `variableKeys`, `ensureBlockIds`, `baseExtensions` are public.
- **Create:** `createTemplate` in `src/server/actions/templates.ts` (starter → `createDraft` → one transaction → just-created cookie → redirect). Starters in `src/server/starters/`.
- **Rail:** `session-store.ts` (`PreviewState { open, view: "preview"|"comments"|"variables" }`), `rail-view.ts`, `rail.tsx`, `src/components/preview/{rail-header,preview-surface}.tsx`. The preview widens the rail; Esc closes it.
- **Palette:** `app-shell/command-palette.tsx` (Pages + Templates, navigation only), data from `server/queries/palette.ts` via `top-bar-hole.tsx` (Track B's file: don't edit it).
- **PDF viewer:** `src/components/preview/pdf/pdf-viewer.tsx` `PdfViewer({ data: Uint8Array, fileName })` draws real pages; reuse it for a PDF original.

## Verified (the lead's probe on :3003, then removed)
mammoth → `normalizePastedHtml(html, { parse: happy-dom DOMParser })` → `generateJSON(html, baseExtensions())` → `chipsInJSON` → `ensureBlockIds` works inside a Next 16 route handler: a generated .docx gave heading, paragraph, table and five chips. pdf.js legacy works there too, **only** with the worker in-process: bundling breaks pdf.js's fake-worker import (`Cannot find module …/chunks/pdf.worker.mjs`). Fix, no next.config change:
```ts
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");   // after the line above
const task = getDocument({ data, isEvalSupported: false }); const pdf = await task.promise; … await task.destroy();
```
pdf.js caches a failed worker setup for the module's lifetime: get the order right the first time, or the dev server needs a restart (ask the lead; never restart it yourself).

## Routes
- `POST /api/imports` (multipart `file`, `team`) → `ImportResponse`; `GET /api/imports/{uploadId}/file`; `GET /api/imports/{uploadId}/view` → `ImportOriginalView`. Upload is a route handler because server actions cap bodies at 1 MB.
- `GET /api/palette/{space}` → `PaletteContext`.
- Server action `getCopilotPrompt({ templateId })` → `ActionResult<{ prompt: CopilotPrompt }>` in `src/server/actions/copilot.ts`.
- After an import the client `router.push(href)` to the workspace; one-shot cookies `ucomp_created` (name selected) and `ucomp_imported` (rail opens on Original).

## Slices
Waves of at most 2 agents. Two other Track C agents may still be running (typing latency in `src/editor/`; PDF keep-with-next and redline markers). **No 7a slice touches** `src/editor/extensions/review-threads.ts`, `src/editor/lib/block-rects.ts` (and any block-rect observer), `src/editor/components/format-bubble.tsx`, `src/server/render/channels/pdf*`, `src/components/review/`, `src/components/redline/` until they finish. Start wave 1 once at most one of them is still running (3 agents per track). `src/editor/README.md` is shared: targeted edits only.

### Wave 1
**C7-1 Import server (Opus).** Owns:
- `src/domain/import.ts` + test, pure: `scanPlaceholders`, `applyPlaceholders(body) → { body, placeholders, skipped }`, `fitRequiredSections(body, sections) → { body, fit }`, `takeTitle(body)`, `nameFromFilename(name)`, `textToBody(text)` (blank line = paragraph; with no blank lines anywhere, each line is one), `pdfLinesToBody(pages)` (lines from item y; paragraph break on a gap over 1.5× line height; `•`/`-`/`1.` lines → lists; drop lines repeated at the top/bottom of most pages; join a line ending inside `{{` with no space), `finishImport(FinishImportInput) → FinishedImport`, `describeImport(report) → ImportReportLines`. Every rule in the contract's comments gets a test.
- `src/server/import/*`: `sniff.ts`, `docx.ts` (mammoth `styleMap: ["p[style-name='Title'] => h1:fresh"]`; count images/comments/footnotes via `convertImage` and messages; allowlisted `compare.html`), `pdf.ts`, `txt.ts`, `dom.ts` (happy-dom parse + allowlist; close each Window), `store.ts` (paths under a root you can point at a temp dir in tests; never the client file name), `create.ts` (`importTemplate(viewer, { teamSlug, file }) → ImportResponse`).
- Extract the shared insert of `createTemplate` into `src/server/templates/create.ts` and call it from both (`actions/templates.ts` behavior unchanged).
- `src/app/api/imports/route.ts`, `…/[uploadId]/file/route.ts`, `…/[uploadId]/view/route.ts` + route tests (pattern: `src/app/api/drafts/[versionId]/route.test.ts`).
- `src/server/queries/import.ts` (`getImportOriginalRef(templateId)`, `getImportOriginalView(uploadId)`) and the additive `importOriginal: ImportOriginalRef | null` on `WorkspaceDocumentData` (`queries/workspace.ts`).
- `src/domain/activity.ts`: `template.created` with `source: "import:…"` → "Imported Spring offer.docx" (additive + test).
- `e2e/fixtures/import/`: `make-fixtures.mjs` (jszip for .docx with real heading styles, a table with a header row, `{{first_name}}`, `{{Purchase APR}}`, one image, `{{#if member}}`; @react-pdf/renderer for a 2-page .pdf with a running footer; a .txt) and the generated files. `e2e/api/imports.spec.ts`: the three kinds, `.doc`, empty, oversize (made in-test), a viewer without create rights (403).
- **Acceptance:** unit + route tests green; the API spec green against :3003; then (with the lock) `npx next build` passes and `E2E_GATE_PORT=3103 npx playwright test e2e/api/imports.spec.ts` passes on the production build.

**C7-2 Copilot prompt and paste-back (Opus).** Owns:
- `src/domain/copilot.ts` + test: `documentToMarkdown(body)` (`##` headings, lists, pipe tables, `**bold**`, chips as `{{key}}`), `buildCopilotPrompt(CopilotPromptInput) → CopilotPrompt`. The prompt: what the template is (name, team, Disclosure, channels); the required sections as `## <title>`, exactly and in order; the variables as `{{key}}` with label, type and required; rules (use only these placeholders for customer-specific values, new ones in lowercase snake_case; plain language; Markdown only: `##` headings, paragraphs, `-` lists, pipe tables; no preamble); then the current draft as Markdown when it has text ("Improve this draft"), else "Write it". Deterministic (snapshot test).
- `src/server/actions/copilot.ts`: `getCopilotPrompt` (permission `draft.edit`; reads the draft, content type and team).
- Editor (additive, document editor only; inline fields unchanged): `src/editor/paste/markdown.ts` + test (`looksLikeMarkdown`, `markdownToHtml`: `#`–`###`, `-`/`*`/`+` and `1.` lists nested by indent, bold, italic, `[text](https://…)`, pipe tables with a header row, `---`, blank-line paragraphs; text HTML-escaped; `{{key}}` untouched) wired as `clipboardTextParser` in `field-binding.ts` when the text looks like Markdown; `src/editor/extensions/section-paste.ts` + test, registered in `schema.ts` `editorExtensions`: when a pasted slice has top-level headings that `matchesSectionTitle` a required heading in the document, blocks before the first match paste at the selection; each matched heading is dropped and the blocks after it (to the next match) go to the end of that section (the section runs to the next H2), replacing it if it holds only empty lines; unmatched headings stay ordinary headings. One transaction and one undo step, still a "paste" for field-binding (chips and created variables as today). After select-all + paste the range-edit rule runs first, so Copilot's answer replaces the draft section by section. `index.ts` exports `markdownToHtml`, `looksLikeMarkdown`; README Paste + "Changes since Phase 4".
- `src/components/workspace/copilot/copilot-prompt.tsx`: `CopilotPromptButton({ templateId })`, a quiet ghost row (lucide `Sparkles`, "Copilot prompt"), drafts the viewer can edit only. It opens a dialog "Prompt for Copilot": `await session.flush()`, then the prompt in a read-only scrolling block and one black **Copy prompt** (→ "Copied" for 2 s). C7-3 mounts it.
- **Acceptance:** unit tests (prompt snapshot; Markdown cases; section merge incl. select-all + paste, undo, chips, created variables); existing editor tests green; `node e2e/perf/typing-latency.mjs` no worse than before the slice.

### Wave 2 (after wave 1)
**C7-3 Import UI and the Original tab (Sonnet).** Owns:
- `src/components/library/{import-row.tsx, upload-import.ts}`, `starter-gallery.tsx`, `new-template.tsx`: a full-width dashed row under the starter cards ("Import a file", ".docx, .pdf or .txt" muted), click opens the picker (`IMPORT_ACCEPT`), a dropped file works too; while uploading, the row shows a spinner and the file name and the cards lock (one busy state); a refusal is one `role="alert"` line under it. In the dialog and the empty Library. The dialog takes a library intent on mount and while mounted (`import` focuses the row).
- `src/components/workspace/just-imported.ts` (`takeJustImported`, like `just-created.ts`); `session/{session-store,rail-view}.ts` + tests: `PreviewView`/`RailView` gain `"original"`; `openOriginal()`.
- `src/components/preview/{rail-header,preview-surface}.tsx`: `railHeaderViews({ preview, comments, original })` adds Original after Preview; the widened header shows it; on the Original view the surface shows the original instead of the output.
- `src/components/workspace/content/{rail,content-workspace}.tsx`: a template with `importOriginal` gets the rail header (Original | Variables, plus Comments); picking Original widens the rail; arrival after an import opens it; Esc closes it like Preview. Mount `CopilotPromptButton` at the end of the normal rail when editable.
- `src/components/import/{original-view,docx-source,txt-source,pdf-source}.tsx`: fetch `/view` on first show (skeleton meanwhile); file name, size, who and when; the report's detected and dropped lines (13px, muted, no advice); docx HTML in a document-like block; txt in a `<pre>`; pdf through `PdfViewer`.
- **Acceptance:** Library → typing still two clicks for starters; importing each fixture lands with the name selected and the Original tab open; Esc and the narrow overlay behave like Preview; rail tests extended; `docs/ui-checklist.md` pass.

**C7-4 ⌘K palette (Sonnet).** Owns `app-shell/command-palette.tsx`, `src/components/palette/commands.ts` + test (`paletteGroups({ space, spaces, templates, context, pathname }) → PaletteGroup[]`, groups and order as in the contract), `server/queries/palette.ts` (`PaletteTemplate` gains `status: VersionState`; `getPaletteContext`), `src/app/api/palette/[space]/route.ts`.
- Templates show `<StatusBadge>`; Recent from the viewer's audit events; Actions (New template, Import a file) only when `canCreate`, via `requestLibraryIntent` then a push to the Library; This template (Content, Versions, Usage, Activity) on template routes; Settings from `visibleGroups(space.settings)` (Track B's `src/components/settings/sections.ts`, read only); Teams for the other spaces. No persona switch, no demo tools.
- ⌘K ignores a keydown already handled (`event.defaultPrevented`: the editor's ⌘K link on selected text). Keep the trigger's look and props (`top-bar-hole.tsx` is Track B's).
- **Acceptance:** unit tests for the groups (personas: Maya, Riley, Taylor, Morgan); keyboard only: ⌘K, type, Enter; checklist pass.

### Wave 3
**C7-5 Gate specs (Sonnet).** `e2e/scenario-09.spec.ts`: Maya → Library → New template → Import the fixture .docx → the draft has a `first_name` chip and the table; the Original tab shows the source. `e2e/scenario-10.spec.ts`: Maya on a draft → Copilot prompt → Copy (grant `clipboard-read`/`clipboard-write`) → the clipboard holds the prompt with `{{purchase_apr}}` → paste back text containing `{{purchase_apr}}` (clipboard + Meta+V) → a chip. Additive helpers only in `e2e/helpers/scenario.ts`; `shoot()` stills at the key beats.

**C7-6 QA (Sonnet), then one fix agent (Sonnet).** Report only, against `docs/ui-checklist.md` and the principles at 1440, 1280 and below 53rem: the import row and its errors, the Original tab for each kind, the Copilot dialog, the palette. Batch the fixes into one agent.

## Gotchas
- Cache Components: request data and the DB only inside `<Stream>`; `now()` from `@/server/clock` in server code (`createdAt`). GET route handlers are prerendered unless they read request data: read the viewer (cookies) first, or `await connection()`. Don't add route segment config.
- happy-dom: a `Window` per conversion, closed afterwards. `generateJSON` from `@tiptap/html/server`.
- Paths: `./data/uploads/<uploadId>/…` only; the client's file name is display text.
- Hidden routes stay mounted (`<Activity>`): the palette's ⌘K listener and the intent subscription register once.
- Base UI: `render` prop, never `asChild`; dialogs focus a frame after open.
- Playwright: human-paced clicks, visible locators, wait for `pmViewDesc`; `setInputFiles` on the hidden input; preview and PDF iframes need `test.use({ trace: "off" })`.
- Test on templates you create; restore any seeded row you change.

## Decisions for the lead to log (`docs/decisions/track-c.md`)
1. Upload is a route handler (`POST /api/imports`), not a server action: no `serverActions.bodySizeLimit` change.
2. pdf.js on the server runs with its worker in-process (`globalThis.pdfjsWorker`): no `serverExternalPackages` change.
3. The Import entry is a dashed row under the starter cards (New template dialog and empty Library), not a fifth card or a second Library button: one primary.
4. Picking a file imports at once (no confirm step); arrival selects the name and opens the Original tab, whose top shows the report.
5. `{{First Name}}`-style placeholders become chips via `toKey` (wider than the paste rule); template logic stays text and is reported. Imported variables are Text, required, with default sample sets.
6. A leading Title/H1 becomes the template name; required sections are matched by heading text in order, and missing ones are added empty.
7. The original belongs to the template (`uploads.template_id`): the Original tab shows on every version.
8. Copilot: a quiet "Copilot prompt" row at the end of the rail opens a dialog; the prompt is built on the server from the saved draft; body only (no email subject).
9. Paste-back merges sections matching required headings and parses Markdown plain text.
10. Palette: no persona switch or demo tools; Recent comes from the audit log.
11. Dropping a .docx onto an open document (TipTap FileHandler) is out of scope for 7a.
