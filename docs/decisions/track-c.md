# Track C decisions (Phase 7a: import, Copilot, ⌘K, carried rough edges)

Autonomous calls made by the lead. Each can be overruled at review.

## Compare with original: the rail widens (no separate mock)
- **Picked:** "Compare with original" works like Preview: the right rail widens and shows the uploaded source (an "Original" tab beside Variables), with the draft in the main pane. Reason: the recorded Rail layout ("main pane is just the document; Preview = rail widens") already answers this; a side-by-side split would introduce a second layout pattern for the same job.
- No dev mock was built for this one, because the layout is dictated by an existing decision rather than open taste.

## Typing latency: no regression, no change
- Re-measured (10 runs of `e2e/perf/typing-latency.mjs` + 4 every-keystroke CDP traces × 192 keystrokes, under the heavy lock). The handler per keystroke is a **1.2 ms median (p95 ~1.8 ms)**, below Phase 2's ~1.5 ms. Phase 4 code adds at most ~0.04 ms per keystroke (review-threads maps decorations; format-bubble doesn't re-render while typing; block-rects only fires on resize or block moves).
- The earlier "2.5 ms" came from the script's Event Timing metric, which only reports keystrokes slower than 16 ms to paint (46–71 of 192): the slow tail on a busy machine. Runs split into 1.2–1.5 ms and 2.5–3.0 ms groups purely by machine load.
- **Decision:** no code change. For future gating, use per-event processing time or a trace rather than the script's median alone.
- Not measured: the real workspace route with gutter markers subscribed (their signal fires at most once a frame, on resize or block moves).

## PDF keep-with-next chain
- **A heading + a short intro (≤ 3 lines) + a table/list/callout start move together**: the heading and intro become one non-wrapping group that reserves room for the next block's head (for a table, its header and first row). An intro longer than 3 lines breaks the chain so it can split and doesn't drag the table. Long tables still split with the header repeated. Seeded templates' page counts are unchanged.

## Redline "Changes only": markers for threads on hidden blocks
- **A thread on a hidden unchanged block shows its marker on the "N unchanged blocks" line that hides it** (counts summed per line). Clicking it opens the thread and reveals that block in place, tinted, splitting the collapsed run around it.

## Import, Copilot, ⌘K contracts (accepted from the Phase 7a brief)
1. **Upload goes through a route handler** (`POST /api/imports`), because server actions cap request bodies at 1 MB.
2. **pdf.js runs with its worker in-process** (legacy build; worker imported before the first `getDocument`). No next.config change.
3. **Import is a dashed "Import a file" row under the starter cards**: not a fifth card, not a second Library button (one primary per screen).
4. **Picking a file imports at once.** On arrival the template name is selected and the Original tab is open, with the import report at its top (consequences shown where you land, no confirm step for a non-destructive action).
5. **`{{First Name}}`-style placeholders become Text chips** (key via `toKey`, required). Template logic (`{{#if}}` etc.) stays as text and is listed in the report.
6. **A leading Title/H1 becomes the template name**; missing required sections are added empty, in order.
7. **The original belongs to the template**, so the Original tab shows on every version.
8. **The Copilot prompt opens from a quiet rail row**, built on the server from the saved draft (body only).
9. **Paste-back merges sections and parses Markdown**: pasted headings that match required sections merge into them instead of duplicating; one undo step.
10. **The ⌘K palette has no persona switch or demo tools**; Recent comes from the audit log.
11. **Dropping a .docx onto an open document is out of scope.**
- Limits: 10 MB, 50 PDF pages, 200k characters. Files live in `./data/uploads/<uploadId>/` (the client's file name is never used in a path).
- New deps: `mammoth` 1.13.0; `jszip` 3.10.2 (dev, test fixtures).

## ⌘K palette (C7-4)
- Groups: Recent (no query; up to 5 of the viewer's audit events here), Actions (New template, Import a file; only where you can create), This template (Content, Versions, Usage, Activity), Templates (recently touched rank first), Pages (Library, Review, Usage, Audit if permitted), Settings (sections you may open), Teams.
- **Preview isn't a palette item**: it's rail state inside the workspace, not a route.
- **⌘K defers to the editor**: with a text selection it opens the link field instead.
- Data is fetched once per space (`/api/palette/[space]`) and refreshed when templates change or after 20 s.

## Import server (C7-1)
- **`{{First Name}}` and `{{first_name}}` merge into one key**; a placeholder split across formatting runs becomes one chip.
- **An H1 that matches a required section stays a section** rather than becoming the template name.
- **PDF lines set noticeably larger than body text become headings** (a ~1.6× line becomes the title), so a PDF gets a name and its sections match. Repeated running lines (headers/footers) are dropped and reported.
- **Images, comments, footers and Word styles are dropped** and listed in the import report; a .docx's images still show in the Original tab (data: URIs, capped at 2 MB).
- **The import shows in Activity** as "Maya Chen imported Spring offer.docx."

## Copilot prompt and paste-back (C7-2)
- **The Copilot prompt dialog** sends the pending autosave first, then builds the prompt on the server from the saved draft (body only, Markdown, with each `{{key}}` and the required section headings). "Copy prompt" is the one black button.
- **Plain-text Markdown pasted into the document parses as Markdown**; one-line fields and ⇧⌘V paste text exactly as before.
- **A pasted section's blocks go at the end of the matching section** (or replace it if it holds only empty lines); unmatched headings stay headings.
- **A paste is always its own undo step**, even right after typing (otherwise one Cmd+Z in Chrome also took back the line typed before).
- **A required heading copied from an editor still pastes as a plain heading** (the existing guard behaviour is unchanged).
- Typing latency after this change: per-event processing 0.6–0.8 ms median (none of this code runs while typing).

## Fix batch 1 (QA part 1)
- **A marker on a collapsed "N unchanged blocks" line says "N comment(s) in unchanged blocks"**; once the block is revealed it says "on this block". Choosing a marker with the keyboard puts focus back on the thread's marker even though it is re-keyed onto the revealed block.
- **Inserted text in the redline uses a darker green** (`--rl-ins-text`, 70% of the positive token mixed with the ink) because the token on its tint was 4.31:1; the underline keeps the token's green.
- **No placeholders that repeat the label**: the comment/reply box and the link field ("Link address") have none; their accessible names are unchanged.
- **Chip labels made from keys keep whole-word acronyms in capitals**: APR, APY, FDIC, ID, URL, ATM, ACH, SSN ("purchase_apr" → "Purchase APR"). `labelFromKey` is shared, so import reports and pasted-chip labels agree. Only whole words match ("identity" stays "Identity").
- **Palette Recent leaves out the template you are on** (the "This template" group covers it) **and Templates doesn't repeat what Recent shows** at rest. While typing, Recent is hidden and everything is in Templates, as before.
- **A settings row's "Team"/"Platform" tag shows only when both kinds are listed.**
- **Palette search also matches a template's status label** ("draft", "active", "in review").
- **⌘K does not open over another modal** (dialog, alert dialog, sheet); it still closes itself when open.

## Import UI and the Original tab (C7-3)
- **Rail tabs read Preview, Original, Comments, Variables**; Original shows only when the template came from an import.
- **On arrival from an import** the template name is selected and, on wide canvases, the rail opens on Original with the report at its top. Below the rail breakpoint it doesn't auto-open (it would cover the name being edited); the Original tab is one click away.
- **Upload pre-checks run in the browser** (type, empty, size), so the common refusals appear instantly at the import row.
- **Esc in the workspace ignores popups that aren't on screen** (the Library's New template dialog stays mounted, hidden, under `<Activity>`).

## Fix batch 2 (QA part 2)
- **The import report has three groups: Detected, Dropped, Kept as text.** Template logic is kept in the document, not dropped, so it is listed apart, one line per conditional ("{{#if member}} … {{/if}} shows to customers as written."); an opener is paired with the closer of its name and an `{{else}}` joins the conditional it sits in. Braces that aren't a name get the same line.
- **Report wording**: variables say they are all Text and required; a Word style reads "Quote formatting"; added sections read "Added empty sections: Legal notices" (singular for one); a dropped image says "(still shown in Original)"; a file with no section and no headings says "The text stays above the first section".
- **Magic bytes are checked in the browser**: a file named .pdf that doesn't start "%PDF", or a .docx that isn't a zip, is refused unsent ("This isn't a valid PDF." / "This isn't a valid Word file."), so there is no failed request in the console. The server refuses the same with codes `notPdf` / `notWord` (415). A legacy .doc gets `legacyDoc`: "...Save it as .docx first."
- **The import row has no hint text and always keeps a slot for its refusal line**, so a refusal never changes the dialog's height. The busy row reads "Importing <file>".
- **Below the rail breakpoint, arriving from an import doesn't open the rail** (it would cover the name being edited); the Original tab is one click away in the overlay. The arrival skeleton stays shut there too.
- **Esc on the Original view returns focus to what opened the rail** (the rail toggle below the breakpoint, the Preview toggle, or the plain rail's Original tab); Esc in the name field with the rail open closes the rail and keeps focus in the name. Clicking the plain rail's Original tab moves focus to the widened rail's Original tab.
- **The Preview toggle is pressed only on the Preview view**, not on Original or Comments; clicking it there opens Preview.
- **The New template dialog wraps Tab itself** (Base UI hands focus over from a guard a moment later, which showed as focus leaving the dialog) and closes when a starter's template has opened, as it does for an import.
- **⌘K ignores a hidden modal** (`checkVisibility`) and its Templates list is refreshed from `/api/palette/{space}` (which now carries the space's templates) the next time it opens after a starter or an import.
- **Copilot prompt**: the draft's own opening is kept when it begins with a greeting; logic tags and placeholders are left as written; no invented rates, fees or legal terms; an empty draft ends "Write the body now."; "Untitled template" is not sent as a name.
