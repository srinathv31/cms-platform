# Review: `src/editor` (the TipTap document editor)

Slice: `src/editor/**` (124 files, ~22.5k lines incl. 47 test files and the 690-line README), the message composer's use of it (`src/components/workspace/content/editor-adapter.tsx`, `message-composer.tsx`), and `EDITOR_PUBLIC_MODULES` in `eslint.config.mjs`. Repo at main @ 0cca665, 2026-10-12. Every path below is under `/Users/happy/Documents/CodeProjects/prototypes/cms-platform/`.

Evidence tags: `measured` = I ran it, `verified` = I read the code, `traced` = followed but not run.

## 1. Summary

This is the best-built part of the codebase I have seen described in the brief, and the claim "framework-agnostic, liftable" is substantially true: the folder imports only React, TipTap, Base UI, Floating UI, `@/components/ui/*`, lucide, motion and zustand (`portability.test.ts` scans every import; ESLint enforces the same from both sides), and the README's Public API table matches the lint allowlist exactly, 28 modules to 28 (measured). The pure model (`src/editor/model/*`, ~2.3k lines, 24% comment lines) is genuinely portable TypeScript: no `Intl`, `localeCompare`, `Date.now` or `Math.random` anywhere in non-test editor code (measured), explicit code-point sets for characters, decimal values kept as strings, and the normalization and check tables in `docs/render-spec.md` §3 map line by line onto `normalize.ts` and `document-check.ts`. The ProseMirror plugin code is careful and unusually well explained: the required-section guard is one invariant checked in `filterTransaction` plus a handful of range operations rather than a pile of key handlers, list markers are a decoration set that only re-walks the document when a step is not inline-only, and the panel-drop ordering ahead of UniqueID has a 20-line comment that says exactly why. 966 tests run in 2.9 s, 31 of the 47 files mount a real editor under happy-dom and drive it through ProseMirror's own `handleKeyDown`/`handleTextInput` paths, and the Word/Google Docs paste tests run against real clipboard fixtures.

The honest weaknesses are in documentation and in a few places where human readability gives way to cleverness. The README is deep and mostly accurate, but 123 of its 690 lines are "Changes since Phase 1/2/3/4/7a" sections and its header still reads "Status: Phase 2 complete … Public API (frozen for Phase 2)", which the repo's own docs rule forbids and which will mislead a newcomer on day one. Three modules silently assume a required section heading is an H2 while the schema and spec allow `requiredKey` on any heading level, which is precisely the kind of unstated invariant a Java validator would miss. The document contract the Java side must validate is well specified for the limits, but the schema-parse step (where each node may go) exists only as ProseMirror content expressions inside `schema.ts` and TipTap's kits; there is no JSON Schema. `block-menu.tsx` (524 lines, eight components), `document-editor.tsx` (seven refs and a module-level dynamic-import cache), `review-threads.ts`'s `remap()` and `history-carry.ts` (which reaches into prosemirror-history's private plugin key) are the files a human maintainer will fear. I found no reproducible bug in the main paths; the two correctness findings are edge cases (a NUL character in pasted Markdown throws; a chip inside a required heading can never be re-pointed). Word paste still loses list numbering, as the backlog's Follow-ups already say.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 8 | README table == lint allowlist (28/28, measured); portability test; pure `model/*` the domain and server reuse. Deductions: the "public" surface is wide (28 modules, ~100 names) and the allowlist is per module, not per name; `@/editor/schema` pulls the whole client extension graph into server code; the H2 invariant lives in three places. |
| 2 | Correctness & robustness | 8 | 966/966 tests pass; PM plugin code handles rejection, mapping and fallbacks carefully. Two Low edge cases found (NUL in Markdown paste throws; chip in a required heading can't be renamed), one known Open gap (Word numbering). |
| 6 | Readability for humans | 7 | `model/*` is a pleasure (named vocabulary, tables in headers). `extensions/` and `lib/` are dense ProseMirror that need the PM mental model; `block-menu.tsx`, `document-editor.tsx`, `review-threads.ts#remap`, `history-carry.ts` are the hard files. 53 lines over 160 characters. Comments explain behavior, not history (5 "Phase" mentions in code). |
| 7 | Test quality | 8 | 47 files, 966 tests, 2.93 s (measured); 31 files mount real editors; fixtures for Word (Win/Mac) and Google Docs; fake timers; a portability test. Gaps: `comment-bridge.ts`, `block-rects.ts`, `flag-popover.tsx`, `slash-menu.tsx`, `variable-picker.tsx` have no own tests (DOM geometry and menus). |
| 8 | Documentation | 6 | Deep, findable, mostly true, and the Document contract section plus render-spec §2–3 are exactly what a port needs. But 18% of the README is phase history, the status header is false, four small claims are stale, and the editor's big decisions (markers as text not CSS counters; the guard's invariant; chips never store label/type) have no decision record. |
| 11 | Handoff readiness (document validation) | 7 | The limits, normalization, markers, links, values and the two-pass contract diff are pure TS with pinned tests and a normative spec. Missing for Java: a machine-readable JSON Schema of the TipTap document (the "where may a node go" rules exist only as ProseMirror content expressions), the uuid-v4 block-id rule, and the `requiredKey`-is-an-H2 invariant. |

## 3. Strengths

- **The boundary is real and enforced from both sides.** `eslint.config.mjs:26-67` holds every file outside `src/editor` to `EDITOR_PUBLIC_MODULES` and, from `@/editor/schema`, to three names; `eslint.config.mjs:84-99` bans `next/*`, `@/server`, `@/domain`, `@/app`, `@/simulator` and anything in `@/components` but `ui/` inside the editor; `src/editor/portability.test.ts` scans every import specifier in the folder against an allowlist. I compared the README table (`src/editor/README.md:29-51`) with the allowlist: the same 28 modules (measured). `npx eslint src` passes (measured).
- **The pure model is actually pure.** `grep` for `new Date|Date.now|Math.random|localStorage|localeCompare|Intl\.|toLocale` in non-test editor code finds only `sample-sets.ts:203` (`new Date(ms).toISOString()` on a `Date.UTC` value computed from a `today` string, deterministic) (measured). `model/characters.ts` and `model/links.ts:55-78` spell the character sets out as code-point ranges "so the Java port matches code point for code point". `model/variables.ts:95-110` keeps decimals as strings and says why. `model/list-markers.ts` never clamps and documents the CSS Counter Styles fallback it mirrors.
- **Spec and code are one table.** The header of `model/normalize.ts:1-44` and the rules in `model/document-check.ts:22-35, 56-85` are the same rows as `docs/render-spec.md` §3 ("Normalization", "The document check"), in the same order, with the same sentences (`DOCUMENT_MESSAGES`). `src/server/documents/prepare.ts` and `src/server/render/schema-check.ts` are thin callers.
- **The required-section guard is one invariant, not a hundred special cases.** `extensions/required-sections.ts:90-110` (`requiredViolation`) states what must survive any transaction (every required heading, same order, same level, same content); `filterTransaction` (line 310) rejects anything that breaks it; four range helpers (`piecesAround`, `writablePos`, `replaceAroundRequired`, lines 133-196) make select-all+Delete leave the bare sections. 21 tests cover it from typing to cut.
- **ProseMirror ordering problems are explained where they live.** `extensions/field-binding.ts:46-66` (why `PanelDrop` runs ahead of UniqueID and why a `text/plain` payload was the wrong fix), `extensions/section-paste.ts:198-203` (priority 1001 ahead of the guard's 1000), `extensions/list-markers.ts:135-148` (`inlineOnly`: map decorations instead of recomputing).
- **Decision 0022 is implemented as written and checked at the boundary.** `state/variable-store.ts:42-56, 109-125, 165-170` (fresh UUID on create, key-as-id on first rename, dropped when renamed back, never changed by a patch); `model/contract.ts:28-56` (two-pass pairing); `src/server/drafts/parse-patch.ts:89-90, 104-109` validates the id shape and refuses two variables with one identity.
- **Performance claims match the code.** `components/document-editor.tsx:258-260` (`immediatelyRender: false`, `shouldRerenderOnTransaction: false`); `state/editor-root.ts:150-178` (usage counted at most once per frame); `model/usage.ts:49-77` (per-block summaries cached by node identity in a WeakMap); `model/usage.ts:200-217` (`reconcileUsage` keeps object identity so rows don't re-render).
- **Tests exercise the real thing.** `testing/editor.ts:120-137` sends keys through `view.someProp("handleKeyDown")` and text through `handleTextInput`, "the same paths a browser takes"; `paste/paste.test.ts` drives `view.pasteHTML` with real Word for Windows, Word for Mac and Google Docs clipboard HTML and asserts compact JSON shapes; `components/variables-panel-held.test.tsx` and `block-menu.test.tsx` render with `createRoot` + `act` under happy-dom and assert accessible names and disabled states.
- **The host touches the editor in one file.** `src/components/workspace/content/editor-adapter.tsx` is "the ONE file where the workspace touches the editor's composition API", and `message-composer.tsx` uses only `InlineVariableField`, `useContractState` and the `types` module.

## 4. Findings

### High

**H1. The README is 18% phase history and its status header is false.** Severity High (documentation). Evidence: verified, measured.
- Where: `src/editor/README.md:8-12` ("Status: Phase 2 complete, ready to lift; Phase 4 adds review-comment mechanics. The public API below is frozen for Phase 2"), `:24` ("Public API (frozen for Phase 2)"), `:521-643` ("Changes since Phase 1 / 2 / 3 / 4 / 7a", "Changes for the message composer": 123 of 690 lines, measured with awk).
- What happens: a newcomer reads that the module is at Phase 2 while the code has Phase 4 comments, Phase 7a paste, undo carry, text flags and the composer's fields. The six history sections repeat, in diff form, what the Behavior and Public API sections already say in present tense, so the same fact appears twice and only one copy is maintained. `docs/README.md` ("Keeping them true") says "Describe what the code does now. Don't explain through history ('Phase 5 added…'); a decision record holds the why", and then names this very README as "a good model for depth".
- Why it matters: this is the one document every maintainer of the editor reads first, and it is the layer most likely to be lifted into another app, where the phase numbers mean nothing.
- Fix: delete lines 8-12's status sentence and the "(frozen for Phase 2)" qualifier; delete the six "Changes since" sections after moving the two or three choices worth keeping into decision records (list markers drawn as text, never CSS counters; the required-section guard's single invariant; chips store only a key; the contract types as a union). Remove the five "Phase N" mentions in code comments (`types.ts:98,150,278`, `components/document-editor.tsx:12`, `model/section-title.ts:1`).

### Medium

**M1. "A required section heading is an H2" is assumed in three modules but stated nowhere and enforced nowhere.** Severity Medium (correctness/handoff). Evidence: verified.
- Where: `src/editor/model/usage.ts:143-145` (`isSectionHeading`: `level === 2`), `src/editor/lib/sections.ts:34-37` ("The section runs to the next H2"), `src/editor/extensions/section-paste.ts:84-87` (section ends at `level <= 2`). Versus: `src/editor/extensions/required-sections.ts:219` (`types: ["heading"]`, so `requiredKey` may sit on an H1 or H3), `docs/render-spec.md` §2 (`requiredKey` on `heading`, no level rule), `src/editor/model/document-check.ts` (no rule). Producers happen to always write level 2: `src/domain/import.ts:239`, `src/server/seed/content.ts:132`.
- What happens: today nothing, because every producer writes H2. A document arriving through the autosave route or an import with `requiredKey` on an H3 would be guarded by the editor but invisible to usage counts, `focus("first-section")` and the section-merging paste. The backlog already noticed this in G2 ("`sections.ts` silently assumes required headings are H2") and marked G2 Fixed by archiving the plan, so the assumption itself is untracked.
- Why it matters: a Java validator built from the spec would accept documents the editor treats inconsistently.
- Fix: either write the rule into `docs/render-spec.md` §2 ("`requiredKey` appears only on `level: 2`") and add it to `documentProblem` with a sentence, or make the three modules read "the next required heading or any heading of the same level". One sentence in the README's Document contract either way.

**M2. The document contract's schema-parse step has no machine-readable form.** Severity Medium (handoff). Evidence: verified, traced.
- Where: `src/editor/schema.ts:120-183` (`buildBase`: StarterKit, TableKit with `CELL_CONTENT`, `Callout` "paragraph+", `UniqueID` over `BLOCK_ID_TYPES`), `src/server/render/schema-check.ts:44-56` (`parseWithSchema`: `nodeFromJSON` + `node.check()`), `docs/render-spec.md` §2 "Nodes" table (prose approximation: "Allowed inside", "Content").
- What happens: the limits (`documentProblem`) are pure TS the Java side can port line by line, but the parse that refuses "a misplaced node, an empty text node, duplicate marks, marks on a block" is ProseMirror's content-expression engine over TipTap's node specs, including defaults the spec reads back as "the schema's default, 1" and the `listItem` content `paragraph block*` that StarterKit supplies. The spec's table is close but is prose. `ensureBlockIds` is `generateUniqueIds(doc, baseExtensions())` with UniqueID's default `v4()` from `uuid` (`node_modules/@tiptap/extension-unique-id/dist/index.js:4,32`); the spec says only "every block without an id gets one".
- Why it matters: "they must at least parse and validate TipTap JSON on the server". Without a JSON Schema the Java team re-derives the content model from TipTap source, and two validators drift.
- Fix: generate a JSON Schema (or a compact grammar table) from `editorSchema()` at build time, check it into `docs/reference/`, and add a test that `parseWithSchema` and the JSON Schema agree on the golden documents. State "ids are UUID v4 strings; any non-empty string is accepted" in §2.

**M3. Word and Google Docs paste discard list numbering; Markdown paste keeps it.** Severity Medium (correctness, known). Evidence: verified.
- Where: `src/editor/paste/normalize-html.ts:425-470` (`buildList` reads the marker with `takeMarker` only to choose `ol` vs `ul` at line 430; `start`, letter and roman formats are dropped), versus `src/editor/paste/markdown.ts:267-269` (`listHtml` writes `<ol start="…">`). The backlog lists it under "Follow-ups from the render work" ("Word import keeps the source's numbering… Import and paste restart lists at 1 with the default style").
- What happens: a Word list "(a) (b) (c)" or "3. 4. 5." pastes as "1. 2. 3." in the default style; the same text pasted as Markdown keeps its start. The paste test even names the current behavior ("the list starts at 1", `paste.test.ts:173`).
- Why it matters: regulated content copied from approved Word documents is the main import path; "see 2(b)" references break silently.
- Fix: in `buildList`, map the marker text through a small table (`ORDERED_MARKER` already captures the number or letters) to `start`, `data-marker-format` and `data-marker-delimiter`; `ListNumbering.parseHTML` in `schema.ts:67-90` already reads those attributes. Track it as its own backlog finding.

**M4. Two components mix too many concerns for a human to hold at once.** Severity Medium (readability). Evidence: verified.
- Where: `src/editor/components/block-menu.tsx` (524 lines: `BlockMenuPopup`, `BlockMenuItems`, `NumberingSubmenu`, `StartAt`, `StartAtField`, `GripBlockMenu`, `GripTrigger`, `KeyboardBlockMenu`, plus Base UI focus and portal workarounds explained inline at lines 194-199, 262-266, 329-333, 395-400); `src/editor/components/document-editor.tsx` (413 lines: a module-level dynamic-import cache for the block handle at lines 50-85, `RootedDocumentEditor` with six refs and four layout effects, `LiveEditor` with the Activity lifecycle, `onBeforeCreate`/`onCreate`/`onDestroy` handing state between editor instances, a page-level ⌘⌥M listener).
- What happens: each piece is documented, but a reader must understand Base UI's menu model, ProseMirror's view lifecycle, React Activity and the history carry at the same time.
- Why it matters: these two files are where most UI bugs will be fixed by people who did not write them.
- Fix: split `block-menu.tsx` into `block-menu.tsx` (popup, items, numbering, start-at) and `block-menu-openers.tsx` (grip trigger, keyboard opener); move the block-handle loader out of `document-editor.tsx` into `lib/load-block-handle.ts` and the Activity/history hand-over into a `useEditorLifecycle` hook. Decision 0043 ("split files by concern") already licenses this.

### Low

**L1. `markdownToHtml` throws on text containing U+0000.** Severity Low (correctness). Evidence: measured.
- Where: `src/editor/paste/markdown.ts:293-321` (`inline`: placeholders are `\u0000N\u0000`; `restore` calls `kept[Number(n)]` and recurses).
- What happens: `markdownToHtml("a\u00000\u0000b **x**")` throws `Cannot read properties of undefined (reading 'replace')` (run with `npx tsx` against the module). In the editor this runs inside `clipboardTextParser` (`field-binding.ts:200-208`), so a clipboard text with a NUL and a Markdown marker fails the paste with an uncaught exception instead of pasting as text. Save normalization strips NUL later (`characters.ts:14`), but paste runs first.
- Fix: strip `CONTROL_CHARACTERS` from the text before parsing, or use a placeholder character that `cleanCharacters` can never let through (U+FFFF) and guard `kept[n] === undefined`.

**L2. A chip inside a required heading can never follow a key rename.** Severity Low (correctness edge). Evidence: traced.
- Where: `src/editor/extensions/required-sections.ts:100-105` (`requiredViolation` compares `node.content.eq(old.node.content)`, so an `AttrStep` on a chip inside the heading is a violation) and `:308-313` (`filterTransaction` rejects it); the rename's rewrite is `src/editor/lib/chips.ts:25-31` (`rewriteChipKeys`, `setNodeAttribute`) and the forwarding repair in `field-binding.ts:224-241` is also a doc change.
- What happens: the editor itself never lets a chip into a required heading (typing, paste and `insertVariable` are all refused), so this needs a document written by the autosave route, an import or a seed with a chip in a required heading. Then renaming that variable leaves the heading's chip on the old key as an "unknown" chip forever, with the note flashing on every attempt.
- Fix: in `requiredViolation`, compare content with chip `key` attributes masked (or allow transactions carrying `addToHistory: false` from the rename), or refuse chips in required headings in `documentProblem`.

**L3. The public API is enforced per module, so names leak; two table rows are imprecise.** Severity Low (architecture/docs). Evidence: measured, verified.
- Where: `src/components/workspace/content/email-details.test.tsx` lines 9, 37 imports `useEditorRoot` from `@/editor/components/editor-root`, which the README table (`README.md:31`) does not list (it lists `EditorRoot`, `useContractState`, `useEditorHistory`); the lint allowlist is module-level except for `schema`. `README.md:45` says of `model/table-grid` "`tableGrid`, `linesUp`, `spanValue`, `MAX_TABLE_COLUMNS` (the one export)" (four names, confusing); `README.md:46` says `model/list-markers` exports "… and the rest of the list markers every channel prints" (app code imports `BULLET_GLYPHS`, `MAX_LIST_DEPTH`, `isListStart`, `MarkerFormat`, `MarkerDelimiter`, `BulletStyle`; measured).
- Fix: either add `useEditorRoot` to the table (it is a legitimate test hook) or import the runtime type from `@/editor/types`; rewrite the two rows as explicit name lists; consider `allowImportNames` for the three or four modules whose internals matter.

**L4. Four small stale statements in the docs.** Severity Low (documentation). Evidence: verified.
- `src/editor/README.md:481`: "`@floating-ui/dom` (imported directly; here it arrives through TipTap)". `package.json` lists `@floating-ui/dom ^1.8.0` as a direct dependency.
- `src/editor/README.md:490-492`: the shadcn list omits `textarea`, which `src/components/ui/input-group.tsx:9` imports (and `command.tsx` imports `input-group`). A lift that copies only the listed files fails to compile.
- `src/components/README.md:355`: "**Off-contract.** `workspace/save-status.tsx` imports `@/editor/lib/platform`, which is not in the editor's public API." `lib/platform` has been in the table and the allowlist since G5 (`eslint.config.mjs:34`).
- `src/editor/README.md:403-405`: "The editor… pass axe (all rules) in `/editor-lab`". The e2e suite runs axe through `e2e/helpers/principles.ts` on product screens (`.ucomp-doc` is on its settle list) but no spec visits `/editor-lab` (grep of `e2e/` for `editor-lab`: none). Either point the sentence at the workspace specs or add the lab to one.

**L5. `history-carry.ts` depends on prosemirror-history internals.** Severity Low (robustness). Evidence: verified.
- Where: `src/editor/lib/history-carry.ts:28-30` (finds the plugin by `key.startsWith("history$")`), `:120` (`setMeta(plugin, { historyState })`, which prosemirror-history's `apply` happens to honor).
- What happens: both are undocumented behavior of `prosemirror-history`. `restoreHistory` catches failures and returns false, so an upstream change would silently remove undo across a tab switch; `history-carry.test.ts` (4 tests) would catch it in CI, and the file's header says exactly what it relies on.
- Fix: pin the behavior with a comment naming the prosemirror-history version and a test that asserts the plugin key is found (it does, indirectly); or propose an exported `historyKey` upstream.

**L6. DOM-geometry and menu modules have no tests of their own.** Severity Low (tests). Evidence: measured.
- Where: `src/editor/components/comment-bridge.ts` (129 lines), `src/editor/lib/block-rects.ts` (125), `components/flag-popover.tsx` (124), `components/slash-menu.tsx` (279), `components/variable-picker.tsx` (313), `extensions/variable-picker.ts`, `extensions/slash-command.ts`, `extensions/block-items.ts` have no sibling test file; the pickers are exercised through `state/editor-root.test.ts` and `schema.test.ts`, the bridge and rects through nothing in the folder (and `src/components/comments/*` tests mock the handle).
- Why it matters: `revealInContainer`, `scrollContainer` and `createRectSignal` are exactly the code happy-dom cannot exercise meaningfully, so they are only covered end to end.
- Fix: a small happy-dom test of `createRectSignal` (subscribe/notify/observe) and of `commentBridge.focusThread` before mount; leave scrolling to e2e.

**L7. Line length and density.** Severity Low (readability). Evidence: measured.
- 53 lines over 160 characters in non-test editor code; the worst are Tailwind class strings (`block-menu.tsx:66-69`, `format-bubble.tsx:45-46`) and one-line conditionals such as `document-check.ts:75` and `required-sections.ts:103`. `components/` has 9% comment lines against 24% in `model/`, which is fine, but the component headers carry the architecture (Base UI quirks, Activity) that the code then compresses.
- Fix: a Prettier `printWidth` of 120 for `src/editor` (the rest of the file bodies already read as if it were) and class constants for the long Tailwind strings.

**L8. `StaticDocument` rebuilds the schema on every render.** Severity Low (performance note). Evidence: traced.
- Where: `src/editor/components/static-document.tsx:26-35` (`baseExtensions({ variables })` and `getSchema(extensions)` per call; `withListMarkers` builds a `Transform`).
- What happens: fine for one document per request; a page that server-renders many documents (the redline, Compare) pays schema construction each time. `src/server/render/schema-check.ts:35-37` caches its schema; the static renderer could too.

## 5. Backlog check

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| I4 · High: a panel drop followed by a block move orphans comment threads | Fixed | Yes | `extensions/field-binding.ts:68-76`: `PanelDrop` has `priority: (UniqueID.config.priority ?? 0) + 1` and takes the drop in `handleDOMEvents.drop`, so UniqueID never marks it (verified). |
| N6 · Low: an unparsed drop, then a block move, strips ids | Fixed | Yes | `field-binding.ts:83-90`: a drop with no `VARIABLE_DRAG_TYPE`, no `text/plain`, no `text/html` and no `view.dragging` is swallowed (verified). |
| R8 · Low: paste cleanup skipped when text mentions `data-pm-slice` | Fixed | Yes | `paste/normalize-html.ts:51-53`: parses first, passes through only when `doc.querySelector("[data-pm-slice]")` matches; `paste.test.ts:159` covers the text-only mention (verified). |
| G5 · Medium: the editor's public API is enforced only in prose | Fixed | Yes | README table and `EDITOR_PUBLIC_MODULES` are the same 28 modules; `npx eslint src` passes; `renderThread`, `dispose()`, `requiredSections=` have no remaining references (measured). The remaining gap is per-name leakage (L3). |
| I14 · Low: every ⌘B in the editor also toggles the hidden sidebar | Fixed | Yes | `grep keydown|metaKey|KeyboardEvent src/components/ui/sidebar.tsx` finds nothing (measured). |
| T7 (unit part): tests that slept in real time | Fixed | Yes | `extensions/required-sections.test.ts:227-238` uses `vi.useFakeTimers()` and `advanceTimersByTimeAsync` (verified); the whole editor suite runs in 2.93 s (measured). |
| N27 · Low: the block handle at 320px | Fixed | Yes | `components/block-handle.tsx:36-37` (`FIT_GUTTER`: `max-w-[var(--ucomp-doc-gutter,3.5rem)]`, wrap-reverse) (verified). |
| D8 / decision 0022: renames lost between panel and submit | Fixed | Yes | `state/variable-store.ts`, `model/contract.ts`, `server/drafts/parse-patch.ts:89-109` implement the decision as written (verified). |
| Follow-ups: "Word import keeps the source's numbering" | Open (unnumbered) | True, still open | `paste/normalize-html.ts:430` uses the marker only to pick `ol`/`ul` (verified). Deserves a numbered finding (M3). |
| G2 note: "`sections.ts` silently assumes required headings are H2" | G2 Fixed (plan archived) | The assumption itself is still true and untracked | M1 above. |

New findings the backlog does not have: M1 (H2 invariant), M2 (no JSON Schema / uuid rule), L1 (NUL in Markdown), L2 (chip in required heading), L3 (`useEditorRoot` leak, table wording), L4 (stale README/components README statements), L8.

## 6. For the Java team

**Ports cleanly (pure TypeScript, pinned by tests, mirrored by `docs/render-spec.md`):**
- `src/editor/model/normalize.ts` + `model/table-grid.ts` + `model/characters.ts` + `model/links.ts` (`normalizeLink`): save normalization (§3). Each function is a table row. Note the `Edges`/`openStart` arguments exist only for the editor's paste slices; the server path always calls `normalizeDocument` with closed edges.
- `src/editor/model/document-check.ts`: the limits (§3 "The document check"), 143 lines, depth-first, first broken rule wins; the sentences in `DOCUMENT_MESSAGES` are the contract (`code` + sentence, like the refusals elsewhere).
- `src/editor/model/list-markers.ts`: `formatNumber` (bijective base-26 letters, subtractive roman to 3999, decimal fallback), `resolveNumbering`, `bulletGlyph`. Pure functions, 85 tests.
- `src/editor/model/variables.ts`: `validateValue`/`formatValue` on exact decimal strings (no `BigDecimal` rounding; keep the digits as text), `parseDate` on a fixed English month table, `US_STATES`. 241 tests form the port's table.
- `src/editor/model/contract.ts` + decision 0022: `identityOf` and the two-pass `diffVariables`. `Variable.id` is a nullable string that may look like a key.
- `src/editor/model/section-title.ts`: `sectionTitleKey` uses `String.prototype.normalize("NFKC")`; Java's `java.text.Normalizer.normalize(s, NFKC)` matches.

**Needs rethinking or a decision:**
- The schema parse (`parseWithSchema`): ProseMirror content expressions (`paragraph block*` for `listItem`, `(paragraph | bulletList | orderedList)+` for cells, `paragraph+` for callout, `block+` for doc, `inline*` for textblocks) have no Java equivalent. Either keep document validation in the Node BFF (the autosave route already runs `prepareBody`) and have the Java API trust it, or generate a JSON Schema from `editorSchema()` and port that (M2). Pick one before the first stored-document endpoint.
- Block ids: UUID v4 strings from `uuid` via UniqueID (`ensureBlockIds`); §3's "normalize → check → add ids → normalize again" means the Java side must also strip the attribute defaults the round trip writes back (`align: null`, `type: null`) if it ever adds ids itself.
- `requiredKey` is only ever on an H2 in practice (M1); write the rule down before porting usage counts or section merging.
- JSON numbers: the spec says `3.0` is 3 for `level`, `start`, `colspan`; Jackson reads `3.0` as a double, so compare by value, not by token type. `start` must be an integer in 0–9999 (`Number.isInteger`), spans integers ≥ 1.
- Character classes: `INVISIBLE_CHARACTERS` (`links.ts:69-72`) and `CONTROL_CHARACTERS` (`characters.ts:14`) include astral ranges (`\u{E0000}-\u{E0FFF}`); Java regex needs `(?U)`-style code-point handling or `\x{...}` escapes, and `longerThan` counts code points (`codePointCount`), as `variables.ts:84` already notes.
- Nothing in the editor's TipTap JSON is normalized into relational columns; the body is one JSON document per version (the data-model slice covers the column), so MSSQL stores it as `NVARCHAR(MAX)`/JSON and validation stays in code.

**Read first (in order):** `docs/render-spec.md` §2–3, `src/editor/README.md` "Document contract (TipTap JSON)" (lines 203-224), `src/editor/model/normalize.ts`, `src/editor/model/document-check.ts`, `src/editor/model/contract.ts` with `docs/decisions/0022-…`, and `src/editor/schema.ts:120-183` (`buildBase`) for where the node specs come from.

## 7. Files

**Models of good code in this slice**
- `src/editor/model/list-markers.ts`: vocabulary, guards, defaults, formatting, helpers, in that order; every function says its domain and its fallback.
- `src/editor/model/contract.ts`: 80 lines that read like the decision record they implement.
- `src/editor/model/characters.ts` and `model/links.ts:55-78`: character sets spelled out for a port.
- `src/editor/model/table-grid.ts`: `TableMap`'s placement algorithm restated on JSON with merged column ranges, and it says why ("a colspan of a billion costs no more than a colspan of 2").
- `src/editor/state/editor-root.ts`: a runtime a human can follow top to bottom; field records, one `publish`, one `flushUsage`.
- `src/editor/extensions/field-binding.ts:46-66`: the best "why this order" comment in the repo.
- `src/editor/testing/editor.ts`: a 149-line harness that drives ProseMirror through its real handler props and prints documents as `h2*:Title`, `p:text`.
- `src/editor/paste/normalize-html.ts`: a 508-line DOM cleaner that reads top-down and keeps Word's list conversion in one place.

**Files a human will struggle with**
- `src/editor/components/block-menu.tsx` (524 lines, eight components, Base UI focus workarounds).
- `src/editor/components/document-editor.tsx` (module-level dynamic import cache, six refs, Activity lifecycle, history carry, page-level shortcut).
- `src/editor/extensions/review-threads.ts:200-236` (`remap`: five-way branching on decoration kind, quote presence and changed ranges; correct, but nothing names the cases).
- `src/editor/lib/history-carry.ts` (clever, honest about relying on prosemirror-history internals).
- `src/editor/extensions/required-sections.ts:133-196` (`piecesAround`/`writablePos`/`replaceAroundRequired`: needs the ProseMirror position model in your head).
- `src/editor/model/normalize.ts:130-175` (`normalizeNode` with `Edges`, `inCell`, `field`, `paste` all threaded through one recursion; the header table saves it).
- `src/editor/README.md` itself, until the history sections go.
