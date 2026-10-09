> **History.** Calls made while the prototype was built, in October 2026. Some have been superseded by later code,
> and this log isn't updated anymore. New decisions are numbered records in this folder: see [README.md](README.md).

# Decisions log (Phases 5–7)

These are the calls the lead agent (Claude) made on its own while finishing Phases 5–7, without Sri in the loop. Sri can overrule any of them at review; each entry says what was picked and why, so it can be reversed on its own.

How to read this: sections run in build order (Phases 5, 6, 7a, then integration and the 7b UX pass), and a later entry that supersedes an earlier one says so. Bold text is the pick; "Rejected" lines keep the reasoning for the variants not chosen. Screenshot and recording paths are relative to `docs/`; the dev mocks they were taken from stay at `/design/*` in the app.

## Phase 5: going live

Branch `track/golive`. Report: `archive/tracks/a-report.md`.

### Contracts (accepted from the Phase 5 brief)
- **Simulator calls UCOMP server-side** from its own origin (via `headers()`; superseded at integration, see "Integration: adversarial review fixes"), so the browser never logs the intended 4xx/410 failures. Keeps "zero console errors" true during failure scenarios.
- **Consumer GET endpoints require `X-Consumer-Id`.** Same header as render; unknown consumer → `consumer_not_found`.
- **"Renders this month" is a rolling 30 days vs. the 30 before**, labelled "Renders · 30 days". Calendar months make the demo clock jumps look wrong.
- **A link can be saved with unmapped required variables.** Send is then disabled and names the missing ones (explain only when blocked).
- **A send renders every linked channel** for each chosen customer.
- **The integration panel loads via a server action when opened**, so neither header file changes.
- **The Demo pill is mounted in the simulator layout** too, so scenario 5 can advance the clock without leaving Coral.
- **The simulator palette lives in `src/simulator/theme.css`**, the one place outside `tokens.css` with raw colours. It follows the recorded "deliberately foreign" decision (Q7).
- **The contract is split** into `src/contracts/api-v1.ts` (wire shapes, import-free, lint-enforced), `src/domain/golive-types.ts` (UCOMP side), `src/simulator/types.ts` (Coral side), because the simulator boundary forbids importing `@/domain`.

### Simulator look: **A (Ops console)** with two borrowings from B
Mock: `/design/simulator?v=a|b|c` (kept as reference). Media: `decisions/media/track-a/` (tour recording: `decisions/media/track-a/simulator-tour.webm`).
- **Picked:** A, a navy sidebar (Offers, Customers, Deliveries, Notices with a badge); one offer = one page with Template | Values | Send tabs; dense tables with mono keys; the customer view in a right-hand drawer. Helvetica Neue, 5px corners, cool grey, signal-orange accent. Stills: `decisions/media/track-a/simulator-a-offers.png`, `decisions/media/track-a/simulator-a-link.png`, `decisions/media/track-a/simulator-a-map.png`, `decisions/media/track-a/simulator-a-send.png`, `decisions/media/track-a/simulator-a-customer-phone.png`, `decisions/media/track-a/simulator-a-notices.png`, `decisions/media/track-a/simulator-a-relink.png`, `decisions/media/track-a/simulator-a-sunset.png`.
  - Why: the plan asks for "a results grid" with exact render errors, and A's table is exactly that; it reads most convincingly as another company's back-office tool (the point of the Q7 "deliberately foreign" decision) and shows the contract and mapping densely for the engineer audience.
- **Borrowed from B:** the results headline ("4 delivered, 1 failed") above A's grid, and the relink as consequence-first steps (What changed → Map new value → Confirm) inside A's page, so consequences come before commitment.
- **Rejected B (Top-nav wizard)** (`decisions/media/track-a/simulator-b-*.png`): the most story-like, but it reads as a marketing campaign tool rather than a bank's ops system, loses the contract/mapping tables, and has lots of empty space.
- **Rejected C (Split-pane workbench)** (`decisions/media/track-a/simulator-c-*.png`): dark graphite makes the UCOMP boundary jarring, and three panes are tight at 1280. Its always-visible customer preview is a later idea.
- Coral's own accent colour on its primary button is intentional: the one-black-primary rule is UCOMP's, not Coral's.

### Usage dashboard: **A (Insights)** + B's consumers table
Mock: `/design/usage-dashboard?v=a|b|c&scope=team|template` (kept as reference). Media: `decisions/media/track-a/usage-tour.webm`.
- **Picked:** A, following reference-images/Unknown.png: serif "Usage" title, Overview | Consumers tabs, three stat cards (Renders · 30 days with trend + channel mix; a gauge for renders on active versions; active templates with sunset note), Top templates bars beside a Daily renders heatmap, Renders over time (13 weeks, stacked by channel) and failure rate. Stills: `decisions/media/track-a/usage-a.png`, `decisions/media/track-a/usage-a-full.png`, `decisions/media/track-a/usage-a-consumers.png`, `decisions/media/track-a/usage-a-tooltip.png`.
- **Borrowed from B:** the consumers table (version StatusBadge, sunset note, 30-day sparkline, All / On superseded / Failing filter) as A's Consumers tab: it answers "who renders what, on which version", which feeds the approve/sunset/revoke consequence text.
- **Rejected B as the page** (`decisions/media/track-a/usage-b*.png`): least like Unknown.png, with charts as an afterthought. **Rejected C** (`decisions/media/track-a/usage-c*.png`): two tab-like controls on one page, no heatmap.
- **Per-template Usage tab:** as mocked (`decisions/media/track-a/usage-template.png`): renders by version, "N% still on vX", "Who renders it".

### Simulator core (S3)
- **A send fails as an action only when UCOMP can't be reached at all**; render failures are stored as result rows with the API's exact `{status, code, message}`.
- **No persona or permission check in the simulator**: Coral acts as itself through `X-Consumer-Id: coral`.
- **Delivery ids keep send order** (`dlv_<batch>_<NNN>`), so a batch reads back in customer then channel order; each delivery is stamped with real time (superseded in the Phase 7b UX pass: the demo clock's `Date`).
- **At most 3 renders in flight** per send.

### Usage aggregation (S2)
- **Usage counts** only non-preview renders with a consumer, at or before `now()` (demo clock). Windows: current = [now − 30d, now], previous = [now − 60d, now − 30d). Days are UTC days of the demo clock.
- **One denominator: a render is an attempt (succeeded + failed).** "Renders" everywhere (headline, Top templates, heatmap, weekly bars, a consumer's row, the gauge) counts every attempt; "failed" is the subset that errored; "succeeded" is the rest as a share of attempts, and shows "—" when there were none. A template whose only render failed reads "1 render, 0% succeeded, 1 failed". (QA fix batch; before, "renders" meant successes only, so the cards didn't reconcile.)
- **"Consumers"** counts any consumer with a render in the window, failed or not.
- **A consumer row's note adds only the extra fact** ("sunset in 21 days", "3 failed renders", "renders fail"); the Version badge already says Superseded, Revoked and the sunset date.
- **A future sunset is a warning only within `NEARING_SUNSET_DAYS`**; further out it shows the same text, neutral.
- **The "N failed renders" tag applies to Active rows too**, otherwise the "Failing" filter would never catch Cash Back v2; it's dropped when the row already says "renders fail".
- **Rows sort danger first**, then warning, then other tags, then by renders.

### Consumer API (S1)
- **The JSON Schema describes only canonical forms**: decimals as strings matching `^(?!-0(?:\.0+)?$)-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$` (no leading zeros, no negative zero, no exponent; strings only, since a pattern can't constrain a JSON number), dates as `format: date` + a YYYY-MM-DD pattern that checks the calendar, states as an enum of 51 codes. The route still accepts the friendly forms and JSON numbers (read from their source text, same grammar). Tests check that whatever the schema accepts, render accepts too.
- **Notices route check order**: header missing (400) → header unregistered (403) → path consumer unregistered (404) → mismatch (403). A notices `since` with no zone is read as UTC.
- **Seeded revoke notices get `activeVersion` filled in** from the versions' dates.
- **Sample snippets name the template's most recent real consumer**, falling back to the first registered one ("coral").

### Usage UI (U2)
- **The template Usage tab spans the rail's column** (no rail on that tab), left edge aligned with the header, 48px right inset.
- **Narrow consumers table**: below ~58rem of card width, "Last render" hides when the Template column is present; the sparkline still shows recency.
- **The Failures chart on the template tab plots 30 days**, matching the "Succeeded" figure beside it.
- **Added beyond the brief:** a "Recent failures" table on the template tab, and Top templates labels link to each template's Usage tab.

### Simulator UI (U1)
- **Link and Relink are allowed with unmapped required variables**; a blocked sentence shows beside the button ("Map Annual fee to send.") and Send stays disabled.
- **Pinning is always to the Active version**; the version step is a read-only row (a consumer can't pin a superseded version).
- **Results headline counts renders** (customer × channel), not customers.
- **Small header buttons inside Coral panels are 28px**, not UCOMP's 32px: deliberate, part of the foreign look.
- **The results grid shows Coral's newest batch** even if the link changed since; its context line names the batch's own version.

## Phase 6: access and admin

Branch `track/access`. Report: `archive/tracks/b-report.md`.


Mocks: `/design/settings?v=a|b|c`, `/design/audit?v=a|b|c` (kept as references). Media: `decisions/media/track-b/` (walkthrough recordings: `decisions/media/track-b/settings-walkthrough.webm`, `decisions/media/track-b/audit-walkthrough.webm`).

### Settings modal sections: **A (Rows)** with three borrowings from C
- **Picked:** A, dense table rows with inline actions and a consequence strip under the row; plain caps-label groups TEAM / PLATFORM in the nav, as in Unknown-3.png. Stills: `decisions/media/track-b/settings-a-members.png`, `decisions/media/track-b/settings-a-members-suspend.png`, `decisions/media/track-b/settings-a-access-requests.png`, `decisions/media/track-b/settings-a-recertification.png`, `decisions/media/track-b/settings-a-inactivity.png`, `decisions/media/track-b/settings-a-approval-chains-add.png`.
- **Borrowed from C:** muted count trails on the nav for items needing action (Access requests, Recertification, Inactivity); the Recertification "4 of 6 · 30 days" stat card; the side-by-side "Now / After" chain cards as the consequence when adding Dana Park's Legal stage (`decisions/media/track-b/settings-c-approval-chains-add.png`). These make consequences visible before commitment, the strongest part of C.
- **Rejected B (List + detail)** (`decisions/media/track-b/settings-b-*.png`): two clicks per person, hides the overview, and the Team|Platform scope switch breaks Unknown-3.png's one-glance nav.
- **Rejected C as a whole** (`decisions/media/track-b/settings-c-*.png`): tall cards make six members scroll; reads heavier than the reference.
- **Frame change:** content padding px-14 → px-10 and nav 17rem → 15rem so the member table columns fit.
- **Member states** (Suspended, Lapsed) render as muted text on a dimmed row, not StatusBadge (StatusBadge is for template version states only).

### Audit filters: **A (filter bar with chips)**
- **Picked:** A, five menus (Team, Person, Action, Template, Date) whose picks become removable chips, "Clear all", and "Export N events" that follows the filters. Lowest risk and maximum room for the table. Stills: `decisions/media/track-b/audit-a.png`, `decisions/media/track-b/audit-a-filtered.png`, `decisions/media/track-b/audit-a-menu.png`, `decisions/media/track-b/audit-a-date.png`.
- **Rejected B (facet rail)** (`decisions/media/track-b/audit-b*.png`): costs 15rem of table width, truncates Template and Details, heaviest chrome.
- **Rejected C (token query field)** (`decisions/media/track-b/audit-c*.png`): least discoverable for C-suite and business users; a candidate for a later power-user mode.
- Replace the mock's native date inputs with the app's date picker / presets (7, 30, 90 days on the demo clock).

### Contracts (accepted from the Phase 6 brief)
- **Dana Park is a 9th persona** (Coral Offers Viewer), so the Legal reviewer stage has someone to switch to. The build plan's stretch goals list "A Legal reviewer persona".
- **A stage reviewer can act across teams.** A Legal stage applies to every team's disclosures. Being named on a stage lets that person open and decide (and comment on) any submission currently waiting on their stage, in any team, even with no membership there. Otherwise a Deposits submission would wait forever on someone who can't see it. The chain editor states this when the stage is added.
- **Recertification excludes Team Admins** (they certify others). 6 items in the seed.
- **The access sweep runs on Advance clock and on persona switch** (not on a timer). Lapses are backdated to the moment the deadline was crossed; when two deadlines hit one person the earlier wins, and a tie goes to recertification. Running the sweep twice changes nothing.
- **Inactivity is counted from the latest of last sign-in, date added and the last Keep.** Keep and Reinstate restart the clock.
- **Nobody changes their own access**, and every team keeps at least one Team Admin.
- **A denial needs a note**, which the requester sees.
- **Seed notification kinds renamed** to match the code (`version_active` → `version_live`, etc.).

### Access server (S1)
- **The recertification sidebar card keeps one id for the whole review**, so a dismissed card doesn't come back after each Keep. The access-requests card's id changes with the newest request and the count.
- **A member removed while undecided counts as removed**, so a review can close early without them.
- **Persona switch order:** cookie → sweep → `lastActiveAt = now()` → revalidate → redirect.
- **`getHomeCard()`** is a separate query for people with no space (the "my request" card).

### Platform config and two-stage approval (P1)
- **A stage reviewer outside the team opens the version through their own space** (`/<their-space>/review/{id}/{n}`); it shows in their queue and badge. They keep seeing it after deciding; other versions of that template stay 404. They still need active access somewhere.
- **Nobody approves two stages of the same round** ("You approved an earlier stage."); Approve is disabled with that reason.
- **Required-section edits affect only templates created afterwards.** Nothing checks sections at submit, so removal can't break a draft; at least one section must remain. New templates conform to the type (removed sections become ordinary headings, renamed ones take the new title, new ones are appended).
- **Turning a channel off** shows its consequence before saving ("2 Active Disclosure versions stop rendering to Email.").

### Audit and notifications server (S3)
- **Audit filters are multi-select** (comma lists): values within a field are ORed, fields are ANDed; facet counts are computed under every other filter.
- **The Person filter matches the actor or the subject**, so "Person: Sam" shows his lapse. Events with no actor show as "UCOMP".
- **An approver's activation reads "Approved"**; with no actor, "Became Active".
- **CSV export**: When (ISO, demo clock), Who, Team, Template ("Name (UC-…)"), Version, Action, Details; BOM; all matching rows; fields starting with `= + - @` get a leading apostrophe (formula-injection guard). 403 without `audit.view`.
- **Notifications** list the newest 30 plus the unread count; only the owner can mark one read.

### Team settings UI (U1)
- **Members has no "Added" column** (it didn't fit at 1280); job-title sublines truncate with the full text in `title`.
- **Labels:** "Restore" (not "Reactivate") and "Deny" (not "Decline"), matching the actions.
- **On a dimmed (suspended/lapsed) row only the person and cells dim**; actions stay full strength.
- **A blocked row shows the single refusal sentence instead of buttons** (e.g. your own row: "You can't change your own access.").
- **The hard-nav settings route opts out of instant navigation** (`instant = false`), like the modal route, to avoid a dev console error on section actions.

### Platform settings UI (U2)
- **Turning a channel on is immediate; turning one off** shows its consequence and commits only on confirm. The last channel left on can't be turned off.
- **Approval chain edits are drafted** (add, edit, reorder, remove) and saved together behind one strip with the Now/After cards. Removing a stage is blocked while a version waits on it, or when it's the only stage.
- **Reviewer picker offers only people with active access.**
- **Unsaved drafts survive switching sections** in the modal (hidden routes stay mounted). Left as is.

### Audit page (U4)
- **Filters live in the URL** (shareable; back/forward work), with optimistic chips.
- **Date offers presets only** (Last 7 / 30 / 90 days on the demo clock); a custom range arriving by URL still shows as a chip.
- **"Clear all" shows with two or more chips**; with one, the chip's × is the way out.
- **The list shows the newest 500** ("Newest 500 of N events"); Export always includes every matching row.
- **Team column only on All teams**; platform events read "Platform", system events "UCOMP".

### Review fixes (R1)
- **The sweep never ends a team's last active Team Admin.** When the clock would end every active Team Admin a team has (day 120 or a review's deadline), the one whose access would end last stays active, still flagged; `access.kept_last_admin` is recorded at the boundary and the Platform Admins are told (link: All teams → Settings → Teams). Said once per inactivity clock (marker: `inactivityFlaggedAt = suspendAt`); a Team Admin added later can suspend them from Inactivity.
- **A 90-day flag from before a sign-in doesn't count**: the next 90 idle days flag (and notify) again.
- **An Auditor can't be named on a stage** (read-only everywhere; nor can someone with no active access). An Auditor named anyway gets nothing from it.
- **A stage reviewer outside the team** gets review notifications linking into their own first space, and can preview the version they're reviewing.
- **New templates also drop channels the content type no longer allows.**
- **Known rough edge (deferred): reordering approval stages doesn't remap versions already waiting.** Moving a stage ahead of a waiting version's stage makes it skip that stage; changes-requested versions and past approvals aren't remapped, so the stepper can mislabel stages after a reorder. Adding or removing a stage (the demo path) is correct. Reason: rare in practice, and a correct remap needs a product rule for in-flight reviews.
- **Platform Admins can't add a Team Admin to an existing team** (only via a new team's first admin), so the "kept last Team Admin" alert can only inform.

### QA and review fixes (B-fix)
- **A review never lapses a current Team Admin.** Someone promoted to Team Admin while a review runs stays on its list but doesn't lapse at the deadline (the same exclusion as when a review starts). The last-Team-Admin hold now only matters for inactivity.
- **Every access action runs the sweep first**, in its own transaction (a refusal mustn't roll it back), so a past-due review is closed, with its lapses, before a new one starts or anything is decided.
- **A kept last Team Admin reads "Kept active / Last Team Admin"** on Inactivity instead of a past auto-suspend date.
- **Exactly one settings dialog.** Opened by URL, a nav click is intercepted by the modal slot; the page's dialog then steps aside and the intercepted one closes to the library (not back, which would leave the app). It appears without the enter animation, so nothing blinks.
- **Strips and editors sit in their own row/cell** inside a table's rowgroup; empty action column headers read "Actions" to screen readers.
- **Closing a strip returns focus in the same commit** (the dialog's focus manager otherwise pulls focus to the dialog a frame later).
- **Esc in a stage editor closes the editor first**, keeping the draft; on a new stage still without a name it cancels the add. A second Esc closes Settings.
- **An unnamed new stage's blocked confirm reads "Save chain"**, never "Add stage" like the button that adds one. "Each stage needs a different person." shows only when one person is named on two stages.
- **One strip open per table**: opening another closes the first (channel rules now share one turn-off strip across rows).
- **Fields have a visible 13px label above, no placeholder** (Team name, Description (optional), First Team Admin, Stage name, Reviewer, Note for <First>); accessible names unchanged.
- **Dimmed rows mute their text and fade only the avatar** (superseded in the Phase 7b UX pass: the avatar greys instead) (fading text failed contrast). Muted counts turn full strength on the selected and hover fills.
- **An access request's reason shows in full in the Approve and Deny strips.**
- **Content types' strip says its scope from the start**: "Applies to new Disclosure templates only. Existing templates keep their sections."
- **Audit grid:** Action 10rem (fits "Configuration changed"), Template and Details floored; under the width those need, Who stacks under When and Details under Template; narrower still, Action under Template. Details and Action carry their full text in `title`. The chip row's height is reserved, so the first chip doesn't move the table. Zero-count options read muted. Filter popovers are named "<Field> filter".
- **Relative times on the audit and in notifications count calendar days** (UTC, the demo clock): "Yesterday", "4 days ago"; same-day times stay "3 hours ago".
- **The sidebar is one navigation landmark** ("Sidebar"), covering the switcher, the pages, the card, Settings and Help.
- **The role picker is a radio group** (Tab to the chosen role, arrows move it), in the same segmented look.

## Phase 7a: import, Copilot, ⌘K

Branch `track/import`, which also carried the rough edges left from Phases 3–4 (PDF keep-with-next, redline markers, typing latency). Report: `archive/tracks/c-report.md`.

### Compare with original: the rail widens (no separate mock)
- **Picked:** "Compare with original" works like Preview: the right rail widens and shows the uploaded source (an "Original" tab beside Variables), with the draft in the main pane. Reason: the recorded Rail layout ("main pane is just the document; Preview = rail widens") already answers this; a side-by-side split would introduce a second layout pattern for the same job.
- No dev mock was built for this one, because the layout is dictated by an existing decision rather than open taste.

### Typing latency: no regression, no change
- Re-measured (10 runs of `e2e/perf/typing-latency.mjs` + 4 every-keystroke CDP traces × 192 keystrokes, under the heavy lock). The handler per keystroke is a **1.2 ms median (p95 ~1.8 ms)**, below Phase 2's ~1.5 ms. Phase 4 code adds at most ~0.04 ms per keystroke (review-threads maps decorations; format-bubble doesn't re-render while typing; block-rects only fires on resize or block moves).
- The earlier "2.5 ms" came from the script's Event Timing metric, which only reports keystrokes slower than 16 ms to paint (46–71 of 192): the slow tail on a busy machine. Runs split into 1.2–1.5 ms and 2.5–3.0 ms groups purely by machine load.
- **Decision:** no code change. For future gating, use per-event processing time or a trace rather than the script's median alone.
- Not measured: the real workspace route with gutter markers subscribed (their signal fires at most once a frame, on resize or block moves).

### PDF keep-with-next chain
- **A heading + a short intro (≤ 3 lines) + a table/list/callout start move together**: the heading and intro become one non-wrapping group that reserves room for the next block's head (for a table, its header and first row). An intro longer than 3 lines breaks the chain so it can split and doesn't drag the table. Long tables still split with the header repeated. Seeded templates' page counts are unchanged.

### Redline "Changes only": markers for threads on hidden blocks
- **A thread on a hidden unchanged block shows its marker on the "N unchanged blocks" line that hides it** (counts summed per line). Clicking it opens the thread and reveals that block in place, tinted, splitting the collapsed run around it.

### Import, Copilot, ⌘K contracts (accepted from the Phase 7a brief)
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

### ⌘K palette (C7-4)
- Groups: Recent (no query; up to 5 of the viewer's audit events here), Actions (New template, Import a file; only where you can create), This template (Content, Versions, Usage, Activity), Templates (recently touched rank first), Pages (Library, Review, Usage, Audit if permitted), Settings (sections you may open), Teams.
- **Preview isn't a palette item**: it's rail state inside the workspace, not a route.
- **⌘K defers to the editor**: with a text selection it opens the link field instead.
- Data is fetched once per space (`/api/palette/[space]`) and refreshed when templates change or after 20 s.

### Import server (C7-1)
- **`{{First Name}}` and `{{first_name}}` merge into one key**; a placeholder split across formatting runs becomes one chip.
- **An H1 that matches a required section stays a section** rather than becoming the template name.
- **PDF lines set noticeably larger than body text become headings** (a ~1.6× line becomes the title), so a PDF gets a name and its sections match. Repeated running lines (headers/footers) are dropped and reported.
- **Images, comments, footers and Word styles are dropped** and listed in the import report; a .docx's images still show in the Original tab (data: URIs, capped at 2 MB).
- **The import shows in Activity** as "Maya Chen imported Spring offer.docx."

### Copilot prompt and paste-back (C7-2)
- **The Copilot prompt dialog** sends the pending autosave first, then builds the prompt on the server from the saved draft (body only, Markdown, with each `{{key}}` and the required section headings). "Copy prompt" is the one black button.
- **Plain-text Markdown pasted into the document parses as Markdown**; one-line fields and ⇧⌘V paste text exactly as before.
- **A pasted section's blocks go at the end of the matching section** (or replace it if it holds only empty lines); unmatched headings stay headings.
- **A paste is always its own undo step**, even right after typing (otherwise one Cmd+Z in Chrome also took back the line typed before).
- **A required heading copied from an editor still pastes as a plain heading** (the existing guard behaviour is unchanged).
- Typing latency after this change: per-event processing 0.6–0.8 ms median (none of this code runs while typing).

### Fix batch 1 (QA part 1)
- **A marker on a collapsed "N unchanged blocks" line says "N comment(s) in unchanged blocks"**; once the block is revealed it says "on this block". Choosing a marker with the keyboard puts focus back on the thread's marker even though it is re-keyed onto the revealed block.
- **Inserted text in the redline uses a darker green** (`--rl-ins-text`, 70% of the positive token mixed with the ink) because the token on its tint was 4.31:1; the underline keeps the token's green.
- **No placeholders that repeat the label**: the comment/reply box and the link field ("Link address") have none; their accessible names are unchanged.
- **Chip labels made from keys keep whole-word acronyms in capitals**: APR, APY, FDIC, ID, URL, ATM, ACH, SSN ("purchase_apr" → "Purchase APR"). `labelFromKey` is shared, so import reports and pasted-chip labels agree. Only whole words match ("identity" stays "Identity").
- **Palette Recent leaves out the template you are on** (the "This template" group covers it) **and Templates doesn't repeat what Recent shows** at rest. While typing, Recent is hidden and everything is in Templates, as before.
- **A settings row's "Team"/"Platform" tag shows only when both kinds are listed.**
- **Palette search also matches a template's status label** ("draft", "active", "in review").
- **⌘K does not open over another modal** (dialog, alert dialog, sheet); it still closes itself when open.

### Import UI and the Original tab (C7-3)
- **Rail tabs read Preview, Original, Comments, Variables**; Original shows only when the template came from an import.
- **On arrival from an import** the template name is selected and, on wide canvases, the rail opens on Original with the report at its top. Below the rail breakpoint it doesn't auto-open (it would cover the name being edited); the Original tab is one click away.
- **Upload pre-checks run in the browser** (type, empty, size), so the common refusals appear instantly at the import row.
- **Esc in the workspace ignores popups that aren't on screen** (the Library's New template dialog stays mounted, hidden, under `<Activity>`).

### Fix batch 2 (QA part 2)
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

## Integration: adversarial review fixes
- **The consumer API and the integration panel advertise only channels that render** (review #8/#11). A version's published channels are its own channels ∩ its content type's allowed channels, in `GET /api/v1/templates` (search), `GET /api/v1/templates/{id}` (contract and every version) and the SHARE panel (channels and samples) — the set the render route accepts. Coral's link flow checks against the contract, so it now refuses a channel Channel rules turned off; links saved before the turn-off are unchanged.
- **The Copilot prompt titles the required sections as the draft does** (review #9). Its `##` headings are the draft's own required headings in document order (what the section paste matches); the content type fills in only a section the draft lacks (or an empty heading), after the section that precedes it in the type. A rename in Platform settings no longer reaches existing drafts' prompts, consistent with "existing templates keep their sections".
- **A comment reply to a stage reviewer outside the team links to the version's review screen in their own space** (review #10). A comment notification on a numbered version that is no longer in review stays a template link for the team, and names the version (`reviewVersion`), so someone who can't open the team's workspace gets `/{their space}/review/{id}/{n}`, like the other review notifications. Draft threads are unchanged.
- **If the block handle's chunk fails to load, the editor mounts without it** (review #12). The handle is optional chrome: the failed load is caught (no unhandled rejection), the document becomes editable without the handle, and the next editor mounted retries the load.
- **The Audit page reads once per request** (review #13). `getAuditPage` keeps its signature but caches on the space and a string key of the filters (React's `cache` keys objects by identity), so the Export count and the table share one read and always agree.
- **.docx and .pdf parse in a worker thread with a heap limit and a timeout** (review #0). mammoth and pdf.js run in `src/server/import/convert-worker.mjs` (256 MB heap, 30 s); a bomb that exhausts the worker or runs too long ends the worker and is refused "Couldn't read this file.", never the server. A .docx's zip is also checked from its central directory first (≤ 2,000 entries, ≤ 48 MB per part and 96 MB in all once inflated, ≤ 100× past 16 MB) and refused the same way. The worker file runs unbundled (Turbopack's node-worker loader needs `__dirname`, which the route runtime lacks). Residual: a PDF stream that decodes to gigabytes allocates off-heap buffers the heap limit doesn't cap; the timeout and the 10 MB upload bound it, a fronting proxy or container memory limit should back it in production.
- **POST /api/imports takes the team in the query and checks permission before reading the body** (review #1). `?team=<slug>`; then a declared Content-Length over 10 MB + 64 KB is refused (413), and the body is read with a byte counter that cancels the stream past that, so a chunked upload with no Content-Length is refused at the limit too. The Library's upload sends the team in the query.
- **The Auditor holds no team role, ever** (review #2). Enforced centrally in `permissions.ts`: an Auditor gets template.view, integration.view and audit.view whatever memberships they hold, and not access.request. requestAccess refuses an Auditor ("Auditors have read-only access and can't hold team roles."), decideAccessRequest refuses to approve an Auditor's request (denying still works), createTeam refuses an Auditor as first Team Admin, the first-admin picker leaves Auditors out, the profile menu hides Request access, and /request-access says the sentence instead of the forms.
- **Nobody names themselves on an approval chain, and a platform role alone is no approve power** (review #3). saveApprovalChain refuses a stage that newly names the acting admin ("You can't name yourself as an approver."); a named stage gives decide/comment only to someone with an active team role somewhere (a Platform Admin with none is refused when named, and gets nothing if named before). The chain picker leaves out the acting admin and people with no team role.
- **The simulator calls UCOMP at a configured origin, never one from request headers** (review #4). `UCOMP_API_ORIGIN` when set, else `http://127.0.0.1:$PORT` (the port `next dev`/`next start` listen on: 3000, 3100 for the gate, 3200 for the demo). Host and X-Forwarded-* are no longer read for the fetch target.
- **A render refused as unknown_consumer is not usage** (review #5). The render route still logs it (render_log keeps the unregistered X-Consumer-Id as the trail of who tried), but every Usage read model skips rows with error_code `unknown_consumer`: no consumer row, no count, no recent error. Consumers later removed from the registry still show for the renders they made while registered.
- **Preview by "you decided it" needs current access** (review #6). The render preview's decided-it path now also requires an active team role somewhere, as the review screen's `requireSpace` does; a person removed from every team, lapsed or suspended reads nothing they once approved.
- **The published JSON Schema only accepts what the render route accepts, with format as annotation** (review #7). A required text has `minLength: 1` and pattern `\S`; currency, percent and number are decimal strings only (≤ 308 whole digits; JSON numbers still render but aren't advertised, since 1e21 or 1e-7 stringify to exponent notation the route refuses); a date's pattern checks the real calendar (month lengths, leap years, years 0100–9999).
- **Every top-level route segment is a reserved team slug** (review #14). `sim` added; a test reads `src/app` (route groups looked through) and fails if a top-level segment isn't in RESERVED_SLUGS.

## Phase 7b: UX pass
- **Library below 56rem of canvas** (800px windows): Team, Last edited and Owner give way; the team moves to the line under the name (`UC-… · Coral Offers`). Review queue and Audit already fold and were fine at 800.
- **Settings modal never wider than the window**: unchanged at 1280 and up (72vw, 56rem floor); the floor is capped at the window less 2rem, and below 900px the nav narrows to 13.5rem and the content pads 28px. Settings tables keep an 8rem name column and scroll sideways inside the panel instead of crushing it (the Members table scrolls about 100px at 800). The brief's `w-[min(96vw,70rem)]` was not used because it widened the modal at 1280 and 1440.
- **One date and time formatter** (`src/domain/dates.ts`): every user-facing time is the demo clock in UTC; a time of day says "UTC" ("Oct 4, 10:31 PM UTC"); dates are "Mon D" in the demo clock's year and "Mon D, YYYY" otherwise; sentences keep the long month ("March 1, 2027"); hover titles and the Demo pill give the full instant ("Sun, Oct 4, 2026, 10:31 PM UTC"). The Audit "When" column, its Date chip, the recertification and request dates, the Original tab's upload date, the Versions "today/yesterday" days (were local) and the sunset badge (now year-aware where a `now` is at hand) all go through it. The CSV keeps ISO. The simulator keeps its own formats.
- **UCOMP's /api/v1 responses carry the demo clock as their HTTP `Date` header** (`withDemoDate` in `src/server/api/http.ts`), and Coral stamps each delivery with the `Date` of UCOMP's answer (real time when there is none or no answer). Supersedes Track A's "each delivery is stamped with real time".
- **A template that has never been Active** shows one line on its Usage tab, "Not live yet." with a link to Versions, instead of empty charts. The consumers table's header reads "Renders (30d)" on one line, so Trend and Last render line up.
- **The SHARE sheet's description stays** ("Template ID, active version and the variable contract for consumer teams."): it is screen-reader only (the dialog's description), not hint text.
- **Approving a first version adds a consequence line**: "v1 becomes Active." stays the dialog's description, and "Consumers can start using it right away." sits in the box under it.
- **Seed notification titles are full sentences** with a full stop, like the live ones ("Maya Chen submitted … v3 for review.", "… v1 was revoked.").
- **"Back to UCOMP" returns to the page the simulator was opened from**: the Demo pill remembers it for the tab (sessionStorage) as it opens the simulator; with none it goes to "/".
- **A version in review shows "Open review" in the workspace rail** (a quiet row at the end of the rail, under Variables or Comments, hidden while the preview is open), for everyone who can see the template in that space, which is who can open its review screen.
- **The icon-only Preview and rail toggles have real tooltips** (Base UI, open on hover and on keyboard focus) besides their aria-labels; the native `title`s are gone.
- **No placeholders anywhere** (principles check): Library search, the Demo pill's days field and Coral's template search keep their accessible names only.
- **Recently decided shows a sent-back version as its StatusBadge** ("Changes requested"); "Approved" stays a green action line. The folded line reads "Jordan Ellis requested changes · 4 days ago". Tab counts are text-muted (subtle was 4.48:1).
- **The approval-chain flow ends in the Active StatusBadge**, not the bare word.
- **The Audit Export button is the skeleton's width** (10.5rem, enough for a four-digit count; wider only past that), so nothing shifts as it streams in.
- **Dimmed rows grey the avatar instead of fading it** (`UserAvatar muted`, initials about 5.7:1); no opacity on text-bearing elements. Supersedes Track B's "fade only the avatar".
- **The Usage read models' speed test counts SQL statements, not milliseconds** (6, 7 and 8 at most): a 150 ms wall-clock budget failed under full-suite load; the statement count is what keeps them fast as the log grows.
- **Coral's Send picker starts empty on each visit to an offer page**: the selection is keyed on the router's visit id (`useRouter().bfcacheId`), so a page Next kept alive from an earlier visit never shows the last send's ticks; it survives a tab switch, a refresh after the send and browser back/forward.
- **Coral's template search list says it is busy** (`aria-busy`) while the shown results answer an older query than the field holds, since the list can still reorder when the newer answer lands (a click in that moment could land on the wrong row or on nothing).

## Repository
- **Third-party reference screenshots removed from the repo** (2026-10-05). `reference-images/` held screenshots of another product (the Usage dashboard and settings-modal targets). They were removed in a normal commit on `prototype` before the repo was published publicly, and `/reference-images/` is now gitignored; the files remain on the local machine as design targets for QA. History was not rewritten, so commits before the removal (and the track branches cut from them) still contain them.

