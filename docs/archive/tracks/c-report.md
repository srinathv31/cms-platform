> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../../README.md).

# Track C report: Phase 7a (import, Copilot, ⌘K) and carried rough edges

> Note: this track's migration was replaced at integration by `src/server/db/migrations/0002_phase5_7.sql` (one migration for Phases 5–7).

Branch `track/import`, worktree `../ucomp-import`. Decisions: `docs/decisions/track-c.md`. Brief: `docs/phase-7a-brief.md`.

## What was built
- **Import .docx, .pdf and .txt into a draft**:
  - Server pipeline: `src/domain/import.ts`, `src/server/import/*`, `POST /api/imports`, `GET /api/imports/{id}/view|file`. Converters are mammoth for docx and pdfjs-dist legacy (worker in-process) for PDF.
  - `{{placeholders}}` become Text chips. Template logic is kept as text and reported. A leading Title/H1 becomes the name. Missing required sections are added empty.
  - Originals are stored in `./data/uploads/<uploadId>/`. Limits and refusals are checked in the browser first (including magic bytes), then on the server.
  - The import shows in Activity.
- **Import UI**: a dashed "Import a file" row under the starter cards in New template, plus drop support. On arrival the name is selected and, on wide canvases, the rail opens on **Original** with the import report (Detected / Dropped / Kept as text) above the source view (docx HTML, PDF pages, txt).
- **Copilot prompt**: a quiet rail row opens "Prompt for Copilot", built on the server from the saved draft (Markdown, keys and required headings preserved, guardrails against invented terms).
  - Paste-back: plain-text Markdown parses, `{{key}}` becomes chips through the existing paste path, and headings matching required sections merge into them. The paste is one undo step.
  - Editor API additions (additive): `looksLikeMarkdown`, `markdownToHtml`, `sectionTitleKey`, `matchesSectionTitle`; the `SectionPaste` extension. `src/editor/README.md` is updated.
- **⌘K palette**: Recent, Actions (New template, Import a file via the Library intent), This template, Templates (status search), Pages, Settings, Teams. It is fed by `/api/palette/[space]`, refreshes after create/import, defers to the editor's link shortcut, and doesn't open over another modal.
- **Rough edges**:
  - PDF keep-with-next chain fixed (heading + short intro + table head stay together).
  - Redline "Changes only" now gives hidden-block threads a marker on the "N unchanged blocks" line, with reveal and focus.
  - Typing latency re-measured: no regression (1.2 ms median handler), no change.
- **Other fixes**:
  - Labels from keys keep acronyms ("Purchase APR").
  - Placeholders removed from the comment box and link field.
  - Redline `<ins>` contrast.
  - Workspace Esc ignores hidden popups.
  - The New template dialog wraps Tab.
- **Specs**: `scenario-09` (import + Original + ⌘K), `scenario-10` (Copilot prompt + paste-back), `e2e/api/imports.spec.ts`, fixtures in `e2e/fixtures/import/` (+ generator), `e2e/helpers/cleanup.ts`.

## Checks at commit
- `tsc` clean; `eslint src e2e` 0 errors (1 pre-existing warning in `e2e/qa/contact-sheet.mjs`).
- `vitest`: 112 files, 1,990 tests passed.
- `next build`: passes with no Turbopack warnings. The uploads path joins are marked `turbopackIgnore`. It prints the same Node `ExperimentalWarning: localStorage…` as Tracks A and B.
- Gate `E2E_GATE_PORT=3103 npx playwright test`: 118/118 passed on a fresh build of the committed code. Scenarios 09–10 also pass in `demo` and `stills-1280`.
- QA (Sonnet, two passes): 2 must + 13 should found, all fixed; axe clean on the palette, Original/Preview states, the Copilot dialog and the Changes-only redline.

## Schema and migration
None. The existing `uploads` table and `versions.import_upload_id` are used.

## New dependencies
- `mammoth` ^1.13.0
- `jszip` ^3.10.2 (dev; fixture generator)

## Files outside the ownership map
- `src/server/templates/create.ts` (shared create helper extracted from `createTemplate`; behaviour unchanged), `src/server/actions/templates.ts`.
- `src/server/queries/workspace.ts`: additive `importOriginal`.
- `src/domain/activity.ts`: the import line.
- `src/components/workspace/**` (rail views, Original tab, name field, workspace actions), `src/components/preview/preview-pane.tsx` (tabIndex), `src/components/comments/gutter-markers.tsx`, `comments/thread-card.tsx`.
- `src/editor/model/variables.ts` (`labelFromKey` acronyms).

## Known issues
- The axe "region" finding on sidebar nav labels is app-shell (Track B fixed the landmark on its branch; re-check after merge).
- Dropping a .docx onto an open document is out of scope (decision 11).

## For the integrator
1. **`createTemplate` overlap with Track B**: Track B added `conformToSections` (and allowed-channel filtering) to `createTemplate`; Track C moved the insert into `src/server/templates/create.ts`. Merge so the import path also conforms (it already matches sections itself) and the starter path keeps B's conform call.
2. **Palette vs Track B's shell**: `PALETTE_PAGES` mirrors the sidebar nav; re-check `src/components/palette/commands.ts` against B's `SpaceNav` (settings sections, `showAudit`) and A's Usage page.
3. `gutter-markers.tsx` and `thread-card.tsx` may meet B's notification/review edits; keep both.
