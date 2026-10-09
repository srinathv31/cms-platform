> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# UCOMP prototype: final review for Sri

Phases 5, 6, 7a and 7b are built and integrated on `prototype`. This note says what exists, how to run it, what to look for in each demo-script scenario, which calls were made without you, and what is still rough. It is written to be read once, top to bottom.

- Repo: https://github.com/srinathv31/cms-platform
- Branches `track/golive`, `track/access` and `track/import` are kept (the three phase branches, already merged into `prototype`).
- Every call made without you is in `docs/decisions.md`; any of them can be overruled.

## 1. What was built

### Phase 5: going live
- **Consumer API** under `/api/v1`: search Active templates, one template's metadata, contract and JSON Schema, and a consumer's notices. All require `X-Consumer-Id`.
- **Coral simulator** at `/sim`: a deliberately foreign "ops console" (banner "Coral — simulated"). Offers, link a template and pin a version, map values, send to customers with a results grid showing exact render errors, customer views (phone, inbox, PDF), notices, relink when a new version adds required variables.
- **Usage**: team dashboard (Overview and Consumers tabs, stat cards, Top templates, heatmap, daily renders) and a per-template Usage tab. Previews never count.
- **Integration panel** behind SHARE: template ID, Active version, channels, contract table, copyable JSON Schema, curl and fetch samples, "What changed since vN".
- **Demo pill** gains "Open simulator".

### Phase 6: access and admin
- **Request access** page and the access rules: requests need a reason to deny, nobody changes their own access, every team keeps a Team Admin.
- **Settings modal**, Team group: Members, Access requests, Recertification, Inactivity. Platform group: Teams, Content types, Channel rules, Approval chains. Consequences are shown before you commit.
- **Two-stage approval**: Dana Park (9th persona, Coral Offers Viewer) is the Legal reviewer stage; the stage reviewer can act across teams.
- **Clock-driven access**: inactivity flags at 90 days and suspends at 120; recertification lapses exactly at its deadline on the demo clock.
- **Audit page** (filter bar with chips, presets, CSV export that follows the filters), **notifications** (unread dot, mark read, every event type) and **sidebar cards**.
- **Auditor** (Taylor): all teams, read-only, never holds a team role.

### Phase 7a: import, Copilot, ⌘K
- **Import** .docx, .pdf or .txt into a draft from New template. `{{placeholders}}` become Text chips; a title becomes the name; missing required sections are added empty. An **Original** tab in the rail shows the source with an import report (Detected, Dropped, Kept as text).
- **Copilot prompt**: a rail row builds a prompt from the saved draft; pasting an answer back merges sections and turns `{{key}}` into chips, as one undo step.
- **⌘K palette**: Recent, Actions, This template, Templates, Pages, Settings, Teams.
- **Carried rough edges fixed**: PDF keep-with-next, redline "Changes only" markers for threads on hidden blocks. Typing latency re-measured: no regression, no change.

### Phase 7b and integration
- **One migration** (`0002_phase5_7.sql`) replaced the three track migrations.
- **Adversarial review**: fixes for upload limits and worker isolation, the Auditor rule, self-naming on approval chains, the simulator's UCOMP origin, unknown consumers not counting as usage, a published JSON Schema that matches what render accepts, and more (`docs/decisions.md`, "Integration: adversarial review fixes").
- **UX pass**: one date and time formatter on the demo clock, narrower-window layouts (Library, Settings modal), tooltips on icon-only toggles, no placeholder text anywhere, "Open review" in the workspace rail, "Back to UCOMP" returning to where you came from.
- **Whole demo script as one Playwright run** (`e2e/demo-script.spec.ts`), plus a principles check on every route.

## 2. How to run it

```
npm run demo      # next build && next start (production build, port 3000 unless PORT is set)
```

- Open the app, then use the **Demo pill**: **Reset demo** returns the seeded data and the starting clock date (Sun, Oct 4, 2026). **Advance clock** moves the demo clock; **Open simulator** opens Coral.
- Switch persona from the avatar menu. Personas: Maya (Author), Jordan and Alex (approvers; Alex is Team Admin), Priya, Sam, Riley (Platform Admin), Taylor (Auditor), Morgan (no access yet), Dana (Legal reviewer).
- From the command line: `npm run db:reset` returns the database to its seed. Stop `next start` first.
- The e2e suite uses ports 3100 (gate) and 3200 (media), so it does not clash with the demo on 3000.

## 3. Scenario walkthrough

Start each pass from Reset demo. The scenarios build on each other, so run them in order. `e2e/demo-script.spec.ts` plays all eleven as one story; the recording and contact sheet are in `e2e/__screens__/gate/` (gitignored, on this machine): `demo-script.mp4` / `.webm` (the full walkthrough, ~5.7 min), `contact-sheet.png` and `contact-sheet.html` (276 stills: 138 at 1440, 138 at 1280), and `scenario-02.mp4` … `scenario-10.mp4`.

### 1. First impression (Maya)
- Library shows five Coral Offers templates: Annual Fee Waiver, Balance Transfer Intro, Cash Back Welcome Bonus, Holiday Points Promo, Rate Change Notice (all "— Terms" except the last).
- Every row carries a status badge; at least three different states are on screen.
- One black primary button: **New template**.

### 2. Create (Maya)
- **New template** then **Card offer terms**: two clicks, and the name is selected and focused. Rename it "Spring Travel Rewards — Terms".
- Drag `first_name` from the Variables panel into the text; type `{{pur` and pick **Purchase APR**; type `{{Offer end date` and create it inline as a **Date**.
- Try to delete "Legal notices": it refuses with "Required for disclosures" on the heading.
- Turn on the **Email** channel, put `{{first_name}}` in the subject, then **Preview**. Switch PDF, Web and Email, and the sample sets **Typical customer** and **Long name and maximum values** (Alexandria-Marguerite; the layout holds).
- **Submit for review**: the dialog says "Submit v1 for review"; afterwards the badge reads **In review** and the document is read-only.

### 3. Review loop
- Maya's review screen: **Approve** and **Request changes** are disabled with "You submitted this version."
- Switch to Jordan: the Review nav item shows a count; **Waiting on me** lists Maya's template. Select text, **Comment**, then **Request changes** with a reason. Badge: **Changes requested**; a new draft exists.
- Switch to Maya: the change request and the comment sit in the rail with a marker in the margin. Fix the text, **Resolve**, **Submit v2**.
- Switch to Jordan: **Approve v2** ("v2 becomes Active."). The go-live moment plays ("v2 is Active"), the badge becomes **Active** and the Share button appears.

### 4. Going live
- Demo pill, **Open simulator**. The "Spring Travel Rewards" offer reads "Not linked". **Link template**, search "Spring Travel": the result shows the UC- ID and "Active v2".
- Map Variables (First name to Customer · First name, Offer end date to Offer · Ends on, and so on) and link; it is pinned to v2.
- Pick five customers and send: "15 delivered" (five customers by three channels). Open a customer in the phone frame, then the **Inbox** and **PDF** views (**Open PDF** link). The long-name customer's layout holds.
- Back in UCOMP, Usage then **Consumers**: Coral on v2 with 15 renders. The render log holds no customer values.

### 5. Breaking change, pin and sunset
- Maya: **Edit** on the Active template (draft "Based on v2"), add a required `annual_fee`, **Submit v3**. The dialog shows **Contract changes** with "Breaking change".
- Jordan: the review screen shows the same contract change. In **Approve v3**, open "Set a sunset date for v2" (14 days): the consequence text names Coral ("Coral has to map annual_fee before it moves to v3.", "It will keep working until ...").
- Simulator: the offer shows "v3 available" and says "Pinned to v2"; a send still delivers on v2.
- Demo pill: advance the clock 15 days. The simulator says "A send now fails." and the send reads "0 delivered, 6 failed" with the sunset message.
- **Relink to v3**: mapping asks for Annual fee ("Map Annual fee to send." until mapped). Map it, send: delivered, "Pinned to v3", the customer view shows the $95 annual fee.

### 6. Revoke
- Jordan: Library, Balance Transfer Intro — Terms, **Revoke v1**. The consequence names Coral and says "Once confirmed, its renders will fail immediately." Give a reason, **Start revoke**. He sees "You started this revoke. Another approver must confirm it."
- Switch to Alex: **Confirm revoke**; v1 shows **Revoked**.
- Simulator: the Balance Transfer Intro offer reads "Revoked" and a send fails immediately ("0 delivered, 4 failed").
- Audit page: both steps (started by Jordan Ellis, confirmed by Alex Kim) appear.

### 7. Teams and roles
- **Priya**: edits on Coral Offers; switch team to **Deposits** and she is **View only**, with no New template and no formatting toolbar.
- **Sam**: opens an Active template as View only; SHARE opens the integration panel, with nothing to edit and no Settings.
- **Riley** (Platform Admin): Settings, Channel rules, turn off **Disclosure on Email**. The consequence reads "N Active Disclosure versions stop rendering to Email." and only **Turn off Email** commits it. Riley can open, but not edit, a template.
- **Taylor** (Auditor): team switcher shows **All teams**; the Audit page has a Team column and shows Riley's change and Alex's revoke with demo-clock times ("UTC"). Filter by Person (chip, **Clear all**, "Export N events" follows).

### 8. Access
- **Morgan** sees `/request-access`, Coral Offers with "Team Admin: Alex Kim". Pick **Author**, add a reason, **Send request**: "Your request for Author access is waiting on Alex Kim."
- **Alex**: sidebar card "Access request pending" and a bell notification. Settings, Access requests, **Approve**; the strip says "Morgan Lee gets Author access to Coral Offers" and **Approve as Author** confirms. Morgan now sees the Library.
- Alex, Settings, Recertification: "0 of 6". **Keep** everyone except Sam.
- Advance the clock past the recertification deadline (the e2e run advances 31 days in all): Sam sees "Your access to Coral Offers lapsed on ...". Alex's Members row for Sam reads "Access lapsed".

### 9. Import (Maya)
- Library, **New template**, **Import a file** (dashed row), pick `e2e/fixtures/import/spring-offer.docx`. It opens as a draft named "Spring Balance Transfer Offer" with a `first_name` chip and the Balance transfer fee table.
- The rail opens on **Original**: the import report on top (Detected, Dropped, Kept as text) above the source ("Dear {{First Name}},"). This is "Compare with original".
- ⌘K opens the palette ("Search") with Recent, Actions and Templates.

### 10. Copilot prompt
- In the rail, **Copilot prompt** opens "Prompt for Copilot". **Copy prompt** shows "Copied".
- Paste back an answer containing `## Rates and fees` and `{{purchase_apr}}`: the heading merges into the existing Rates and fees section and `{{purchase_apr}}` becomes a chip. One Cmd+Z undoes the whole paste.

### 11. Reset
- Demo pill, **Reset demo**; the dialog names the signed-in person. Confirm **Reset**: seeded data returns and the clock reads "Real time" again (the starting date).

## 4. Autonomous decisions

Full text, with reasons and rejected variants: `docs/decisions.md`. Headline picks, with the main stills (paths relative to `docs/`):

| Pick | Section | Main stills |
|---|---|---|
| Simulator look **A (Ops console)**, with B's results headline and stepwise relink | Phase 5 | `decisions/media/track-a/simulator-a-offers.png`, `simulator-a-send.png`, `simulator-a-customer-phone.png`; recording `decisions/media/track-a/simulator-tour.webm` |
| Usage dashboard **A (Insights)**, with B's consumers table | Phase 5 | `decisions/media/track-a/usage-a.png`, `usage-a-consumers.png`, `usage-template.png`; recording `decisions/media/track-a/usage-tour.webm` |
| Settings modal **A (Rows)**, with C's count trails, recertification stat card and Now/After cards | Phase 6 | `decisions/media/track-b/settings-a-members.png`, `settings-a-recertification.png`, `settings-a-approval-chains-add.png`; recording `decisions/media/track-b/settings-walkthrough.webm` |
| Audit filters **A (filter bar with chips)** | Phase 6 | `decisions/media/track-b/audit-a.png`, `audit-a-filtered.png`; recording `decisions/media/track-b/audit-walkthrough.webm` |
| **Compare with original** = the rail widens to an Original tab (no separate mock) | Phase 7a | none; follows the Rail layout decision |
| Dana Park as a 9th persona; stage reviewers act across teams | Phase 6 | `decisions/media/track-b/settings-c-approval-chains-add.png` (the Now/After cards) |
| Auditor holds no team role, ever; nobody names themselves on a chain | Integration | none |
| One date and time formatter on the demo clock ("UTC" on times of day) | Phase 7b | none |

The rejected variants (simulator B and C, usage B and C, settings B and C, audit B and C) have their stills in the same two media folders (`simulator-b-*`, `usage-c*`, `settings-b-*`, `audit-c*`, and so on) with the reasons in `docs/decisions.md`.

Smaller calls worth a glance: the Library import row is dashed and not a fifth card; a usage "render" counts every attempt, failed or not; "Renders" is a rolling 30 days, not a calendar month; the reference screenshots were removed from the repo before publishing (history was not rewritten).

## 5. Known rough edges

From the track reports and `docs/decisions.md`:
- **Reordering approval stages** does not remap versions already waiting on a stage (deferred; needs a product rule for in-flight reviews). Adding or removing a stage, the demo path, is correct.
- **Platform Admins can't add a Team Admin** to an existing team, so the "kept last Team Admin" alert only informs.
- **Embedded PDF in headless Chromium** shows a blank frame; real Chrome shows it. Specs fetch "Open PDF" and check the bytes.
- **Links rendered as `<Button render={<Link/>}>`** get role "button" (sidebar card "Review", audit Export); specs locate them by href.
- **A PDF stream that decodes to gigabytes** allocates outside the worker's heap limit; the 30 s timeout and 10 MB upload bound it, but production needs a container memory limit.
- **Dropping a .docx onto an open document** is out of scope; import is from New template.
- **Below about 760px wide** nothing was checked; at 800 and 760 the workspace tab bar now fits (labels collapse to icons with tooltips), the Library drops secondary columns, and the settings modal narrows its nav.
- **The simulator's own formats** (dates, 28px buttons, its accent colour) differ from UCOMP on purpose.
- **Fixed during integration** (were rough edges): Edit on an Active template sometimes did nothing — root cause was SQLite `SQLITE_BUSY` with no busy timeout plus a poisoned pooled connection (now a process-wide write lock with a 5 s busy wait, `src/lib/serialized-writes.ts`); the `next build` localStorage warning (a dependency loaded during prerender; the block handle now loads in the browser only); the workspace tab bar below ~796px.
- **Dev-only noise in `demo` runs**: harness init scripts add console lines in the PDF frame; the spec filters exactly those.

## 6. Test counts

- Unit and integration (vitest): 143 files, 2,447 tests, all passing
- End to end (Playwright, production build): 241 tests, 241 passed, 0 flaky (chromium, one worker, on `next build` + `next start`); `gate:media` 20/20
- Whole demo script, one serial run from a fresh reset, zero console errors: `e2e/demo-script.spec.ts`, scenarios 1→11 as one continuous story with no fixtures or resets in between: green in the full suite and in 4 further standalone runs, zero console or page errors (the spec fails on any)
- Principle checks on every route (one primary button, statuses via StatusBadge, no placeholder text, axe clean, CLS 0): `e2e/principles.spec.ts`, ~105 route × persona checks plus dialogs, strips and popovers: all green (part of the 241). The Coral simulator is checked for placeholders, axe and CLS only, since it is deliberately a foreign system
- Media (recording, contact sheet, stills at 1440 and 1280): `e2e/__screens__/gate/` (gitignored, on this machine): `demo-script.mp4` / `.webm` (the full walkthrough, ~5.7 min), `contact-sheet.png` and `contact-sheet.html` (276 stills: 138 at 1440, 138 at 1280), and `scenario-02.mp4` … `scenario-10.mp4`
