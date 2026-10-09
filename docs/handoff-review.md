# Codebase review (October 2026)

Ten independent reviewers read the whole codebase at `main` @ ec3978b (October 7, 2026), looking for what a production dev team, or an AI agent copying the code, would trip over. This page is that review as a working backlog: every finding, its severity, where it is, what happens and how to fix it, with its current status. It also holds what the fixes turned up, in [Found while fixing](#found-while-fixing).

## How to use this page

- **Pick work** from [Found while fixing](#found-while-fixing), most severe first, and from [Alongside: tooling and hygiene](#alongside-tooling-and-hygiene). Every item in [Fix first](#fix-first) is fixed. Skip anything marked Fixed or Deferred, and don't pick from [Waits for the enterprise work](#waits-for-the-enterprise-work): those findings get fixed as part of that work.
- **Fix a finding in its own PR** (or a small group of related ones), and change its **Status** line here in the same PR: `Open` → `Fixed`, with one sentence saying what changed, and update the counts in [Status](#status). Keep the heading as it is so links to it keep working. That keeps this page true; a finding marked Open must still be reproducible.
- **Line numbers are from ec3978b.** Files touched since then have moved; find the code by the symbol or behavior described. A path that no longer exists is marked as moved or removed. The findings in [Found while fixing](#found-while-fixing) give no line numbers, only files and symbols.
- **Evidence** says how sure the finding is: *measured* (from a check run for the review or, in Found while fixing, for a fix), *verified* (re-read in the code after the reviewer reported it), *reproduced* (proved with a throwaway test), *traced* (followed through the code, not run). Re-check a *traced* finding before fixing it.
- **Rules still apply.** Read [AGENTS.md](../AGENTS.md) and the README of the layer you're changing. Rendering changes must keep the golden files and parity tests green ([src/server/render/golden](../src/server/render/golden/README.md)).

## Status

| Status | Critical | High | Medium | Low | Total |
| --- | --- | --- | --- | --- | --- |
| Open | 0 | 3 | 12 | 27 | 42 |
| Partly fixed | 0 | 4 | 3 | 2 | 9 |
| Fixed | 1 | 19 | 25 | 5 | 50 |
| Deferred | 1 | 2 | 1 | 0 | 4 |

Fixed so far: PR #6 (the render engine prints exactly what the author typed, in every channel), PR #7 (golden files and parity tests), PR #8 (the in-repo documentation system), and PRs #9–#40 (the Fix first list, October 2026).

The findings not yet fixed fall into three groups: what the fixes turned up, in [Found while fixing](#found-while-fixing); tooling and hygiene, in [Alongside: tooling and hygiene](#alongside-tooling-and-hygiene); and findings that [wait for the enterprise work](#waits-for-the-enterprise-work): real sign-in, the Java API, the enterprise font and the removal of the demo tools.

**Deferred** findings are demo and login stand-ins the owner will replace with real login and by removing the demo tools; don't fix them in place.

## Fix first

Every item in this list is fixed, in PRs #9–#40. The next work is [Alongside: tooling and hygiene](#alongside-tooling-and-hygiene), below, and the findings the fixes turned up, in [Found while fixing](#found-while-fixing).

None of it waited on real sign-in, the Java API or the enterprise font, and none of the fixes gets thrown away when those land. The groups follow what each finding puts at risk: in a product for regulated content, customers seeing only approved content comes first and authors never losing work second, then logic and UI that's wrong or fragile, then polish. Within a group, the likeliest and cheapest came first. An item that names several findings was one PR.

The three items that needed an owner decision were decided: [D1](#d1--high-revoking-the-live-version-freezes-the-template-for-good) in [decision 0009](decisions/0009-correct-a-revoked-version-from-its-content.md) (the corrected draft starts from the revoked version's content), [I5](#i5--high-a-draft-rename-goes-live-without-review) in [decision 0016](decisions/0016-the-name-is-versioned.md) (the name is a version field) and [D6](#d6--medium-a-sunset-date-means-midnight-utc) in [decision 0017](decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md) (a sunset date ends at 00:00 in the business time zone).

### Make main green

1. [T1 · High](#t1--high-main-fails-e2e-the-undoredo-merge-added-a-layout-shift): The suite has to pass before anything else, or the next regression hides among known failures. Render the undo/redo buttons disabled from the first paint.

### Customers see content that wasn't approved

2. [D2 · High](#d2--high-setting-a-new-sunset-brings-a-sunset-version-back-to-life): A passed sunset can be undone, so a withdrawn version renders again. One guard in `setSunset`.
3. [S3 · High](#s3--high-maker-checker-only-stops-the-submitter-not-the-author): An author approves their own content when a teammate clicks Submit. Holding Author and Approver on one team is normal, so this happens in ordinary use.
4. [D1 · High](#d1--high-revoking-the-live-version-freezes-the-template-for-good): Revoking wrong legal text leaves the template with no way to publish the correction.
5. [D3 · High](#d3--high-editing-the-approval-chain-mid-review-stalls-or-skips-stages): Editing the chain while a version is in review can skip a stage or stall it for good. Snapshot the chain on the version at submit.
6. [D4 · High](#d4--high-the-chain-editor-saves-chains-nobody-can-approve): The chain editor saves chains that stall every submission. Write one domain `validateChain` and use it in the action and on the screen.
7. [A2 · High](#a2--high-consumers-polling-notices-can-silently-miss-a-revoke): A consumer can miss a revoke and keep rendering withdrawn content. Fix the contract now (oldest-first cursor, `hasMore`), before a Java team ports it as it is.
8. [I5 · High](#i5--high-a-draft-rename-goes-live-without-review): Typing a new name changes the live version's title in customer output without review.

### Authors lose work without being told

9. [I2 · High](#i2--high-the-revert-toasts-undo-overwrites-edits-made-after-the-revert) and [I9 · Medium](#i9--medium-revert-to-vn-has-no-error-handling-or-pending-guard): Revert's Undo wipes edits made after the revert, and Revert has no error or pending handling. Same code, one PR.
10. [I1 · High](#i1--high-renaming-a-draft-outside-the-content-tab-is-never-saved-but-shows-saved), [I6 · Medium](#i6--medium-after-a-save-conflict-the-editor-stays-editable-but-nothing-saves) and [I10 · Medium](#i10--medium-large-drafts-can-lose-the-last-edits-on-tab-close): Three ways the autosave session drops edits silently: a rename outside the Content tab, any edit after a save conflict, and a large draft's last edits on tab close.
11. [I8 · Medium](#i8--medium-submit-can-freeze-content-the-dialog-didnt-list): Submit can freeze edits the summary dialog didn't show. Make submit a compare-and-set on `rev`.
12. [I3 · High](#i3--high-renaming-a-variable-with-email-off-orphans-its-chips-in-the-subject): Renaming a variable with Email off breaks the subject line and blocks Submit.
13. [I4 · High](#i4--high-a-panel-drop-followed-by-a-block-move-orphans-comment-threads): Dragging a block after a panel drop detaches its comment threads.

### Logic and UI that's wrong or fragile

14. [S7 · Medium](#s7--medium-comments-are-accepted-on-any-version-state) and [S9 · Low](#s9--low-cross-team-stage-reviewers-can-act-on-any-thread-of-the-template): The comment rules exist only in the client, so a direct call comments on an Active version, and stage reviewers can act on threads they can't see. One `domain/comments.ts`, and `can.comment` in the read model.
15. [A6 · Medium](#a6--medium-reads-are-exposed-as-server-actions): Three read modules are public POST endpoints without validation, queued behind Edit and Submit. Read through server components or GET routes.
16. [S6 · Medium](#s6--medium-body-size-limits-trust-the-declared-content-length): Autosave buffers a chunked body of any size before it checks permission. Reuse `readBodyCapped` and cap each value's length.
17. [I7 · Medium](#i7--medium-no-error-boundaries-anywhere): Any thrown error replaces the whole app with Next's error page.
18. [I11 · Medium](#i11--medium-the-ui-branches-on-exact-english-sentences): The UI branches on exact refusal sentences, so a copy edit changes behavior. Stable codes are also step 3 of [the backend seam](#the-backend-seam).
19. [A3 · Medium](#a3--medium-six-error-shapes-and-some-actions-throw) and [H1 · Medium](#h1--medium-three-server-action-styles): `startDraft` and `createTemplate` throw, so production shows a generic error instead of the domain's sentence. One action kit and one client hook; the `/api/v1` error shape waits for [the Java API](#the-java-api).
20. [H2 · Medium](#h2--medium-client-components-re-implement-domain-rules): Settings screens run domain rules with a blank actor and a 1970 date, and copy the server's refusals. Item 6's `validateChain` is the pattern.
21. [D8 · Medium](#d8--medium-variable-renames-are-lost-between-the-panel-and-submit): A variable rename reaches review and consumer notices as a removal plus an addition.
22. [D7 · Medium](#d7--medium-nothing-records-when-a-sunset-passes): Nothing records when a sunset passes, and the test for it is written four times. Its scheduled trigger comes with the sign-in work's scheduled sweep ([S4](#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep)).
23. [D6 · Medium](#d6--medium-a-sunset-date-means-midnight-utc): "Sunset on March 1" stops renders at 7 PM Eastern on February 28.
24. [I12 · Medium](#i12--medium-every-page-ships-the-whole-template-catalog-and-the-palette-keeps-the-last-personas-data): Every page ships the whole template catalog, and the palette shows the previous persona's templates. With real sign-in that would be the previous user's, so fix it before sign-in lands.
25. [I13 · Medium](#i13--medium-blocked-decisions-and-charts-arent-accessible): Blocked decisions can't be reached by keyboard, and the charts' values are hover-only.
26. [D9 · Medium](#d9--medium-today-and-yesterday-disagree-between-screens) and [H4 · Medium](#h4--medium-formatting-helpers-are-duplicated-and-clash): Screens disagree on "today", and the date, plural and number helpers exist in many copies. One module for each.

### Polish

27. [I14 · Low](#i14--low-every-b-in-the-editor-also-toggles-the-hidden-sidebar): ⌘B in the editor also toggles the hidden sidebar.
28. [H5 · Low](#h5--low-rebrand-leftovers-two-of-them-customer-visible), the email sender only: previews fall back to `no-reply@ucomp.example`. The PDF font names wait for [the enterprise font](#the-enterprise-font).
29. [R8 · Low](#r8--low-paste-and-import-cleanup-is-skipped-if-a-document-mentions-data-pm-slice): Paste cleanup is skipped whenever the text mentions `data-pm-slice`.
30. [I15 · Low](#i15--low-focus-and-esc-handling-is-wired-through-dom-queries): Esc and focus find their targets by label text, so renaming a label breaks them.
31. [H3 · Medium](#h3--medium-forked-primitives): Segmented controls, stat cards, tablists and clipboard helpers exist in two to four copies each.

### Alongside: tooling and hygiene

Not logic or UI, and nothing to wait for. Take T4 and T3 first, since every fix relies on the checks; fit the rest in between the findings in [Found while fixing](#found-while-fixing).

- [T4 · High](#t4--high-no-ci-node-pin-or-environment-template): No CI, Node pin or `.env.example`. A workflow running e2e would have caught [T1](#t1--high-main-fails-e2e-the-undoredo-merge-added-a-layout-shift).
- [T3 · High](#t3--high-database-backed-unit-tests-depend-on-order): The database-backed tests still depend on their order.
- [T5 · Medium](#t5--medium-e2e-cant-be-pointed-at-its-own-database): E2E can't point at its own database. Its raw-SQL assertions are part of [the Java API](#the-java-api) work.
- [S8 · Medium](#s8--medium-design-mocks-and-labs-ship-in-production-builds): Design mocks and labs ship in production builds.
- [G4 · Medium](#g4--medium-build-process-docs-and-artifacts-with-dead-paths): Dead paths and uncited media remain. Check git history for the third-party product named in `design-reference.md` before the repo is shared.
- [B6 · Medium](#b6--medium-server-code-imports-from-components): Server code imports from components, and no lint rule stops it.
- [G5 · Medium](#g5--medium-the-editors-public-api-is-enforced-only-in-prose): Nothing enforces the editor's public API.
- [T6 · Medium](#t6--medium-shadcn-is-a-runtime-dependency): `shadcn` is a runtime dependency, and `next-themes` is unused.
- [T7 · Medium](#t7--medium-slow-and-brittle-test-habits): Real sleeps in unit tests and `waitForTimeout` in e2e.
- [T9 · Low](#t9--low-no-coverage-tooling-and-some-server-code-is-untested): No coverage tooling.
- [G6 · Low](#g6--low-decisionsmd-is-wrong-in-three-places): Three wrong lines in the decisions log.
- [H7 · Low](#h7--low-dead-code): Dead code.
- [H8 · Low](#h8--low-oversized-files-and-functions): Oversized files. Split `ReviewWorkspace` before the approver-views-output follow-up adds to it.

## Found while fixing

The PRs that fixed the [Fix first](#fix-first) list noticed these and left them alone to stay in scope. Each was checked again in the code at `main` @ 2fca829 (October 9, 2026), and says which fix noticed it. They're ordered by severity, then, as Fix first was, by what they put at risk: what approvers and authors are told, authors' work, logic and UI, code that gets copied, then the tests and docs. None of them waits for the enterprise work.

#### N1 · Medium: After a revoke, the review screen shows no redline

- **Status:** Fixed. With nothing Active, the redline, its label and the change count compare with the revoked version the correction started from ("vs v3 (revoked)"), falling back to the version that still renders, while the Approve dialog keeps the Active version as its previous one ([decision 0031](decisions/0031-a-correction-is-redlined-against-the-revoked-version.md)).
- **Where:** `src/server/queries/review.ts` (`getReviewScreen`, its `baseline`); `src/components/review/review-workspace.tsx`
- **What happens:** The review screen compares the version only with the Active one: `baseline` is null when nothing is Active. After the Active version is revoked ([D1](#d1--high-revoking-the-live-version-freezes-the-template-for-good)), the approver reviewing the correction gets no redline and no "vs vN" label, so the whole document reads as new and they can't see what the correction changed. The rename line on the same screen already compares with `contractBaseline`. Noticed while fixing D1 (PR #16).
- **Fix:** When nothing is Active, compare with the draft's base version (`versions.basedOnVersionId`, the revoked version the correction started from) or with `contractBaseline`, and name it in the label. Keep the approve dialog's previous version apart ([N3](#n3--low-after-a-revoke-approves-consequences-read-as-a-first-version)): today it takes `baseline`'s number.
- **Evidence:** traced

#### N2 · Medium: A failed demo-script run leaves its state to the specs after it

- **Status:** Fixed. The spec's `afterAll` re-seeds the database (`resetDemoData()`) however the run ended, a timeout included, and scenario-07, which turned Disclosure's Email off and back on in the test body, now puts the rule back in `afterAll` too.
- **Where:** `e2e/demo-script.spec.ts` (`test.afterAll`)
- **What happens:** The spec plays the whole demo on one database state: it resets in `beforeAll` and ends on the demo drawer's Reset. When a step fails, `afterAll` only closes the database, so the run's state stays behind: the demo clock moved on, access lapsed (Maya's, in the failed runs), and Coral's offers relinked to the story's versions. The specs after it run on that database, so one failure here cascades into dozens in specs that have nothing to do with it (principles, scenario-04, scenario-05). Its header says the next run starts with a reset, which holds only for the next run of this spec. Seen in the e2e runs of the Fix first PRs.
- **Fix:** Reset in `afterAll` whatever happened (`resetDemoData()`, as `beforeAll` does), so a failure stays in this spec. Relates to [T7](#t7--medium-slow-and-brittle-test-habits), which would retire or merge the spec.
- **Evidence:** measured

#### N3 · Low: After a revoke, Approve's consequences read as a first version

- **Status:** Open
- **Where:** `src/domain/consequences.ts` (`approveLines`); `src/server/queries/review.ts` (`getReviewScreen`'s `previousNumber`, which `src/components/review/review-workspace.tsx` passes to the dialog)
- **What happens:** The approve dialog takes its previous version from the Active one. With nothing Active, after a revoke, it says "v3 becomes Active." and "Consumers can start using it right away.", as for a first version. Consumers still pinned to a Superseded version that renders aren't named, nor are the keys they have to map before they move ("Coral has to map `annual_fee` before it moves to v3."), though the version's contract changes were worked out against that version. Noticed while fixing D1 (PR #16).
- **Fix:** When nothing is Active, pass the newest version that still renders (`contractBaseline`) as the version consumers move from, with an approve case for it in `consequences`: no "becomes Superseded" line, and the mapping lines for its consumers.
- **Evidence:** traced

#### N4 · Low: A passed sunset still reads as a date to come on the status badge

- **Status:** Open
- **Where:** `src/components/primitives/status-badge.tsx` (`StatusBadge`)
- **What happens:** A Superseded version with a sunset date reads "Superseded · Sunset Oct 1" whether the day is ahead or has passed. Once it has passed the version no longer renders, but the badge still reads like a date to come, wherever it shows one: Versions, Usage and the review header among them. Versions adds "Sunset passed Oct 1" to the entry's dates; the badge beside it doesn't change. Noticed while fixing D2 (PR #9).
- **Fix:** Pass the badge whether the sunset has passed (the Versions and Usage read models already work out `sunsetPassed`) and word it for that, for example "Superseded · Sunset passed Oct 1".
- **Evidence:** traced

#### N5 · Low: Submit's hold rearranges the variables panel and closes an open form

- **Status:** Open
- **Where:** `src/editor/components/variables-panel.tsx` (`readOnly`); `src/components/workspace/content/content-workspace.tsx` (`useInert`)
- **What happens:** From the Submit click until the dialog closes, the page is held read-only ([I8](#i8--medium-submit-can-freeze-content-the-dialog-didnt-list)), and the variables panel switches to its read-only layout: no insert buttons, no New variable, no open form. The rail rearranges under the dialog. A variable form that was open closes, and what was typed in it and not yet applied is gone when the hold lets go, on Submit or Cancel. Noticed while fixing I8 (PR #22).
- **Fix:** Keep the panel's editing layout while the page is held, with its controls disabled rather than removed, and keep an open form with what was typed in it.
- **Evidence:** traced

#### N6 · Low: An unparsed drop, then a block move, strips the block's ids

- **Status:** Open
- **Where:** `src/editor/extensions/field-binding.ts` (`PanelDrop`)
- **What happens:** UniqueID marks every drop from outside the editor so that the next `transformPasted` strips the dropped blocks' ids, and only `transformPasted` clears the mark. A drop ProseMirror can't parse into content, a file for example, never reaches `transformPasted`, so the mark outlives it and the next block moved by its ⋮⋮ grip loses its id. Its comment threads fall to "On removed content", as in [I4](#i4--high-a-panel-drop-followed-by-a-block-move-orphans-comment-threads). `PanelDrop` goes ahead of UniqueID for panel rows only; the mark itself is upstream behavior. Noticed while fixing I4 (PR #18).
- **Fix:** Have `PanelDrop` also take, and swallow, a drop that carries no text, no HTML and no `view.dragging`, so UniqueID never marks it. Report the mark's lifetime upstream.
- **Evidence:** traced

#### N7 · Low: Sample values have no 1,000-character limit where they're typed

- **Status:** Open
- **Where:** `src/components/preview/sample-sets/values-editor.tsx`; `src/editor/components/variable-form.tsx` (Sample); `src/server/drafts/parse-patch.ts`
- **What happens:** Autosave refuses a sample value over 1,000 characters, the limit [S6](#s6--medium-body-size-limits-trust-the-declared-content-length) put on every render value, but the sample-set value inputs and the variable form's Sample field take any length, and `validateValue` doesn't check it. Past it, the save is refused and the status shows zod's message with its path: `Not saved. sampleSets.0.values.first_name Too big: expected string to have <=1000 characters`. Noticed while fixing S6 (PR #20).
- **Fix:** A 1,000-character `maxLength` on those inputs, and a plain sentence for the refusal.
- **Evidence:** traced

#### N8 · Low: Submit stays available after saving stops

- **Status:** Open
- **Where:** `src/components/workspace/workspace-actions.tsx` (`SubmitButton`)
- **What happens:** Once saving has stopped for good ([I6](#i6--medium-after-a-save-conflict-the-editor-stays-editable-but-nothing-saves)), Submit for review still looks available. Pressing it tries the save again, then shows the stop's reason in a popover under the button, though the reason was known before the click. Noticed while fixing I6 (PR #31).
- **Fix:** Show Submit disabled while saving is stopped, with the reason at the control (`BlockedButton`), as the rule for unavailable controls asks.
- **Evidence:** traced

#### N9 · Low: The error boundaries leave three loose ends

- **Status:** Open
- **Where:** `src/components/workspace/workspace-tab-bar.tsx`; `src/app/global-error.tsx`; `src/components/app-shell/skeletons.tsx` (`StaticRow`)
- **What happens:** When a workspace tab fails, its error takes the document's cell and the header and tab bar stay, with the tab bar's Edit, Submit for review and Preview still enabled, though the tab they act on didn't load. The simulator has no error boundary of its own, so a failure under `/sim` shows Stencil's global error page, whose Back to library goes to `/`. And the sidebar's skeleton, on screen while the sidebar streams in, dims its labels to 60% opacity, which axe measures at 4.39:1, under 4.5:1. Noticed while fixing I7 (PR #23).
- **Fix:** Disable the tab bar's actions while the tab shows its error, with the reason; give `src/app/(simulator)` its own `error.tsx` that goes back to `/sim`; draw the skeleton's labels at full contrast.
- **Evidence:** traced

#### N10 · Low: The save status's chevron moves as a save lands

- **Status:** Open
- **Where:** `src/components/workspace/save-status.tsx` (`RevertMenu`'s trigger)
- **What happens:** On a draft with something to revert to, the save status is the Revert menu's trigger, with its chevron after the text. The text changes width from "Saving…" to "Saved", so the chevron moves about 11px as each save lands: a layout shift of about 0.000002, more than 500 ms after the last keystroke, so the zero-shift rule counts it. No e2e test types into a draft and then checks layout shift, so nothing catches it. [T1](#t1--high-main-fails-e2e-the-undoredo-merge-added-a-layout-shift)'s What happens credits the undo and redo buttons; the shift it measured came from this trigger appearing on hydration, as its Status says. Noticed while fixing T1 (PR #12).
- **Fix:** Give the status text the width of its widest state, or put the chevron before it, and add a layout-shift check after typing to an e2e spec.
- **Evidence:** measured

#### N11 · Low: The revert toast's Undo is a second black button

- **Status:** Open
- **Where:** `src/components/workspace/save-status.tsx` (`offerUndo`); `src/components/motion/providers.tsx` (the `Toaster`)
- **What happens:** The toast after a revert has an Undo action, which sonner draws by default as a filled button in the toast's text color, near black. On the workspace, Submit for review is already the screen's one black button. Noticed while fixing I2 (PR #15).
- **Fix:** Style toast actions as outline buttons through the `Toaster`'s `toastOptions.classNames.actionButton`, set where it is mounted rather than in `src/components/ui/sonner.tsx`.
- **Evidence:** traced

#### N12 · Low: The heatmap legend is hover-only, and HBars color by rank

- **Status:** Open
- **Where:** `src/components/usage/charts.tsx` (`HeatLegend`, `HBars`)
- **What happens:** The heatmap legend's swatches give the range each shade means ("2 to 9 renders in a day") only in a hover tooltip. They're `aria-hidden` and take no focus, so keyboard and screen-reader users never get the ranges. HBars draws the first row in the darkest brand step and the rest in a lighter one, so color encodes rank, which the bars' lengths already show, and reads as a category. Noticed while fixing I13 (PR #24).
- **Fix:** Print the ranges with the legend, or add them as sr-only text, and draw every bar in one color.
- **Evidence:** traced

#### N13 · Low: The Library's status filter is a third selected style

- **Status:** Open
- **Where:** `src/components/library/library-browser.tsx` (the status filter's `ToggleGroupItem`)
- **What happens:** H3 gave the segmented control and the tabs one look each in `src/components/primitives/`. The Library's status filter shows its pressed item a third way: rounded pills with no track, filled `bg-selected` when pressed, with the classes inline. `src/components/primitives/one-copy.test.ts` doesn't look for it. Noticed while fixing H3 (PR #40).
- **Fix:** Use `Segmented` for the filter, or make the pill a primitive if the Library keeps pills on purpose, and record which in [decision 0030](decisions/0030-shared-primitives-have-one-home.md).
- **Evidence:** traced

#### N14 · Low: A chain change repeats a line for a person named on two stages

- **Status:** Open
- **Where:** `src/domain/platform-config.ts` (`describeChainChange`)
- **What happens:** It adds "Dana Park will review Disclosure submissions from every team, including teams they aren't a member of." once per stage that names a new person, so a person newly named on two stages gets the line twice. `validateChain` refuses a person on two stages, and the chain editor shows no lines while Save is blocked, so nobody sees it today; a caller that shows the lines without validating first would. Noticed while fixing D4 (PR #14).
- **Fix:** Add each person's line once.
- **Evidence:** traced

#### N15 · Low: Coral drops a mapping on a rename and dates a sunset in UTC

- **Status:** Open
- **Where:** `src/simulator/mapping.ts` (`suggestMapping`); `src/simulator/ui/format.tsx` (`dayLabel`)
- **What happens:** Two gaps in the simulated consumer. Relinking keeps a field's mapping only under the same key, so after a variable rename the renamed variable starts unmapped, though `/api/v1` reports the rename as one `key_renamed` change ([D8](#d8--medium-variable-renames-are-lost-between-the-panel-and-submit)). And Coral shows a sunset as its instant's date in UTC. A sunset ends at 00:00 in the business time zone ([D6](#d6--medium-a-sunset-date-means-midnight-utc)), and every zone on the list is UTC or behind it, so the date is right today; a zone ahead of UTC would show the day before. Noticed while fixing D8 (PR #32) and D6 (PR #26).
- **Fix:** Carry a mapping across a `key_renamed` change when relinking. Show a sunset's day in the business time zone, which needs `/api/v1` to send the zone or the day beside the instant.
- **Evidence:** traced

#### N16 · Low: Two refusal rules still live outside the domain

- **Status:** Open
- **Where:** `src/components/access/request-access.tsx` (the reason check); `src/server/actions/platform.ts` (`createTeam`); `src/server/queries/platform.ts`
- **What happens:** H2 moved the settings screens' checks into the domain; two rules outside them are still copies. Request access checks the reason itself (empty, then longer than `ACCESS_REASON_MAX`), repeating the ladder of the domain's `requestAccess`, and H2's test covers settings components only. And "an Auditor can't be a team's first Team Admin" is written twice in `src/server`: the `createTeam` action refuses it, and the platform read model leaves Auditors out of the picker. The domain's `createTeam` doesn't know it, so a port would miss it. Noticed while fixing H2 (PR #28).
- **Fix:** Export one domain check for the request's reason and use it in the form and in `requestAccess`; move the Auditor rule into the domain's `createTeam` and have the read model ask it. Both shrink [B2](#b2--high-about-a-third-of-the-business-rules-live-outside-srcdomain).
- **Evidence:** traced

#### N17 · Low: The review actions keep a private copy of draftRow

- **Status:** Open
- **Where:** `src/server/actions/review.ts` (`draftRow`)
- **What happens:** `requestChanges` builds its new draft row with a private copy of `draftRow`, the same as the one `src/server/templates/create.ts` exports and `src/server/actions/templates.ts` uses. A column added to versions has to be added to both, and the server README lists the copy under Don't copy. Noticed while fixing A3 (PR #39).
- **Fix:** Import the shared `draftRow`, delete the copy, and drop its Don't copy entry.
- **Evidence:** traced

#### N18 · Low: readBodyCapped lives in the import folder

- **Status:** Open
- **Where:** `src/server/import/read-body.ts`
- **What happens:** The byte-capped body reader serves three route handlers (import, autosave and the `/api/v1` render route), but it lives under `src/server/import/`, so the other two reach into the import feature for it, and someone looking beside the other HTTP helpers won't find it. Noticed while fixing S6 (PR #20).
- **Fix:** Move it to `src/server/api/`, beside `http.ts`, and update the three routes and the server README.
- **Evidence:** traced

#### N19 · Low: The simulator serves reads as server actions

- **Status:** Open
- **Where:** `src/simulator/actions.ts`; `eslint.config.mjs` (the `"use server"` rule's `ignores`)
- **What happens:** [A6](#a6--medium-reads-are-exposed-as-server-actions) made on-demand reads GET routes and allowed `"use server"` only in `src/server/actions/`, but the simulator's actions file is exempt. Beside its four writes it serves two reads, `searchTemplates` and `getDeliveryView`, so they are public POST endpoints queued with the writes: the pattern A6 removed from Stencil. Noticed while fixing A6 (PR #29).
- **Fix:** Serve the two reads from GET route handlers or server component props, and narrow the exemption to the writes.
- **Evidence:** traced

#### N20 · Low: Five e2e specs fail now and then when runs share a machine

- **Status:** Open
- **Where:** `e2e/comment-policy.spec.ts`; `e2e/scenario-08.spec.ts`; `e2e/demo-script.spec.ts`; `e2e/scenario-02a.spec.ts`; `e2e/focus-targets.spec.ts`
- **What happens:** While several e2e runs shared one machine, each of these failed in some run and passed when run alone: comment-policy (`SQLITE_BUSY` on its own database access), scenario-08 (its Settings link), demo-script at step 8.3, scenario-02a's keyboard-only run, and focus-targets' first test, which typed " (edited)" into the middle of the template name. A gate that fails at random gets rerun until it passes, and a real failure hides among the reruns. Seen in the e2e runs of the Fix first PRs.
- **Fix:** Find what each one races and wait for that with a web-first assertion, retry `SQLITE_BUSY` in the specs' own database access, and check each under load with `--repeat-each`. Relates to [T7](#t7--medium-slow-and-brittle-test-habits) and [T5](#t5--medium-e2e-cant-be-pointed-at-its-own-database).
- **Evidence:** measured

#### N21 · Low: Three decision records have lines later decisions superseded

- **Status:** Open
- **Where:** `docs/decisions/0002-a-passed-sunset-is-final.md`; `docs/decisions/0007-maker-checker-covers-every-writer.md`; `docs/decisions/0025-refusals-carry-stable-codes.md`
- **What happens:** Three accepted records state something a later record changed. [0002](decisions/0002-a-passed-sunset-is-final.md) says five other places still test "sunset passed" themselves; there is one test now, `sunsetPassed` ([decision 0026](decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md)). [0007](decisions/0007-maker-checker-covers-every-writer.md) names the edit transition `editActive`; it is `editLatest` ([decision 0009](decisions/0009-correct-a-revoked-version-from-its-content.md)). [0025](decisions/0025-refusals-carry-stable-codes.md) says `startDraft` throws `planDraftStart`'s blocked reason; it returns it ([decision 0029](decisions/0029-every-action-runs-on-one-kit.md)). Accepted records aren't rewritten, so someone reading one of them alone is misled. They went stale with D7 (PR #36), D1 (PR #16) and A3 (PR #39).
- **Fix:** Under each record's Status, add a line naming the later record and what it changed, and leave the rest as written (or mark it "Superseded by" where the later record replaces it, as the decisions README describes).
- **Evidence:** verified

## Waits for the enterprise work

These findings are real, and several are High, but each one is fixed by building something that's on the way: real sign-in, the Java API or the enterprise font. A fix made in the prototype now would be replaced. They stay Open so that each piece of work starts with them in view, and each table says what that work has to get right.

### Real sign-in (Better Auth with Entra ID, SSO and MFA)

| Finding | What the sign-in work has to get right |
| --- | --- |
| [S2 · High](#s2--high-identity-fails-open-to-the-default-persona) | With no session there is no viewer: routes answer 401 and pages redirect to sign-in, never fall back to a person. Keep the persona switcher only as a dev-only provider behind the same function. |
| [S4 · High](#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep) | Work out each membership's effective status from its recertification and inactivity deadlines when the viewer is loaded, so a lapsed approver is refused on their next request, and run the sweep on a schedule instead of on demo triggers. |
| [S10 · Low](#s10--low-mutating-route-handlers-have-no-origin-check) | Better Auth's origin checks cover its own endpoints, not the app's. Once the cookie is a real session, the autosave and import route handlers check `Origin` or `Sec-Fetch-Site` themselves, and answer unknown and forbidden ids the same way. |

The sign-in work also touches findings filed elsewhere. [A1](#a1--high-the-public-consumer-endpoint-also-serves-cms-previews): keep the session cookie off `/api/v1` by moving CMS preview to a BFF route first. [I12](#i12--medium-every-page-ships-the-whole-template-catalog-and-the-palette-keeps-the-last-personas-data) is fixed: the palette keeps its answers per viewer, as two real people sharing a browser need. [S5](#s5--high-consumer-identity-is-a-self-asserted-header): consumers are systems, not people, so they get client credentials (an Entra ID app registration can issue them), not Better Auth sessions. The app reads the session in one place, the fail-closed request context in step 1 of [the backend seam](#the-backend-seam).

### Demo tools

They leave with the persona switcher.

| Finding | What removing them has to get right |
| --- | --- |
| [S1 · Critical](#s1--critical-demo-reset-and-clock-actions-are-public-and-ungated) | Remove the reset and clock actions and the demo pill, or gate them behind one `DEMO_MODE` flag that production never sets. Either way, `resetDemo()` refuses any database that isn't a local file. |
| [A7 · Medium](#a7--medium-the-http-date-header-carries-the-demo-clock) | The HTTP `Date` header goes back to real time. If a demo mode survives, its clock travels in its own header. |

### The Java API

If the backend moves to the Spring Boot API with this app as its BFF, these findings are the port's work, in the order of [the backend seam](#the-backend-seam). If the backend stays in Next.js, they go back into the ordinary backlog.

| Finding | What the port has to get right |
| --- | --- |
| [A1 · High](#a1--high-the-public-consumer-endpoint-also-serves-cms-previews) | Do it first, before Spring owns `/api/v1`: CMS preview moves to a BFF route that calls the render engine with the session, and `/api/v1` serves consumers only. |
| [S5 · High](#s5--high-consumer-identity-is-a-self-asserted-header) | Consumers authenticate at the gateway with client credentials or mTLS, calls are rate-limited, and unauthenticated calls write no render-log rows. The contract says so. |
| [B1 · High](#b1--high-server-actions-are-the-service-layer) | A request context and service interfaces, with today's code as the local implementation and an HTTP one beside it. Rendering already works this way. |
| [B2 · High](#b2--high-about-a-third-of-the-business-rules-live-outside-srcdomain) | Each rule it lists becomes one domain function. Fix first items that touched these rules ([S7](#s7--medium-comments-are-accepted-on-any-version-state), [D4](#d4--high-the-chain-editor-saves-chains-nobody-can-approve) and [H2](#h2--medium-client-components-re-implement-domain-rules) among them) moved theirs; [N16](#n16--low-two-refusal-rules-still-live-outside-the-domain) lists two that are left. |
| [A5 · Medium](#a5--medium-the-contract-is-typescript-only-and-the-simulator-tests-against-a-fake) | One machine-readable source for `/api/v1` (OpenAPI 3.1 or zod), and the simulator tested against the real handlers instead of a fake. |
| [D10 · Medium](#d10--medium-audit-and-notice-payloads-are-untyped) | A typed payload per audit action and notice; they become the Java DTOs. Migrate the seed's spellings instead of aliasing them. |
| [B3 · Medium](#b3--medium-invariants-rely-on-sqlites-single-writer) | Partial unique indexes or row locks behind the last-admin, one-open-recertification and one-pending-request rules, CHECK constraints on state, status and role, and the missing indexes. SQLite's single writer hides all of these today. |
| [B4 · Medium](#b4--medium-sqlite-workarounds-are-spread-through-the-code) | Retries inside the database client, ordering by ULID or sequence instead of `rowid`, and filtering in SQL. |
| [B5 · Medium](#b5--medium-autosave-conflict-recovery-reads-the-audit-log) | `rev` and the last save session live on the version row, not in the audit log. |
| [A4 · Medium](#a4--medium-get-apiv1-routes-can-return-a-non-json-500) | Every route maps a failure to the contract's error body with a correlation id, as RFC 9457 problem details, together with the route half of [A3](#a3--medium-six-error-shapes-and-some-actions-throw). |
| [A8 · Low](#a8--low-sample-urls-are-built-from-request-headers) | The consumer base URL comes from configuration (`CONSUMER_API_BASE_URL`). |
| [A9 · Low](#a9--low-notifications-store-app-urls) | Notifications store the `NotificationLink` descriptor, and the BFF builds the link when it reads them. |
| [D11 · Low](#d11--low-javascript-only-behavior-that-wont-port-cleanly) | Dates are validated by round trip (`2026-02-30` must fail, not become March 2), ids compare by code point, and lookups go through `Map`. |

### The enterprise font

| Finding | What the font work has to get right |
| --- | --- |
| [R3 · High](#r3--high-the-pdf-drops-characters-its-fonts-dont-have) | The PDF now fails with a clear error on a missing glyph. The enterprise font, with its fallbacks, has to cover every script customer names arrive in: the review's example mixes Vietnamese and Chinese, and today's heading face also lacks Greek and Cyrillic. Write the coverage into `docs/render-spec.md` for the port. |
| [T8 · Medium](#t8--medium-runtime-paths-assume-the-dev-machine) | Fonts load from a path inside the app, not from `node_modules` under the working directory. The finding's other two paths, the uploads folder and the migration script, go with the deployment work in [T4](#t4--high-no-ci-node-pin-or-environment-template). |
| [H5 · Low](#h5--low-rebrand-leftovers-two-of-them-customer-visible) | The "UCOMP Sans" and "UCOMP Serif" family names, which show in PDF metadata, change when the font goes in. The email sender fallback doesn't wait (item 28). |
| [H6 · Low](#h6--low-no-font-size-tokens) | If the font also replaces the UI typeface, add `--text-*` size tokens first, so its metrics are tuned in one place instead of in 382 `text-[Npx]` utilities. |

After the swap, `npm run golden:update` refreshes the Node-only PDF golden files; read the diff before committing it.

## Findings

### Security and access

#### S1 · Critical: Demo reset and clock actions are public and ungated

- **Status:** Deferred. The owner will remove or hide the demo tools before production.
- **Where:** `src/server/actions/demo.ts` line 14; `src/server/reset.ts` line 23
- **What happens:** `resetDemoAction` drops every table, re-seeds and empties the uploads folder. `advanceClockAction` moves the clock up to 3,650 days, runs the access sweep, and every later audit timestamp uses the moved clock. Both are `"use server"` endpoints with no permission or environment check, callable without a cookie. `resetDemo()` also runs against any `DATABASE_URL`, including a remote `libsql://` database.
- **Fix:** One `DEMO_MODE` flag from a validated config module, checked inside each action and in the layout that mounts the demo pill. Make `resetDemo()` refuse non-`file:` URLs.
- **Evidence:** verified

#### S2 · High: Identity fails open to the default persona

- **Status:** Deferred. Replaced when real login lands. Whatever replaces `getViewer()` must refuse, not default to a person.
- **Where:** `src/server/viewer.ts` line 58; `src/app/api/v1/templates/[templateId]/render/route.ts` line 151
- **What happens:** With no cookie or an unknown id, `getViewer()` returns Maya. The public render route uses it for `preview: true`, so an anonymous `POST {version: "draft", preview: true}` renders Coral Offers' unreleased drafts. Whatever replaces the persona cookie will inherit this contract unless it changes now.
- **Fix:** Return no viewer (401 or redirect to sign-in) when there's no identity. Make the persona switcher a dev-only provider behind the same function.
- **Evidence:** verified

#### S3 · High: Maker-checker only stops the submitter, not the author

- **Status:** Fixed. Each version records its writers (`versions.writers`: who started the draft, saved an edit, or submitted it, carried across change requests), and `can()`, `approve` and `requestChanges` refuse all of them ([decision 0007](decisions/0007-maker-checker-covers-every-writer.md)).
- **Where:** `src/domain/permissions.ts` line 84; `src/domain/lifecycle.ts` line 565
- **What happens:** The guard compares the approver with `submittedBy`. Holding Author and Approver on one team is normal (approving an access request adds the role). Maya writes a draft, Priya clicks Submit, and Maya approves her own content. Found independently by two reviewers.
- **Fix:** Decide the rule (anyone who created or edited the version can't decide it), record authors from `versions.createdBy` plus `draft.edited` actors, and guard on that in both `can()` and the transition. Or forbid Author plus Approver on one team.
- **Evidence:** traced

#### S4 · High: Access deadlines only take effect when a demo trigger runs the sweep

- **Status:** Deferred. Belongs to the real-login work: effective status at sign-in plus a scheduled sweep.
- **Where:** `src/server/access-sweep.ts` line 144; `src/server/actions/persona.ts` line 39
- **What happens:** Recertification lapses and inactivity suspensions are applied by `runAccessSweep`, which runs on persona switch, Advance clock and access actions only. With real sign-in and real time, a lapsed approver keeps editing and approving until someone happens to run an access action. Each sweep also loads every membership and user.
- **Fix:** A scheduled job (Spring `@Scheduled` or a cron route), plus computing effective membership status from the deadlines when the viewer is loaded.
- **Evidence:** traced

#### S5 · High: Consumer identity is a self-asserted header

- **Status:** Open
- **Where:** `src/server/queries/consumer-api.ts` line 62; `src/app/api/v1/consumers/[consumerId]/notices/route.ts` line 27
- **What happens:** `X-Consumer-Id` has no secret. The notices check (header must equal the path) looks like authorization, but the caller sets both. Every anonymous render of an existing template writes a `render_log` row through the process-wide write lock, so flooding the endpoint makes autosaves and approvals wait up to 15 seconds and then fail. None of this is documented as a prototype limit.
- **Fix:** Client credentials (OAuth client-credentials or mTLS) at the gateway or BFF, rate limits, and no log rows for unauthenticated callers. State it in the contract.
- **Evidence:** traced

#### S6 · Medium: Body size limits trust the declared Content-Length

- **Status:** Fixed. Both routes read the body with `readBodyCapped` and answer 413 past the cap, chunked or not; autosave checks access from the version id before reading a byte; and each render value is at most 1,000 characters in validation and the published schema ([decision 0011](decisions/0011-cap-each-render-value.md)).
- **Where:** `src/app/api/drafts/[versionId]/route.ts` line 18; `src/app/api/v1/templates/[templateId]/render/route.ts` line 127
- **What happens:** Both routes compare the `Content-Length` header, then call `request.text()`. A chunked body has no length, so the whole body is buffered. The autosave route reads the body before any permission check and never checks the size after reading; the render route is anonymous. Render values have no length cap either: one 100,000-word value costs about a second of main-thread CPU in the PDF.
- **Fix:** Reuse `readBodyCapped` from `src/server/import/read-body.ts`, authorize before reading, and add a `maxLength` per value in validation and the schema.
- **Evidence:** verified

#### S7 · Medium: Comments are accepted on any version state

- **Status:** Fixed. The comment policy is `src/domain/comments.ts`; the actions ask it again inside their transaction, so a comment, reply, resolve or reopen where no draft or version in review shows the thread is refused and writes nothing, and the review and workspace read models return `can.comment` decided.
- **Where:** `src/server/actions/comments.ts` line 75; `src/components/comments/thread-state.ts` line 109
- **What happens:** Only drafts and versions in review take comments, but that rule lives in `versionTakesComments` on the client. `addComment`, `reply` and `resolveThread` check permission only, so a direct call comments on an Active or Superseded version. The whole comment policy (length, block must exist, recipients) sits in the action with no `domain/comments.ts`.
- **Fix:** A domain comment policy enforced in the actions, with the read model returning `can.comment`.
- **Evidence:** traced

#### S8 · Medium: Design mocks and labs ship in production builds

- **Status:** Open
- **Where:** `src/app/(dev)`
- **What happens:** `/design/*`, `/editor-lab` and `/pdf-lab` have no production gate and are prerendered by `next build`. About 16.3k lines, roughly a fifth of non-test source, including a second stand-in renderer (`design/preview/render-doc.tsx`) that behaves differently from the real one.
- **Fix:** Delete the variant mocks (their decisions are in the product now) or move them to a tag. Gate the labs with `notFound()` when `NODE_ENV === "production"`.
- **Evidence:** verified

#### S9 · Low: Cross-team stage reviewers can act on any thread of the template

- **Status:** Fixed. A user the waiting stage names counts only for the version in review and the threads its screen shows (`canActOnThread` in `src/domain/comments.ts`); a thread begun in the draft is refused to them like a missing one.
- **Where:** `src/server/actions/comments.ts` line 271
- **What happens:** `reply`, `resolveThread` and `reopenThread` accept a named stage reviewer for any thread on the template while any version is in review, including draft-only threads they can't see.
- **Fix:** Scope the check to threads on the version in review.
- **Evidence:** traced

#### S10 · Low: Mutating route handlers have no Origin check

- **Status:** Open
- **Where:** `src/app/api/drafts/[versionId]/route.ts` line 15
- **What happens:** Server actions get an Origin check from Next.js; the autosave `PUT` and import `POST` rely on the cookie being SameSite=Lax. The drafts route also answers `not_found` before `forbidden`, which reveals whether a version id exists on another team.
- **Fix:** Check `Origin` or `Sec-Fetch-Site` in the BFF route handlers; answer the same way for unknown and forbidden.
- **Evidence:** traced

### Domain rules

#### D1 · High: Revoking the live version freezes the template for good

- **Status:** Fixed. When the latest version is Revoked, Edit starts the corrected draft from its content, and contract changes compare with the newest version that still renders (`contractBaseline`), or none when nothing does ([decision 0009](decisions/0009-correct-a-revoked-version-from-its-content.md)).
- **Where:** `src/domain/lifecycle.ts` line 198; `src/domain/lifecycle.test.ts` line 203
- **What happens:** Revoke is allowed on the Active version, the emergency case for wrong legal text. Afterwards `planDraftStart` finds the latest version revoked and refuses with "Only an Active template can be edited." Nobody can make the corrected draft. A test asserts this behavior; the demo only revokes Superseded versions, so it never shows.
- **Fix:** Product call needed: allow a new draft from the revoked or latest released content, using the newest version that still renders as the contract baseline. Update the test.
- **Evidence:** verified

#### D2 · High: Setting a new sunset brings a sunset version back to life

- **Status:** Fixed. `setSunset` refuses once the current sunset has passed (the new domain predicate `sunsetPassed`), and the Versions screen shows Change sunset disabled with the reason ([decision 0002](decisions/0002-a-passed-sunset-is-final.md)); the `sunset_passed` audit transition and the other copies of the test stay with D7.
- **Where:** `src/domain/lifecycle.ts` line 723
- **What happens:** `setSunset` checks only that the version is Superseded and the new date is after today. It never checks that the old sunset already passed. v1 sunset October 1 stops rendering; setting December 1 makes it render again. The Versions screen offers this.
- **Fix:** Refuse when the current `sunsetAt` is in the past, and add the `sunsetPassed` transition the plan lists (see D7).
- **Evidence:** verified

#### D3 · High: Editing the approval chain mid-review stalls or skips stages

- **Status:** Fixed. A version records its stages (ids and names) at submit and goes through them whatever the chain becomes, reading each stage's rule live by id; decisions record the stage id and the stepper matches by it; whoever approved any stage of the version still can't approve another; and a stage an in-review version still needs can't be removed ([decision 0015](decisions/0015-a-version-keeps-the-stages-it-was-submitted-with.md)).
- **Where:** `src/domain/platform-config.ts` line 486; `src/domain/approval-chain.ts` line 68
- **What happens:** Chain [Legal (Dana), Team]: Dana approves Legal, the chain is reordered to [Team, Legal], Jordan approves Team, the version waits on Legal again and Dana is refused as having approved an earlier stage. It's stuck for good. Adding a stage before the current one lets waiting versions skip it. The stepper reads past decisions against today's chain by position, so Jordan's old approval shows as "Legal: done by Jordan". `versions.current_stage` is a position, not a stage id.
- **Fix:** Snapshot the chain (stage ids and names) on each version at submit and match decisions by stage id.
- **Evidence:** reproduced

#### D4 · High: The chain editor saves chains nobody can approve

- **Status:** Fixed. One domain `validateChain` refuses a person on two stages, any role but Approver, an Auditor and anyone without an active team role for every named person on every save, and an admin naming themselves on a stage that didn't already name them; `saveApprovalChain` and the chain editor both run it, and the editor shows each reason at its stage with Save disabled ([decision 0008](decisions/0008-a-chain-must-be-approvable.md)).
- **Where:** `src/domain/platform-config.ts` line 437; `src/server/actions/platform.ts` line 262
- **What happens:** Naming the same person on two stages only adds a warning line; the save succeeds and every submission stalls. A `team_role` stage may name viewer, author or team_admin, none of which can decide. The rules against naming yourself, an Auditor or someone without access exist only in the server action.
- **Fix:** A domain `validateChain` that refuses all of these; allow only `team_role: "approver"`.
- **Evidence:** reproduced

#### D5 · High: Money and rates go through JavaScript doubles with unstated rounding

- **Status:** Fixed. PR #6: values stay exact decimal strings end to end; see `src/editor/model/variables.ts` and its example table.
- **Where:** `src/editor/model/variables.ts` line 96
- **What happens:** `"1000000000000000000000"` becomes `1e+21` in the customer document, with no dollar sign, while the published schema allows 308 digits; `"0.0000001"` becomes `1e-7`. `"12345678901234567.89"` silently becomes `12345678901234568`. Rounding is Intl's half-expand (`0.125` prints `$0.13`), while Java's `NumberFormat` defaults to half-even (`$0.12`), so a port would print different disclosure figures. Found by two reviewers.
- **Fix:** Keep canonical values as decimal strings end to end (BigDecimal in Java), cap integer digits and decimal places, and state the rounding mode in the domain.
- **Evidence:** reproduced

#### D6 · Medium: A sunset date means midnight UTC

- **Status:** Fixed. A sunset date now ends at 00:00 on that day in a Platform business time zone (`America/New_York` by default, Settings > Platform > Time zone), with the rule in `src/domain/business-zone.ts`, existing sunsets migrated, and the picker naming the zone ([decision 0017](decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)).
- **Where:** `src/domain/lifecycle.ts` line 933; `src/domain/render/version-rules.ts` line 31
- **What happens:** "Sunset on March 1" stops renders at 7 PM Eastern on February 28. The port needs an explicit rule.
- **Fix:** Store a calendar date plus a business time zone, or an instant chosen in the UI, and document which.
- **Evidence:** traced

#### D7 · Medium: Nothing records when a sunset passes

- **Status:** Fixed. `sunsetPassed` is the one test of a passed sunset everywhere, and a sweep (`sweepSunsets`, `runSunsetSweep`) writes one `version.sunset_passed` audit row per passed sunset, dated at the sunset and naming its day in the business time zone, and in the same transaction one `sunset_passed` notice to each of the template's consumers, with the instant, the day and zone, and the Active version to move to, on Advance clock, a persona switch and access actions; its scheduled trigger comes with [S4](#s4--high-access-deadlines-only-take-effect-when-a-demo-trigger-runs-the-sweep) ([decision 0026](decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md), [decision 0032](decisions/0032-consumers-are-told-when-a-sunset-passes.md)).
- **Where:** `src/domain/lifecycle.ts` line 712
- **What happens:** The build plan's audit list includes "sunset set or passed" and the implementation plan lists a `sunsetPassed` transition. Neither exists, so the audit never shows when a version stopped rendering. The "sunset passed" test is also written out four times (`usage.ts`, `versions.ts`, `consumer-api.ts`, `version-rules.ts`).
- **Fix:** One domain predicate and a sweep, like `sweepAccess`, that writes `version.sunset_passed`.
- **Evidence:** traced

#### D8 · Medium: Variable renames are lost between the panel and submit

- **Status:** Fixed. A variable keeps its identity across key renames as an optional `id` saved with the variable list, so submit stores a rename as one `key_renamed` (old and new key) that the review screen, the submit dialog, consumer notices and the `/api/v1` diffs show, and `ContractChange` and `ApiContractChange` are unions with one member per kind ([decision 0022](decisions/0022-a-variable-keeps-its-identity-across-renames.md)).
- **Where:** `src/domain/lifecycle.ts` line 297; `src/components/submit/contract-lines.ts` line 34
- **What happens:** The variables panel diffs with renames; submit, review and notices don't, so a rename is stored as removed plus added and `key_renamed` is never saved. `ContractChange` is one type with optional fields rather than a union per kind, which is why callers need `?? change.key` fallbacks.
- **Fix:** A discriminated union per change kind, and keep rename information through submit.
- **Evidence:** traced

#### D9 · Medium: "Today" and "yesterday" disagree between screens

- **Status:** Fixed. Every screen counts days with `daysBetween` and words them with `formatAgo` in `src/domain/dates.ts`: calendar days in UTC, the days the dates on screen show (a sunset's in the business time zone), so 23:00 yesterday is "yesterday" at 01:00 everywhere, and a cross-screen test holds the dialogs, Usage, Versions, Activity, the review queue and Team settings to it ([decision 0028](decisions/0028-today-and-yesterday-are-utc-calendar-days.md)).
- **Where:** `src/domain/consequences.ts` line 129
- **What happens:** `ago()` counts 24-hour periods, so a render at 23:00 yesterday reads "today" at 01:00. The Usage table and `server/queries/format.ts` count calendar days. `DAY_MS` is redefined in more than ten files.
- **Fix:** One day-counting helper in `domain/dates.ts`.
- **Evidence:** reproduced

#### D10 · Medium: Audit and notice payloads are untyped

- **Status:** Open
- **Where:** `src/domain/review-types.ts` line 52; `src/domain/audit.ts` line 140
- **What happens:** `details: Record`. The sentence builders guess which fields exist, notices read two payload shapes (the seed's and live rows'), and audit aliases exist only to cover the seed's spellings.
- **Fix:** A typed payload per action, and migrate the seed instead of aliasing it.
- **Evidence:** traced

#### D11 · Low: JavaScript-only behavior that won't port cleanly

- **Status:** Partly fixed. us_state lookups use `Object.hasOwn` (PR #6). `parseInstant` is gone with the notices `since` parameter, and the consumer API's search compares names and ids by code point (`compareCodePoints` in `src/domain/golive/cursor.ts`, PR #10). `localeCompare` ordering elsewhere (the read models' sorts, `domain/golive/usage.ts`, `domain/consequences.ts`) and `canonicalAction` remain. The contract matcher reports a new variable on a renamed variable's old key as an addition beside the rename (D8).
- **Where:** `src/domain/audit.ts` line 93; `src/domain/golive/api-errors.ts` line 61
- **What happens:** A plain-object lookup with untrusted keys (`canonicalAction("toString")` returns a function). `parseInstant("2026-02-30")` rolls over to March 2. `localeCompare` orders ids and names (ICU collation, unlike Java's `compareTo`). If a key is renamed and a new variable reuses the old key, the diff reports only the rename.
- **Fix:** Use `Map` or `Object.hasOwn`; validate dates by round-trip; compare ids by code point; fix the contract matcher.
- **Evidence:** reproduced

### Editing, autosave and UI correctness

#### I1 · High: Renaming a draft outside the Content tab is never saved, but shows "Saved"

- **Status:** Fixed. The workspace header, on every tab, binds the autosave session to the draft it shows (`getWorkspaceHeader` returns its id and `rev`); the Content page binds the same draft, which is one session ([decision 0020](decisions/0020-autosave-never-drops-edits-silently.md)).
- **Where:** `src/components/workspace/name-field.tsx` line 103; `src/components/workspace/session/session-store.ts` line 329; `src/components/workspace/content/content-workspace.tsx` line 119
- **What happens:** The name field sits in the header on every tab, but only the Content tab binds the autosave session. Reload or deep-link into Versions, Usage or Activity, rename the template, and the change is parked in `held`; `flush()` resolves at once and the status stays "Saved". Leaving the template discards it.
- **Fix:** Bind the session from the template layout (the header query already knows the draft), or make the name read-only until a draft is bound.
- **Evidence:** verified

#### I2 · High: The revert toast's Undo overwrites edits made after the revert

- **Status:** Fixed. The session counts edits, `restore` refuses once anything was edited since the revert or a field it would put back is off screen, and the toast goes at that moment ([decision 0005](decisions/0005-revert-undo-goes-when-anything-changes.md)).
- **Where:** `src/components/workspace/save-status.tsx` line 171; `src/components/workspace/session/session-store.ts` line 369
- **What happens:** Undo stays live for the toast's lifetime and `restore(previous)` applies the pre-revert values unconditionally. Revert, type a paragraph, click Undo: the paragraph is gone, and the remount already wiped the editor's history. If the author switched tabs first, `restore` sends content the hidden editor doesn't show, and the next keystroke saves the reverted content over it. New in the undo/redo merge.
- **Fix:** Track a save generation and make `restore` refuse (and dismiss the toast) when anything was edited since, or when not every field is on screen.
- **Evidence:** verified

#### I3 · High: Renaming a variable with Email off orphans its chips in the subject

- **Status:** Fixed. With Email off the Email details fields stay mounted, hidden (`InlineVariableField` takes `hidden`; the root still counts them and sends renames and deletes to them, but insert, undo and redo pass them by), so the subject follows a rename and saves it ([decision 0004](decisions/0004-email-fields-hidden-not-unmounted.md)).
- **Where:** `src/editor/state/editor-root.ts` line 317; `src/components/workspace/content/email-details.tsx` line 48
- **What happens:** With Email off, the subject and preheader fields unmount, so a rename doesn't reach them. Turn Email back on: the subject shows an unknown chip, the saved subject keeps the old key, and Submit fails with "Define or remove {{first_name}}". The hidden chips aren't counted either, so the variable can be deleted as unused without the confirm dialog.
- **Fix:** Keep the fields mounted but hidden, or apply the root's rename forwards and tombstones when a field mounts.
- **Evidence:** reproduced

#### I4 · High: A panel drop followed by a block move orphans comment threads

- **Status:** Fixed. The panel drop is handled in `handleDOMEvents.drop` by a plugin ordered ahead of UniqueID's, so UniqueID never marks it and the next block moved by its grip keeps its id (and its threads).
- **Where:** `src/editor/extensions/field-binding.ts` line 90
- **What happens:** Dropping a variable row from the panel sets UniqueID's private paste flag, and the custom drop handler consumes the event before the flag is reset. The next drag-handle move strips the moved block's ids. Threads anchored to it fall to "On removed content" and the redline sees a delete plus an insert.
- **Fix:** Handle the panel drop in `handleDOMEvents.drop` ahead of UniqueID, or add a `text/plain` payload so the flag is consumed. Add a regression test.
- **Evidence:** reproduced

#### I5 · High: A draft rename goes live without review

- **Status:** Fixed. The name is a version field (`versions.name`; `templates.name` is gone), so a rename changes only the draft, shows in the submit dialog, the review rail and Compare, and reaches the render titles, the API and notices only when its version goes live ([decision 0016](decisions/0016-the-name-is-versioned.md)).
- **Where:** `src/server/drafts/apply-patch.ts` line 165; `src/server/render/channels/web.ts` line 79
- **What happens:** Autosave writes `templates.name` directly. The name isn't versioned, so the Active version's web ``, PDF title metadata, API `name` and notice payloads change the moment an author types. The RenderDoc documents the name as internal-only, yet browsers show both titles to customers.
- **Fix:** Make the name a version field, and give customer output its own title (the first heading or a dedicated field).
- **Evidence:** verified

#### I6 · Medium: After a save conflict the editor stays editable but nothing saves

- **Status:** Fixed. A stopped save holds the workspace inert (`makeInert`) for as long as that draft is bound, and the header says plainly that the latest changes can't be saved, with a Reload button ([decision 0020](decisions/0020-autosave-never-drops-edits-silently.md)).
- **Where:** `src/components/workspace/autosave/autosave-scheduler.ts` line 194
- **What happens:** After `conflict`, `forbidden` or `not_draft`, the scheduler stops for good and drops every later edit. The only signal is a muted "Reload to continue", and reloading loses what was typed since. Found by two reviewers.
- **Fix:** Switch the editor to read-only when saving stops and offer Reload in the page.
- **Evidence:** traced

#### I7 · Medium: No error boundaries anywhere

- **Status:** Fixed. `(product)/error.tsx`, `templates/[templateId]/error.tsx` and `global-error.tsx` show one plain sentence, Try again (Next's `retry`), Back to library and the error's digest, keeping the app frame, and on a failed tab the workspace header and tab bar ([decision 0013](decisions/0013-errors-are-caught-per-route-not-per-stream.md)).
- **Where:** `src/app/(product)`
- **What happens:** There is no `error.tsx` or `global-error.tsx`. Any error thrown inside a streamed section, or a backend outage, replaces the whole app with Next's default error page.
- **Fix:** Add `(product)/error.tsx`, `templates/[templateId]/error.tsx` and `global-error.tsx`.
- **Evidence:** traced

#### I8 · Medium: Submit can freeze content the dialog didn't list

- **Status:** Fixed. Submit is a compare-and-set on the `rev` its summary read (a stale summary is refused and the dialog offers Refresh summary), and the workspace is read-only from the click until the dialog closes without submitting ([decision 0012](decisions/0012-submit-freezes-only-what-it-showed.md)).
- **Where:** `src/components/workspace/workspace-actions.tsx` line 110; `src/server/actions/review.ts` line 249
- **What happens:** The editor stays editable while Submit flushes and fetches the summary, and `submitVersion` sends no rev, so saves that land in between are frozen unseen. Keystrokes still debouncing go out after the host unmounts and fail silently with `not_draft`. Likely, not reproduced.
- **Fix:** Put `rev` in the summary and make submit a compare-and-set; make the document inert from the moment Submit is clicked.
- **Evidence:** traced

#### I9 · Medium: "Revert to vN" has no error handling or pending guard

- **Status:** Fixed. It runs in a transition through `runAction` with the draft's version id, keeps the menu open with its items greyed out while it loads, and shows a failure in a toast.
- **Where:** `src/components/workspace/save-status.tsx` line 174
- **What happens:** A failed `getBaseVersion` call is an unhandled rejection with no feedback, and a double activation stacks two replaces and two Undo toasts. `getBaseVersion` also returns the base of whichever draft the template has, not the one on screen.
- **Fix:** Use the transition plus `runAction` pattern, disable the item while pending, and pass the version id.
- **Evidence:** verified

#### I10 · Medium: Large drafts can lose the last edits on tab close

- **Status:** Fixed. While anything typed isn't saved, closing or reloading the page asks first (`beforeunload`) and sends what is pending as it asks; once everything is saved the guard is gone ([decision 0020](decisions/0020-autosave-never-drops-edits-silently.md)).
- **Where:** `src/components/workspace/autosave/save-transport.ts` line 13
- **What happens:** Bodies over 60 KB aren't sent with `keepalive` on pagehide, and there is no `beforeunload` guard. Long disclosures pass 60 KB easily because every block carries a UUID.
- **Fix:** A `beforeunload` prompt while the status isn't saved, or send diffs.
- **Evidence:** traced

#### I11 · Medium: The UI branches on exact English sentences

- **Status:** Fixed. Every refusal is `{ ok: false, code, reason }`: each table entry in `src/domain` carries a stable snake_case code (`RefusalCode`, unique across tables, checked by `refusals.test.ts`), read models and action results pass it through, and the three screens branch on `generic`, `own_revoke` and `summary_stale` instead of the sentence ([decision 0025](decisions/0025-refusals-carry-stable-codes.md)).
- **Where:** `src/components/review/decision-model.ts` line 42; `src/components/versions/version-actions.tsx` line 157
- **What happens:** `reason === REASONS.generic` decides hidden versus blocked, and `reason === REASONS.ownRevoke` decides whether Confirm revoke shows. A copy edit, or a Spring backend wording things differently, silently changes behavior.
- **Fix:** Give every permission result a stable `code` and branch on it.
- **Evidence:** traced

#### I12 · Medium: Every page ships the whole template catalog, and the palette keeps the last persona's data

- **Status:** Fixed. No page carries templates any more: the palette asks `GET /api/palette/[space]?q=&template=` when it opens and as the viewer types, the server searches with one domain rule (`src/domain/palette.ts`), and the palette's answers are keyed by viewer, with a new palette mounted on a persona switch ([decision 0024](decisions/0024-the-palette-searches-on-the-server.md)).
- **Where:** `src/components/app-shell/top-bar-hole.tsx` line 12; `src/components/app-shell/command-palette.tsx` line 168
- **What happens:** The top bar loads every visible template and its versions into the RSC payload on every page and every `refresh()`, then the palette fetches the same catalog again. Its per-space cache isn't cleared on persona change and wins over fresh props until a refetch succeeds.
- **Fix:** Search server-side on open, and key the cache by viewer.
- **Evidence:** traced

#### I13 · Medium: Blocked decisions and charts aren't accessible

- **Status:** Fixed. Blocked Approve and Request changes (rail and stacked bar) are the new `BlockedButton` primitive, greyed but focusable with the reason as tooltip and description; every chart with unprinted values has an sr-only table, its marks are one Tab stop with arrow keys and tooltips on focus, and series use four validated hues ([decision 0014](decisions/0014-chart-values-never-hover-only.md)).
- **Where:** `src/components/review/decision-rail.tsx` line 152; `src/components/usage/charts.tsx` line 332
- **What happens:** Blocked Approve and Request changes use native `disabled`, so the reason can't be reached by keyboard, against the repo's own `aria-disabled` convention. Stacked bars and the rate line expose only a short label; series differ by lightness of one hue; values are hover-only.
- **Fix:** `focusableWhenDisabled` as elsewhere; `sr-only` tables for every chart, like the heatmap has.
- **Evidence:** traced

#### I14 · Low: Every ⌘B in the editor also toggles the hidden sidebar

- **Status:** Fixed. The listener is removed from `src/components/ui/sidebar.tsx`, the edit is noted in the components README, and `ui/sidebar.test.tsx` fails if a `shadcn add` brings it back.
- **Where:** `src/components/ui/sidebar.tsx` line 97
- **What happens:** The stock shadcn provider registers a window-level ⌘B listener that ignores `defaultPrevented`. Bold also toggles sidebar state and writes the `sidebar_state` cookie; the sidebar is `collapsible="none"`, so nothing visible happens.
- **Fix:** Remove the listener (this is a deliberate edit to a generated file; note it).
- **Evidence:** verified

#### I15 · Low: Focus and Esc handling is wired through DOM queries

- **Status:** Fixed. The name field, the status row, the Preview toggle and the rail's Original tabs register with the workspace session (`session.focusTargets`), and callers ask it or wait for a registration instead of querying labels or polling frames ([decision 0027](decisions/0027-focus-targets-register-with-the-session.md)).
- **Where:** `src/components/workspace/workspace-actions.tsx` line 59
- **What happens:** rAF polling for up to 3 seconds, `textarea[aria-label="Template name"]`, a tab found by its text "Original". Renaming a label breaks Esc handling.
- **Fix:** Register focus targets as refs on the workspace session.
- **Evidence:** traced

### Rendering and import

#### R9 · Critical: One soft hyphen made later PDFs drop every hyphen and minus sign

- **Status:** Fixed. PR #6, with a fresh-process regression test (`src/server/render/channels/pdf-fonts.test.ts`) and the cross-process determinism test in PR #7.
- **Where:** `src/server/render/channels/pdf-fonts.ts`
- **What happens:** The font library cached each glyph under the first character that looked it up, for the life of the process. Liberation Sans draws U+002D and the soft hyphen U+00AD with one glyph, so after one document with a soft hyphen, every later PDF dropped "-": `-$1,234.50` printed `$1,234.50` and phone numbers lost their hyphens. Reproduced on main before PR #6.
- **Fix:** Fill each font's glyph cache in code point order right after loading, and remove soft hyphens before layout.
- **Evidence:** reproduced

#### R1 · High: A table span or list number can hang or crash the server during PDF render

- **Status:** Fixed. PR #6: the document check refuses bad spans, starts, depth and columns at save, import and render, and the PDF adapter bounds them defensively.
- **Where:** `src/server/render/channels/pdf.tsx` line 366; `src/server/render/channels/pdf.tsx` line 285; `src/domain/render/resolve.ts` line 157
- **What happens:** Numeric attributes are checked for shape, never for size. `grid()` loops once per unit of `colspan`: 1e8 takes about half a second and 1e14 would run for days, blocking the event loop. `roman()` appends one character per thousand, so an ordered list with `start: 1e11` at the third level exhausts the heap and aborts the process, which no `catch` stops. A .docx with `` imports as exactly that colspan, and the autosave route accepts it too.
- **Fix:** Clamp in `resolve.ts` as part of the RenderDoc contract (colspan and rowspan 1 to about 63, start 1 to about 9999), validate the same bounds at save and import, fall back to decimals past 3999, and run PDF rendering in a worker with resource limits and a timeout, as `src/server/import/isolate.ts` already does.
- **Evidence:** verified

#### R2 · High: Rates and amounts are silently rounded to two decimals

- **Status:** Fixed. PR #6: digits print exactly as sent; only the symbol and grouping commas are added.
- **Where:** `src/editor/model/variables.ts` line 118
- **What happens:** A percent of `6.875` prints `6.88%`, `39.995` dollars prints `$40.00`, and a number `0.125` prints `0.13`. Rates quoted in eighths are routine for mortgages and HELOCs, so the disclosure shows a different rate than the one sent, with no error. The published JSON Schema accepts any number of decimals.
- **Fix:** Refuse values with more decimals than the type allows (currency 2, percent up to 3, or a per-variable precision) and format from the decimal string. Write the rule down for the Java port (see D5).
- **Evidence:** verified

#### R3 · High: The PDF drops characters its fonts don't have

- **Status:** Partly fixed. PR #6: the PDF now fails with a clear error naming the characters instead of printing boxes. The real fix is the enterprise font.
- **Where:** `src/server/render/channels/pdf-fonts.ts` line 47
- **What happens:** A value of `Nguyễn Thị 王小明` extracts from the PDF as `Nguy\0n Th\0 \0\0\0`, printed as empty boxes; the web output is correct and nothing reports an error. Liberation Sans lacks Vietnamese letters, and Newsreader (used for section headings) lacks Greek and Cyrillic.
- **Fix:** Embed Noto Sans with Vietnamese coverage and fallback fonts, or detect missing glyphs and fail the render. Specify font coverage for the port.
- **Evidence:** reproduced

#### R10 · High: Leading no-break spaces lost their indent, depending on render order

- **Status:** Fixed. PR #6.
- **Where:** `src/server/render/channels/pdf-text.ts`
- **What happens:** Space and no-break space share a glyph, and only U+0020 counted as a leading space. Depending on which a process looked up first, leading no-break spaces lost their indent or later documents' spaces were indented twice. Invisible format characters also failed the render.
- **Fix:** The same cache priming, every kind of space handled as a space, and invisible characters removed at save and at resolve.
- **Evidence:** reproduced

#### R4 · Medium: PDF render time doubles with each level of list nesting

- **Status:** Fixed. PR #6: nested lists are sized explicitly; 12 levels render in about 12 ms, and nesting is capped at 9.
- **Where:** `src/server/render/channels/pdf.tsx` line 1
- **What happens:** About 2.2 times per level: depth 10 takes 125 ms, depth 14 takes 2.9 s, and depth 30 hadn't finished after 9 minutes. The autosave route allows node depth 40 (about 19 list levels), and the preview re-renders after every save, all on the main thread.
- **Fix:** Cap list nesting (for example at 6) in the schema or at save, plus the worker isolation in R1.
- **Evidence:** reproduced

#### R5 · Medium: Tables with 34 or more columns fail in the PDF only

- **Status:** Fixed. PR #6: tables are capped at 12 columns and narrow cells no longer crash.
- **Where:** `src/server/render/channels/pdf-text.ts` line 226; `src/server/render/channels/pdf.tsx` line 417
- **What happens:** Cell width reaches zero, `cutWord` reads past its array, and the render returns a 500 `render_failed`. Web and email render the same table.
- **Fix:** A minimum column width or a guard for `limit <= 0`, and refuse such tables at submit with a clear message.
- **Evidence:** reproduced

#### R6 · Medium: Channels disagree on numbering, blank lines and links

- **Status:** Fixed. PR #6: markers, blank lines and links follow one rule set in the RenderDoc; PR #7's golden files and parity test enforce it.
- **Where:** `src/server/render/channels/html.ts` line 141; `src/domain/render/resolve.ts` line 250; `src/editor/styles.css` line 192
- **What happens:** Nested ordered lists number four ways: letters in the editor, letters then roman numerals in the PDF, plain decimals in web and email HTML and in plain text, so "see 2(b)" breaks. Blank paragraphs are dropped in web and email but printed in the PDF. The resolver and the HTML adapter apply different link rules, so `https://x.com/a b` is a link in the PDF and plain text elsewhere.
- **Fix:** Decide each rule once in the RenderDoc: marker styles, one `safeHref`, one blank-paragraph rule. Then build golden files per channel that both implementations run.
- **Evidence:** traced

#### R7 · Low: PDF output isn't deterministic

- **Status:** Fixed. PR #6: creation and modification dates come from the render time; PR #7 checks byte-identical output across fresh processes.
- **Where:** `src/server/render/channels/pdf.tsx` line 45
- **What happens:** The document `/ID` and creation date come from the wall clock, so byte-for-byte golden files are impossible and the demo clock is ignored.
- **Fix:** Pass a fixed id and the render time from the clock.
- **Evidence:** reproduced

#### R8 · Low: Paste and import cleanup is skipped if a document mentions "data-pm-slice"

- **Status:** Fixed. `normalizePastedHtml` parses first and passes HTML through untouched only when an element carries `data-pm-slice`, as ProseMirror's own paste checks, so text that mentions it is cleaned.
- **Where:** `src/editor/paste/normalize-html.ts` line 22
- **What happens:** The normalizer checks for the substring anywhere in the HTML, including plain text. The schema parser still sanitizes markup, but `colspan` and `start` come through raw.
- **Fix:** Check for the attribute on an element.
- **Evidence:** reproduced

### API and contract

#### A1 · High: The public consumer endpoint also serves CMS previews

- **Status:** Open
- **Where:** `src/app/api/v1/templates/[templateId]/render/route.ts` line 137; `src/components/preview/render-preview.ts` line 49
- **What happens:** `POST /api/v1/.../render` accepts both `X-Consumer-Id` and the browser's persona cookie, plus `version: "draft"`. Two auth models share one public URL; once Spring owns `/api/v1`, previews either break or Spring must accept browser cookies.
- **Fix:** A BFF-internal preview route that calls the render service with the session. Keep `/api/v1` consumer-only.
- **Evidence:** verified

#### A2 · High: Consumers polling notices can silently miss a revoke

- **Status:** Fixed. Notices now page oldest first in commit order (`consumer_notices.seq`, never reused; the cursor carries a reset epoch) with an opaque `after` cursor, `nextCursor` and `hasMore`, `since` is gone, and search pages the same way ([decision 0006](decisions/0006-page-notices-by-commit-order.md)).
- **Where:** `src/server/queries/consumer-api.ts` line 264; `src/contracts/api-v1.ts` line 211
- **What happens:** Notices come newest-first with `since` and `limit` and no cursor or `hasMore`. A consumer polling with `since=lastSeen` that has more than `limit` new notices loses the oldest, which could be a revoke. Search is capped at 50 with no paging.
- **Fix:** Oldest-first opaque cursor (`after`), `nextCursor` and `hasMore`; paging for search.
- **Evidence:** traced

#### A3 · Medium: Six error shapes, and some actions throw

- **Status:** Partly fixed. Every server action but the demo tools now runs on one kit and returns `ActionResult` with a code, so Edit and New template (`startDraft`, `createTemplate`) show the domain's refusal instead of throwing, and the ⌘K palette answers through `readResponse` like the other reads (I12); still to do are the autosave route's `DraftSaveResponse` (`error`, `message`), import's own codes, the audit export's plain-text errors, and `/api/v1` problem details, which wait for the Java API ([decision 0029](decisions/0029-every-action-runs-on-one-kit.md)).
- **Where:** `src/server/actions/templates.ts` line 57
- **What happens:** `/api/v1` uses `{error: {code, message, details}}`; drafts, imports and palette each have their own; audit export returns text. `startDraft` and `createTemplate` throw, so in production the user sees a generic message instead of the domain's sentence.
- **Fix:** One result kit for actions and RFC 9457 problem details for routes.
- **Evidence:** traced

#### A4 · Medium: GET /api/v1 routes can return a non-JSON 500

- **Status:** Open
- **Where:** `src/app/api/v1/templates/route.ts` line 14
- **What happens:** Only the render route catches errors. A database failure on search or metadata returns Next's HTML error, though the contract promises `ApiErrorBody`.
- **Fix:** A shared handler wrapper that maps every failure to the contract's error body with a correlation id.
- **Evidence:** traced

#### A5 · Medium: The contract is TypeScript only, and the simulator tests against a fake

- **Status:** Partly fixed. Rendering has a full spec (`docs/render-spec.md`) and golden files for a Java port (PR #6, #7). The rest of `/api/v1` still has no OpenAPI or JSON Schema.
- **Where:** `src/contracts/api-v1.ts` line 1; `src/simulator/actions.test.ts` line 118
- **What happens:** No OpenAPI or JSON Schema for a Java team to generate from. The status-code table lives in `domain/golive-types.ts`. The simulator's tests use a hand-written fake UCOMP whose messages already differ from the real routes.
- **Fix:** Generate OpenAPI (or zod schemas) from one source; run the simulator client against the real handlers with a seeded temp DB.
- **Evidence:** traced

#### A6 · Medium: Reads are exposed as server actions

- **Status:** Fixed. The five reads a screen loads on demand (compare, base version, submit summary, Copilot prompt, integration panel) are GET routes under `/api/templates/[templateId]/` whose queries parse their input with zod and keep their permission checks, and a lint rule allows `"use server"` only in `src/server/actions/` ([decision 0019](decisions/0019-on-demand-reads-are-get-routes.md)).
- **Where:** `src/server/queries/compare.ts` line 1; `src/server/queries/base-version.ts` line 62; `src/server/queries/submit-summary.ts` line 12
- **What happens:** Three `queries/` modules are `"use server"`, so every export is a public POST endpoint, queued one at a time with mutations (a hover prefetch in the share menu can delay Edit or Submit). `loadVersionsToCompare` has no input validation. An agent adding `"use server"` to a sibling like `library.ts`, which trusts its caller, would publish an unguarded endpoint.
- **Fix:** Reads through server components or GET route handlers; keep `"use server"` to `actions/`, each with zod.
- **Evidence:** verified

#### A7 · Medium: The HTTP Date header carries the demo clock

- **Status:** Deferred. Goes away with the demo clock.
- **Where:** `src/server/api/http.ts` line 44
- **What happens:** `withDemoDate` overwrites `Date`. The simulator stamps deliveries with it and orders batches by it at one-second resolution, so two sends in the same second can show the wrong latest batch. Any proxy that sets `Date` breaks it.
- **Fix:** A separate `X-Stencil-Clock` header in demo mode, and a sequence column for ordering.
- **Evidence:** traced

#### A8 · Low: Sample URLs are built from request headers

- **Status:** Open
- **Where:** `requestOrigin` in `src/server/queries/integration.ts` (was `actions/integration.ts` line 25)
- **What happens:** The integration panel builds the consumer base URL from `X-Forwarded-Host`, contradicting decision #4 in `decisions.md`. It will be wrong once consumers call Spring.
- **Fix:** Use a configured `CONSUMER_API_BASE_URL`.
- **Evidence:** traced

#### A9 · Low: Notifications store app URLs

- **Status:** Open
- **Where:** `src/server/effects.ts` line 101
- **What happens:** Hrefs built from Next routes are persisted, though the domain already has a `NotificationLink` descriptor. Route changes break old notifications, and a Java backend can't build Next routes.
- **Fix:** Store the descriptor and build the href when reading.
- **Evidence:** traced

### Architecture and backend seam

#### B1 · High: Server actions are the service layer

- **Status:** Partly fixed. Rendering now runs through a DB-free engine (`src/server/render/engine.ts`, PR #6). Every other action is still the service layer.
- **Where:** `src/server/actions/review.ts` line 443
- **What happens:** `approveVersion` runs `getViewer`, a DB lookup, the permission check, a transaction with five reads, the domain call, writes and effects, then `refresh`. Every action is shaped this way, and 42 production files import the Drizzle client directly. There is nothing to swap for HTTP calls.
- **Fix:** Request context plus service interfaces (see The backend decision).
- **Evidence:** verified

#### B2 · High: About a third of the business rules live outside src/domain

- **Status:** Partly fixed. The document rules (normalization, the content check, markers, links) are now single shared modules under `src/editor/model/` (PR #6). The comment policy has moved to `src/domain/comments.ts` ([S7](#s7--medium-comments-are-accepted-on-any-version-state)). Who may be named on an approval stage is one domain `validateChain` ([D4](#d4--high-the-chain-editor-saves-chains-nobody-can-approve), PR #14), and the settings screens' checks are domain functions their actions also run ([H2](#h2--medium-client-components-re-implement-domain-rules), PR #28); [N16](#n16--low-two-refusal-rules-still-live-outside-the-domain) lists two rules still outside. The lifecycle rules listed here are unchanged, and `decideCheck` still repeats the approve transition's earlier-stage rule.
- **Where:** `src/server/actions/review.ts` line 312; `src/server/queries/review-shared.ts` line 207; `src/server/queries/consumer-api.ts` line 32
- **What happens:** Submit auto-resolves threads; request-changes reuses an open draft; the comment policy; who may be named approver or Team Admin; channel defaults; which versions count as released and how search ranks; Auditor rules. Several are duplicated and drifting: `decideCheck` re-implements `approvedEarlierStage`, two copies of "who may see a version in review", the submit summary re-derives refusal sentences, and three components call `can()` themselves.
- **Fix:** One domain function per rule; read models return capability flags.
- **Evidence:** traced

#### B3 · Medium: Invariants rely on SQLite's single writer

- **Status:** Open
- **Where:** `src/domain/access.ts` line 364; `src/lib/serialized-writes.ts` line 1
- **What happens:** The last Team Admin, one open recertification per team, one pending request per user and team, and chain edits are read-check-write with no constraint behind them. On Postgres (READ COMMITTED) or several instances, two admins demoting each other leave a team with no admin. Missing indexes include `approvals(version_id)`, `comments(thread_id)`, `consumer_notices(consumer_id, created_at)` and `memberships(team_id)`; there are no CHECK constraints on state, status or role.
- **Fix:** Partial unique indexes and row locks (or Spring equivalents), documented as part of the port.
- **Evidence:** traced

#### B4 · Medium: SQLite workarounds are spread through the code

- **Status:** Open
- **Where:** `src/server/effects.ts` line 222; `src/server/queries/library.ts` line 59
- **What happens:** A process-wide write lock, three busy-retry copies (and one transaction with none), `rowid` ordering for audit and notifications, `strftime` day buckets, and in-memory filtering: the library loads every version of every team, and the audit page loads the whole log.
- **Fix:** Contain retries in the DB client, order by ULID or sequence, filter in SQL.
- **Evidence:** traced

#### B5 · Medium: Autosave conflict recovery reads the audit log

- **Status:** Open
- **Where:** `src/server/drafts/apply-patch.ts` line 122
- **What happens:** Recovering from a lost save response reads `rev` from the `draft.edited` audit row's JSON. If audit moves to Spring or an event stream, autosave conflict handling breaks.
- **Fix:** Store `lastSaveSession` and `rev` on the version row.
- **Evidence:** traced

#### B6 · Medium: Server code imports from components

- **Status:** Open
- **Where:** `src/server/queries/submit-summary.ts` line 12
- **What happens:** `submit-summary.ts` takes the business function `listSets` from `components/preview/sample-sets`; `create-template.ts` and the imports route take cookie constants from components. `domain/review-types.ts` holds screen view models. No lint rule forbids it.
- **Fix:** Add the rule; move `listSets` into `editor/model` and view models to `server/read-models`.
- **Evidence:** traced

### Tests and tooling

#### T1 · High: main fails e2e: the undo/redo merge added a layout shift

- **Status:** Fixed. Undo and redo now render from the server, greyed out until there is history, ahead of the save status, so the status gaining its "Revert to v1" menu on hydration (the 4px shift the check measured) moves nothing ([decision 0003](decisions/0003-undo-redo-always-shown.md)).
- **Where:** `src/components/workspace/save-status.tsx` line 51; `e2e/principles.spec.ts` line 271
- **What happens:** 4 of 241 Playwright tests fail on the project's own zero-layout-shift check, all on the template workspace and its dialogs. Each reports a 0.000004 shift at about 400 ms from the `span.inline-flex.items-center.gap-1.5` that wraps the save status and the new undo/redo buttons.
- **Fix:** Reserve the undo/redo buttons' space from the first paint, or render them disabled until history is ready (the "disabled, not hidden" rule).
- **Evidence:** measured

#### T2 · High: npm run lint fails on a clean checkout

- **Status:** Fixed. PR #8 ignores `.agents/` and `.claude/` in ESLint.
- **Where:** `eslint.config.mjs` line 98
- **What happens:** ESLint walks the committed third-party examples in `.agents/skills/ai-elements/scripts`: 3 errors, 3 warnings. The app's own code is clean. `tsconfig` also type-checks those files.
- **Fix:** Add `.agents/**` and `.claude/**` to `globalIgnores` and exclude them in `tsconfig.json`, or stop committing the skills (`skills-lock.json` can reinstall them).
- **Evidence:** measured

#### T3 · High: Database-backed unit tests depend on order

- **Status:** Partly fixed. The render, domain-render and editor tests pass in shuffled order (PR #6). The database-backed narrative tests listed here still don't.
- **Where:** `src/server/actions/review.test.ts` line 1; `src/simulator/actions.test.ts` line 1
- **What happens:** With `--sequence.shuffle --sequence.seed=12345`, 31 tests fail in 9 files (simulator actions 8 of 11, review 8 of 25, access 5 of 20, access sweep 4 of 7). The files are written as narratives, so a single `-t` run fails too. Agents will copy the pattern.
- **Fix:** A per-test fixture that copies a pre-seeded database in `beforeEach`, then shuffle in CI.
- **Evidence:** measured

#### T4 · High: No CI, Node pin or environment template

- **Status:** Open
- **Where:** `package.json` line 1
- **What happens:** No `.github/workflows`, `.nvmrc`, `engines`, `.env.example` or Dockerfile. `.gitignore` ignores `.env*`, which would also swallow an `.env.example`. Variables in use but undocumented: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `UCOMP_API_ORIGIN`, `PORT`.
- **Fix:** A workflow running lint, typecheck, shuffled Vitest, `npm audit --omit=dev`, build and Playwright; pin Node; add `.env.example` with `!.env.example`.
- **Evidence:** verified

#### T5 · Medium: E2E can't be pointed at its own database

- **Status:** Open
- **Where:** `e2e/api/helpers.ts` line 12
- **What happens:** `openDb()` hard-codes `data/ucomp.db` and two helpers hard-code the uploads folder, so `DATABASE_URL` splits server and tests. Thirteen specs assert with raw SQL, which won't survive a Java backend.
- **Fix:** One `E2E_DATABASE_URL` and uploads dir set in `playwright.config.ts` and read by the helpers; assert through the API where possible.
- **Evidence:** verified

#### T6 · Medium: shadcn is a runtime dependency

- **Status:** Open
- **Where:** `package.json` line 51
- **What happens:** Its only use is a CSS import, but as a dependency it brings 7 high `npm audit` findings into the production tree. `next-themes` is never imported.
- **Fix:** Move `shadcn` to devDependencies and remove `next-themes`.
- **Evidence:** traced

#### T7 · Medium: Slow and brittle test habits

- **Status:** Open
- **Where:** `src/editor/extensions/required-sections.test.ts` line 230; `e2e/demo-script.spec.ts` line 1
- **What happens:** A real 2.1-second sleep and several 25 to 80 ms sleeps in unit tests; 38 `waitForTimeout` calls in e2e; a 90 ms pacing delay on every click; demo-recording branches inside functional helpers; a 1,318-line `demo-script` test duplicating the scenarios. The selector ratio is good (832 role-based against 283 locators).
- **Fix:** Fake timers; web-first assertions; move recording pacing out of the functional helpers; retire or merge `demo-script.spec.ts`.
- **Evidence:** traced

#### T8 · Medium: Runtime paths assume the dev machine

- **Status:** Open
- **Where:** `src/server/render/channels/pdf-fonts.ts` line 47
- **What happens:** PDF fonts are read from `process.cwd()/node_modules/...`, uploads go to `./data/uploads`, and `db:migrate` needs `tsx` from devDependencies. All three break in a standard container.
- **Fix:** Copy fonts into the app, make the uploads location configurable, and compile the migration script.
- **Evidence:** traced

#### T9 · Low: No coverage tooling, and some server code is untested

- **Status:** Open
- **Where:** `vitest.config.mts` line 1
- **What happens:** No `@vitest/coverage-v8`. Reached only incidentally: persona and demo actions, library, workspace and platform queries, and the render log. No concurrency tests for approve, revoke or submit beyond double-click.
- **Fix:** Add coverage reporting and the concurrency tests.
- **Evidence:** traced

### Docs and agent guidance

#### G1 · High: AGENTS.md carries none of the project's rules

- **Status:** Fixed. PR #8 rewrote `AGENTS.md` with the project's rules, boundaries and files to copy.
- **Where:** `AGENTS.md` line 1; `docs/archive/agent-brief.md`
- **What happens:** It holds only Next.js's generated block. The project's rules live in `docs/archive/agent-brief.md`, which no agent loads automatically; three code comments are the only pointers to it.
- **Fix:** Move the rules, the commands and a list of exemplar files into `AGENTS.md`.
- **Evidence:** verified

#### G2 · High: The implementation plan describes code that no longer exists

- **Status:** Fixed. PR #8 archived the implementation plan; `docs/architecture.md` describes the current tree.
- **Where:** `docs/archive/implementation-plan.md`
- **What happens:** It says the app imports the editor only through `@/editor`, a barrel that was removed; an agent following it writes an unresolved import. About 35 folder-tree entries don't match (component names, extension names, `__tests__/`, scenarios 01 and 11). It says `partialPrefetching: true`, which the config deliberately leaves off.
- **Fix:** Archive it and write a short `ARCHITECTURE.md` with a current tree and the lint boundaries.
- **Evidence:** verified

#### G3 · Medium: The agent brief has stale and conflicting rules

- **Status:** Fixed. The content model is decided, enforced and documented in `docs/render-spec.md` (PR #6); PR #8 archived the agent brief.
- **Where:** `docs/archive/agent-brief.md`
- **What happens:** "Don't run `next build`" conflicts with the build being the gate for its own Suspense rules. It lists 8 personas; there are 9 (Dana). Its TipTap contract is narrower than the schema, and two reviewers confirmed documents outside it pass `checkDocument`: a table inside a table cell, a required heading inside a cell, a heading inside a list item, heading level 6. `sections.ts` silently assumes required headings are H2. A Java team building from the brief would reject documents already stored.
- **Fix:** Decide the content model: either restrict the schema to the documented one or document the real one, and enforce H2 for `requiredKey`. Drop the multi-agent working rules.
- **Evidence:** verified

#### G4 · Medium: Build-process docs and artifacts with dead paths

- **Status:** Partly fixed. PR #8 archived the build-process docs. `.claude/launch.json` still points at dead worktrees, and the 86 media files under `docs/` are still there.
- **Where:** `docs/archive/handoff-phases-5-7.md`; `.claude/launch.json` line 1
- **What happens:** Phase briefs, track reports and the handoff doc reference worktrees under another user's home directory and private ports; `.claude/launch.json` points at them too. `docs/decisions/media` is 14 MB, and 58 of its 86 files aren't cited anywhere. `design-reference.md` names a third-party product and points at `reference-images/`, which was removed but is still in git history; check that before sharing the repo.
- **Fix:** Delete the process docs and launch config, trim the media to what's cited, rewrite `design-reference.md`, and decide whether to rewrite history.
- **Evidence:** traced

#### G5 · Medium: The editor's public API is enforced only in prose

- **Status:** Open
- **Where:** `src/editor/README.md` line 1; `src/editor/schema.ts` line 34
- **What happens:** With the barrel gone, nothing enforces the README's API table. App code already imports internals (`@/editor/lib/platform`, `@/editor/model/usage`), and `schema.ts` still exports symbols the README calls removed. The "frozen" API also has unused members (`renderThread`, `dispose()`, `requiredSections`).
- **Fix:** A lint allowlist for `@/editor/*` imports outside the module, matching the README; remove or implement the unused members.
- **Evidence:** traced

#### G6 · Low: decisions.md is wrong in three places

- **Status:** Open
- **Where:** `docs/decisions/prototype-log.md`
- **What happens:** An unregistered consumer gets `unknown_consumer` (403), not `consumer_not_found`. Raw colors also appear in `user-avatar.tsx`. The formula guard also covers tab and CR.
- **Fix:** Correct the three lines and add a history banner.
- **Evidence:** verified

### Consistency and hygiene

#### H1 · Medium: Three server-action styles

- **Status:** Fixed. One server action kit (`serverAction` in `src/server/actions/kit.ts`) runs every action's steps (the demo tools aside) in one order and replaces the private copies of `RefusalError`, `check` and `transact`, and one browser hook (`useActionRun`) replaces the four action runners, with the settings sections sharing one `Strip` ([decision 0029](decisions/0029-every-action-runs-on-one-kit.md)).
- **Where:** `src/server/actions/review.ts` line 60; `src/server/actions/access.ts` line 61; `src/server/actions/platform.ts` line 48
- **What happens:** Some actions throw, most return `ActionResult`; access parses before authorizing, platform authorizes first, review looks up, checks, then rejects. `Refusal`, `check` and `transact` are copied three times; the client-side `useActionRun` pattern four times.
- **Fix:** One shared, non-`"use server"` kit and one client hook.
- **Evidence:** traced

#### H2 · Medium: Client components re-implement domain rules

- **Status:** Fixed. The settings read models return `can` and each strip's `consequences` decided by the domain with the demo clock, and every live form check is one exported domain function the action's rule also runs (`validateNewTeam`, `describeSectionsChange`, `describeRoleChange`, `validateDecisionNote`, `removeStageRefusal`, with `validateChain`); a test fails if a settings component copies a refusal, reads a clock, makes up an actor or runs a domain transition ([decision 0018](decisions/0018-settings-screens-render-decisions.md)).
- **Where:** `src/components/settings/platform/content-types.tsx` line 94; `src/components/settings/team/rows.tsx` line 20
- **What happens:** The content-types screen calls the real domain function on every render with a blank actor and `new Date(0)`. Teams and approval-chain screens mirror the server's refusal ladders; several settings views hard-code consequence sentences and compute due dates themselves. The platform channel screen does it right with `channelOffConsequences`.
- **Fix:** Server returns `can` plus consequence lines; for live validation, one exported pure `validateX` per rule.
- **Evidence:** verified

#### H3 · Medium: Forked primitives

- **Status:** Fixed. The segmented control (`Segmented`, `SegmentedRadio`), the tabs (`Tabs` on Base UI), the stat card's parts, the clipboard (`copyText`, `useCopy`) and `TeamIcon` each have one home in `src/components/primitives/`, channel names come from the domain's `CHANNEL_LABELS`, and `primitives/one-copy.test.ts` fails on a second copy of any of them ([decision 0030](decisions/0030-shared-primitives-have-one-home.md)).
- **Where:** `src/components/preview/controls.tsx` line 20
- **What happens:** The segmented control is copied four times, a stat card three times, tablists hand-rolled twice beside Base UI tabs, clipboard-with-fallback three times, channel label maps three times, team icon maps three times.
- **Fix:** Promote each to `components/primitives` and delete the copies.
- **Evidence:** traced

#### H4 · Medium: Formatting helpers are duplicated and clash

- **Status:** Fixed. Variable values have one formatting module (PR #6), and the UI's dates, day counts and "how long ago" (`src/domain/dates.ts`, with the one `DAY_MS`), counts (`src/domain/numbers.ts`) and plurals (`src/domain/plural.ts`) now have one each: the copies, the server's `queries/format.ts` and the clashing `fmtDay`, `relativeTime` and `dayLabel` are gone. Coral keeps its own (`src/simulator` may not import `src/domain`), and the `/design` mocks keep their fixture-clock day labels.
- **Where:** `src/domain/activity.ts` line 114; `src/domain/audit.ts` line 686
- **What happens:** An identical `date()` in two domain files; seven `plural` definitions; six or more "days ago" helpers; 13 `NumberFormat` instances; same-named functions with different signatures (`fmtDay`, `relativeTime`, `dayLabel`). `domain/dates.ts` calls itself the one way to write a date.
- **Fix:** Make `domain/dates.ts` plus one number and plural module the only homes.
- **Evidence:** traced

#### H5 · Low: Rebrand leftovers, two of them customer-visible

- **Status:** Partly fixed. The email preview's sender now falls back to `no-reply@stencil.example` ([decision 0023](decisions/0023-the-email-preview-sends-from-stencil.md)); the PDF font names wait for the enterprise font, and the internal names are unchanged.
- **Where:** `src/server/render/channels/pdf-fonts.ts` line 18; `src/components/preview/preview-sender.ts` line 8
- **What happens:** PDF font families are named "UCOMP Sans" and "UCOMP Serif", and the email sender falls back to `no-reply@ucomp.example`. Internal: the `UC-` template id prefix, the database file, three cookies, localStorage keys, `UCOMP_API_ORIGIN`, `.ucomp-*` classes and the drag MIME type.
- **Fix:** Fix the two visible strings now; decide the id prefix; rename persisted names in one migration with a read-both fallback.
- **Evidence:** traced

#### H6 · Low: No font-size tokens

- **Status:** Open
- **Where:** `src/app/globals.css` line 1
- **What happens:** 382 `text-[Npx]` utilities in production code, because the theme defines font families but no size scale.
- **Fix:** Add `--text-*` tokens and migrate.
- **Evidence:** traced

#### H7 · Low: Dead code

- **Status:** Open
- **Where:** `src/components/app-shell/page-placeholder.tsx` line 1
- **What happens:** 16 exports with no references, one component file nothing imports, a likely stale `pdfjs-worker.d.ts`, and 7 generated ui components that are never used.
- **Fix:** Delete them.
- **Evidence:** traced

#### H8 · Low: Oversized files and functions

- **Status:** Open
- **Where:** `src/components/review/review-workspace.tsx` line 56
- **What happens:** 25 production files over 400 lines. `ReviewWorkspace` is a 400-line function owning views, sample sets, comments, decisions and the go-live moment. The workspace session store handles nine concerns with a hand-rolled store while the editor uses zustand.
- **Fix:** Split into hooks; pick one store library.
- **Evidence:** traced

## The backend seam

The owner may keep Next.js as the backend or move business rules and storage to the existing Spring Boot API with Next.js as a BFF. The same seam keeps both open; add it in this order:

1. **Fail-closed request context.** `getRequestContext()` returns `{viewer, now, correlationId, credentials}` or refuses. Services never call `cookies()`, `getViewer()` or `now()` themselves.
2. **Use-case services behind interfaces** in a new `services` folder under `src/server/`: today's Drizzle code moves unchanged into a local implementation; an HTTP implementation can call Spring later. Only the local implementation, `src/server/db` and `src/server/seed` import Drizzle.
3. **Read models return capability flags** (`{ok, code, reason}`) with stable codes. Components render them; they never call `can()` or compare English sentences.
4. **Move the rules listed in [B2](#b2--high-about-a-third-of-the-business-rules-live-outside-srcdomain) into `src/domain`** as pure functions returning `{changes, effects}`.
5. **A machine-readable contract** for `/api/v1`: OpenAPI 3.1, RFC 9457 problem details, cursor paging and consumer credentials. Move CMS preview to a BFF route ([A1](#a1--high-the-public-consumer-endpoint-also-serves-cms-previews)).
6. **One config module** with `DEMO_MODE`, `CONSUMER_API_BASE_URL` and a `Clock` interface.

Rendering is already in this shape: `src/server/render/engine.ts` runs with no database, `docs/render-spec.md` specifies it, and the golden files are the acceptance test for a second implementation.

## Follow-ups from the render work

- **Approver views the output before approving.** The next PR: an approver must look at every enabled channel's output before Approve is available, in a way that stays quick to use.
- **Word import keeps the source's numbering.** Import and paste restart lists at 1 with the default style; map Word's numbering formats and start numbers into the per-list styles.
- **The enterprise font.** Swap it into `src/server/render/channels/pdf-fonts.ts`, fixing the findings listed under [The enterprise font](#the-enterprise-font) at the same time, then `npm run golden:update` refreshes the Node-only PDF files.
- **PDF cell detection for Java.** The parity test finds PDF table cells from the rules the Node adapter draws; a Java engine needs its own way, as `docs/render-spec.md` notes.
