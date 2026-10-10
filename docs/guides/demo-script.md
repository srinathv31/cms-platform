# Stencil Demo Script

A guided walkthrough for people seeing Stencil for the first time. It follows one disclosure from a blank page to customers' inboxes, sends an alert to their phones, takes the disclosure through a safe change and an emergency stop, then shows how the platform is governed.

- **9 acts, 54 steps, about 57 minutes** (a 20-minute cut is in [Timing, cuts and rules](#timing-cuts-and-rules)).
- **Verified:** every step was run end to end, in this order, from a fresh `npm run db:reset` against a production build of `main` @ 9a8bc38 on October 7, 2026, except Act 5 (alerts), which was written with the alert composer and phone preview and hasn't had its end-to-end run yet. Dates in the app depend on the day you run it, so the steps use relative dates.
- **Screenshots** of each act's key moments are on the [published version of this script](https://claude.ai/artifact/VqfoD2z9CuMw1RBnHc4BsU). That page is private until it's shared from its Share menu.

**Contents:** [The story](#the-story-youre-telling) · [Setup](#before-the-audience-arrives) · [Cast](#the-cast) · [Run of show](#run-of-show) · [Act 1](#act-1--orientation) · [Act 2](#act-2--write-a-disclosure) · [Act 3](#act-3--review-and-approve) · [Act 4](#act-4--customers-receive-it) · [Act 5](#act-5--alerts-push-and-sms) · [Act 6](#act-6--change-it-safely) · [Act 7](#act-7--governance) · [Act 8](#act-8--access-and-admin) · [Act 9](#act-9--accelerators-and-reset) · [Closing](#closing-whats-next) · [Requirements coverage](#requirements-coverage) · [Glossary](#glossary) · [Timing](#timing-cuts-and-rules) · [Rough edges](#rough-edges-on-stage)

## The story you're telling

### The problem

Today, business and marketing teams write customer content in Word or ad hoc templates, and marketing sends it straight to customers. Nothing checks it in between. Disclosures go out with wrong numbers, teams read the same rules differently, and compliance has no checkpoint and no record, because a review over email can't be tracked.

The legal text has to match the offer exactly. The delivery systems' templates are hard-coded. And Coral's offer disclosures must be live by **March 2027**.

In the business's own words (Discovery Brief, "Purpose and problem"):

> "Nothing checks it in between."
>
> "Disclosures go out with incorrect information."
>
> "Teams interpret the same requirements differently."

### The pitch

Stencil is one controlled place to author, approve and publish customer content. Business teams write disclosures in an editor as easy as Word, an approver signs off inside the tool, and systems like Coral get each customer's PDF, web page or email built from the approved version. Stencil never stores customer data, and every change is versioned, audited and rolled out without breaking the systems that depend on it.

### Six things the audience should leave believing

| Theme | What it means | Requirements |
|---|---|---|
| One source of truth for every channel | Write once; PDF, web and email all come from the same approved version. | R1–R4, R10, R14, R17 |
| Speed for business users | Two clicks to typing, typed variables, starters, Word import, Copilot. | R7–R9, R11–R13 |
| Compliance control | Maker-checker, configurable approval chains, redlines, consequences shown before you commit. | R5, R22, R23, R27, R34 |
| Safe change for downstream systems | Consumers stay pinned, breaking changes are flagged, old versions sunset on a date, bad ones are revoked by two people. | R6, R16, R20, R30–R32 |
| Auditability | Every version, decision and render is on record and exportable. | R6, R18, R29, R32 |
| Self-service access that stays governed | Request access in the app; admins approve, recertify and see inactivity. | R26, R28, R29 |

## Before the audience arrives

### Start the app

1. From the project folder, install, reset the demo data and start the production build. Use `npm run demo`, not `npm run dev`: the dev server compiles each page the first time you open it, which looks slow on stage.

   ```bash
   npm install
   npm run db:reset
   npm run demo
   ```

2. Open `http://localhost:3000`. You land in Maya's Library (Maya is the default persona).
3. Do one full practice run, then reset. The acts build on each other.

### Your controls

- **Switch persona:** click the avatar (initials, top right), then pick a name. The page stays where it is.
- **Demo pill:** the dashed "Demo" button, bottom right. It opens the Coral simulator, moves the demo clock forward (+15 days, or any number), and has **Reset demo**.
- **Back to Stencil:** the dark button, top left of the simulator.
- **Files for Act 9:** `e2e/fixtures/import/spring-offer.docx` and `e2e/fixtures/import/rate-change-notice.pdf`. Keep the Finder window ready.

### Six rules that keep the run working

- Leave **Card Used Abroad v1** for Act 5, and **Cash Back Welcome Bonus v3** alone until Act 8; its next version, v4, is the two-stage approval at the end.
- Add the **Legal reviewer** stage only in Act 8, after Spring Travel's approvals. Once added, it gates every Disclosure version submitted after it.
- In Act 6, pick a sunset **14 days out or less**. The default (30) breaks the +15-day step.
- Do Sam's step and the recertification **Keeps** before advancing the clock in Act 8.
- Run Act 5 before the clock moves: its Usage step reads the seeded renders of the last 30 days.
- The clock moves twice: **+15 days** in Act 6 and **+16 days** in Act 8. If you skip Act 6, advance **31** in Act 8.

## The cast

| Persona | Role and team | Use them for |
|---|---|---|
| Maya Chen | Author · Coral Offers | The main character: writing, changing and importing content |
| Jordan Ellis | Approver · Coral Offers | Reviewing, approving, setting a sunset, starting a revoke |
| Alex Kim | Team Admin and Approver · Coral Offers | Confirming a revoke, approving access, recertification |
| Priya Raman | Author · Coral Offers; Viewer · Deposits | Different rights on different teams |
| Sam Ortiz | Viewer · Coral Offers | Read-only access; the integration panel |
| Riley Brooks | Platform Admin · all teams | Channel rules and approval chains; can't edit content |
| Taylor Nguyen | Auditor · all teams | The full audit log and export |
| Morgan Lee | No team yet | Requesting access |
| Dana Park | Viewer · Coral Offers; Legal reviewer once added | The second approval stage |

In the Coral simulator, the operator shown is **Dana Whitfield**, a Coral employee. She is not Dana Park.

## Run of show

| Act | Min | The audience should leave believing | Proves |
|---|---|---|---|
| 1 · Orientation | 3 | There's one controlled place for every customer document, and its state is visible at a glance. | R1, R6, R27, R34 |
| 2 · Write a disclosure | 6 | A business user can write a compliant, multi-channel disclosure without help. | R2, R7, R9, R10, R12, R13, R14, R17 |
| 3 · Review and approve | 6 | Nothing reaches a customer without a second person's approval, and the trail is automatic. | R5, R6, R16, R23 |
| 4 · Customers receive it | 6 | One approved template serves every channel, and no customer data is kept. | R4, R16, R18, R30, R31, R32 |
| 5 · Alerts | 5 | Push and SMS get the same control as documents, and the author sees exactly what each phone will show. | R5, R10, R14, R17, R18 |
| 6 · Change it safely | 8 | Changes never surprise downstream systems, and a bad version can be stopped at once, by two people. | R5, R20, R32, R34 |
| 7 · Governance | 3 | Every action is on record and exportable for compliance. | R6, R18, R27 |
| 8 · Access and admin | 11 | Access is self-service but governed, and rules and approval chains are settings, not software releases. | R3, R10, R22, R26, R27, R28, R29 |
| 9 · Accelerators | 5 | Existing Word and PDF content, and Copilot drafts, come in fast with the rules still enforced. | R8, R11 |

## Act 1 — Orientation

*About 3 minutes · Maya · no data changes*

**Goal:** there's one controlled place for every customer document, and its state is visible at a glance.

1. **Do:** In the Library, click the **Active** filter chip, then **All**.
   - **They see:** eight Coral Offers templates, three of them alerts, each with a status badge, and the ACTIVE column showing which version customers get. The chips read "All 8 · Draft 2 · In review 2 · Active 4".
   - **Say:** "Every customer document this team owns, what state it's in, and which version customers get, at a glance."
2. **Do:** Click **Help** at the bottom of the sidebar, then press Esc.
   - **They see:** the keyboard shortcuts and the six statuses: Draft, In review, Changes requested, Active, Superseded, Revoked.
   - **Say:** "One lifecycle for every template, whatever the business line."
3. **Do:** Point out the sidebar and the team switcher (top left, "Coral Offers").
   - **They see:** Library, Review and Usage. Audit and Settings appear only for the roles that need them, and Maya belongs to one team. Priya shows several teams in Act 8.
   - **Say:** "People only see what their role allows."
4. **Do:** Press ⌘K, type `holiday`, press Enter, then open the **Versions** tab.
   - **They see:** Search with Recent, Actions, Templates and Pages. Then Holiday Points Promo: v2 Active, v1 Revoked, "Started by Jordan Ellis, confirmed by Alex Kim."
   - **Say:** "Nothing is ever overwritten. Every version is kept, with who did what and when."
5. **Do:** Click the avatar (top right), then press Esc.
   - **They see:** the nine demo personas and their roles.
   - **Say:** "In production this is your company sign-in. Here it lets us play every role in the story."

## Act 2 — Write a disclosure

*About 6 minutes · Maya · changes data*

**Goal:** a business user can write a compliant, multi-channel disclosure without help.

1. **Do:** **Library → New template → Card offer terms.** Type `Spring Travel Rewards — Terms` (the em dash is ⌥⇧-) and press Enter.
   - **They see:** Document · Alert over a gallery, Document chosen: Blank, Card offer terms, Rate change notice, Fee schedule and Import a file. The editor opens with the required sections already in place.
   - **Say:** "Two clicks and you're writing. The legal skeleton is already there."
2. **Do:** The caret is at the end of the first paragraph. Type ` Earn triple points on travel.`, press Enter, then type `Hello! Your Spring Travel Rewards offer is ready.`
   - Drag **First name** from the right rail into the gap between "Hello" and "!". Clicking the row also works; it inserts at the caret.
   - At the end of that line type ` Your purchase APR is {{pur` and press Enter to pick Purchase APR. Then type ` until {{Offer end date`, choose **Create "Offer end date"**, set Type to **Date**, press Enter, and type `.`
   - **They see:** variable chips in the sentence, "1 use" beside each in the rail, and "Saved" in the header.
   - **Say:** "Rates, names and dates are typed variables, never retyped by hand. That's where today's errors come from."
3. **Do:** Triple-click the **Legal notices** heading and press Backspace.
   - **They see:** it refuse, with "Required for disclosures".
   - **Say:** "The required sections can't be removed. Compliance is built into the template."
4. **Do:** In the rail under Channels, click **Email**. Subject: type `{{`, pick First name, then type `, your Spring Travel Rewards terms`. Preheader: `See your rates, fees and offer end date.`
   - Click **Preview** (the eye). Open the sample-set menu and choose **Long name and maximum values**. Switch to **Web**, then **Email**. Press Esc.
   - **They see:** the PDF reading "Hello Maya!… 21.99% until …". With the long-name set, "Alexandria-Marguerite" fills every channel, including the email subject, and the layout holds.
   - **Say:** "You see every channel, with worst-case data, before anyone approves it."
5. **Do:** Click **Submit for review**. Note: `First version of the spring travel terms.` Then **Submit v1**.
   - **They see:** the dialog list the channels and sample sets. The badge turns **In review** and the document becomes read-only.
   - **Say:** "Submitting freezes a numbered version automatically. No one has to remember to save a copy."

## Act 3 — Review and approve

*About 6 minutes · Maya and Jordan · changes data · needs Act 2*

**Goal:** nothing reaches a customer without a second person's approval, and the trail is automatic.

1. **Do:** As Maya: **Review → Submitted by me → Spring Travel v1**.
   - **They see:** Approve and Request changes disabled: "You submitted this version."
   - **Say:** "Maker-checker: you can never approve your own work."
2. **Do:** Switch to **Jordan Ellis**. **Review → Waiting on me → Spring Travel v1**. Leave Cash Back v3 ("Breaking change") for Act 8 and Card Used Abroad v1 for Act 5.
   - In the paragraph under the fees table, select `starts on the transaction date`. Click the floating **Comment**, type `Please state the APR more plainly.` and click **Comment**.
   - Click **Request changes**, reason `The interest wording is too vague. State the purchase APR plainly.`, then **Request changes**.
   - **They see:** the approval stepper, Maya's note, a comment marker in the margin, and the badge change to **Changes requested**.
   - **Say:** "Review happens in the tool, pinned to the exact words, not in an email thread no one can find later."
3. **Do:** Switch to **Maya**. **Library → Spring Travel** (Draft, "Based on v1"). Click at the end of "…by the due date." and type ` Your purchase APR is 21.99%.` Click **Resolve** on the comment thread.
   - **Submit for review**, note `Spelled out the purchase APR.`, then **Submit v2**.
   - **They see:** the change request and thread waiting in the Comments rail, then v2 go to review.
4. **Do:** Switch to **Jordan**. **Review → Waiting on me → v2 → Approve**, then **Approve v2**.
   - **They see:** "v2 becomes Active. Consumers can start using it right away." Then the go-live moment ("v2 is Active" in the SHARE ring), and the badge reads **Active**.
   - **Say:** "Two people, a full trail, and a clear moment it goes live."
5. **Do:** Click the **SHARE** ring. Press Esc when done.
   - **They see:** the Integration sheet: template ID, Active v2, channels, the variable contract and JSON Schema, a request sample per channel, responses and error codes. It shows "Loading…" for about a second first.
   - **Say:** "Everything an engineering team needs to integrate, without a meeting."

## Act 4 — Customers receive it

*About 6 minutes · Jordan and the Coral simulator · changes data · needs v2 Active*

**Goal:** one approved template serves every channel, and no customer data is kept.

1. **Do:** Demo pill → **Open simulator**.
   - **They see:** "Coral — simulated". Spring Travel Rewards reads "Not linked"; Balance Transfer reads "v1 Superseded · sunset … · v2 available".
   - **Say:** "This stands in for Coral, the first business system that uses Stencil."
2. **Do:** **Spring Travel Rewards → Link template**, search `Spring Travel`, and pick the result (its UC- ID, "Active v2").
   - Map: First name → Customer · First name; Purchase APR → Customer · Purchase APR; Home state → Customer · Home state; Offer end date → Offer · Ends on. Click **Link template**.
   - **They see:** "Pinned to v2".
   - **Say:** "Coral owns the link between its offer and the template. Stencil stays neutral about the business."
3. **Do:** Tick Olivia Bennett, Marcus Delgado, Anjali Kapoor, Fatima Al-Sayed and Maximiliano-Bartholomew…, then **Send to 5 customers**.
   - Click Olivia's **Web · Delivered** cell, then **Inbox** and **PDF**. Open the long-name customer's view too.
   - **They see:** "15 delivered"; a phone showing "Hello Olivia!"; the subject "Olivia, your Spring Travel Rewards terms"; the PDF. The long name doesn't break the layout.
   - **Say:** "One approved template, three channels, five customers. Stencil built each one on request and kept none of their data."
4. **Do:** **Back to Stencil → Usage**. Open the **Consumers** tab, then click the template to see its own Usage tab.
   - **They see:** renders over 30 days, the channel split, % on Active versions, Nearing sunset, Top templates and a heatmap. Consumers lists Coral · Spring Travel · v2 · 15, and the template shows 100% succeeded.
   - **Say:** "You always know who uses what, and on which version, before you change anything."
5. **Optional,** for a technical audience: in the Share sheet, **Copy curl** and paste it into Terminal.
   - **They see:** HTTP 200 and a `UC-XXXXXX-v2.pdf` file. This adds renders to Usage.

## Act 5 — Alerts: push and SMS

*About 5 minutes · Maya and Jordan · changes data · before the clock moves*

**Goal:** push and SMS get the same control as documents, and the author sees exactly what each phone will show.

1. **Do:** Switch to **Maya**. **Library → New template → Alert → Statement ready.** Click **Preview** (the eye).
   - **They see:** Alert's own starters: Blank, Payment reminder, Card activity and Statement ready. Import a file stays greyed: "Only documents can be imported." The template opens on a push and a text message, and Copilot prompt is greyed ("Copilot drafts documents only."). Preview shows the push on an iPhone lock screen.
   - **Say:** "A template is a document or an alert, for life. An alert is short plain text, and goes to Push and SMS only."
2. **Do:** At the end of the push body, type ` Thanks for banking with Coral. Pay in the app.`
   - **They see:** the phone's notification change with every keystroke, the sample values filled in. Once the body runs past the lock screen's four lines, a warning appears under the field: "iPhone lock screen cuts after “…Pay in the”."
   - **Say:** "What the author sees is what the phone gets, byte for byte, before anything is saved."
3. **Do:** In **Subtitle**, type `Coral Rewards card`. Switch the preview from **iPhone** to **Android**, then back.
   - **They see:** the subtitle under the title on the iPhone; Android leaves it out, as the field's label says.
   - **Say:** "One message for both phones. The one difference, the iPhone's subtitle, is labelled and shown."
4. **Do:** Click after "Due date.", the end of the text message's first line, and type ` We’re here to help.` (the curly apostrophe is ⌥⇧]). Click the underlined ’, then **Replace with '**.
   - **They see:** the ’ underlined, and the line under the message jump to "UCS-2 · 3 parts". The flag says "’ isn't in the SMS character set." After the replace the flag is gone and the line reads "GSM-7 · 2 parts".
   - **Say:** "One curly apostrophe would send every text in the expensive encoding, with a third of the room. Stencil catches it where it's typed, and won't submit it."
5. **Do:** **Submit for review** → **Submit v1**.
   - **They see:** the dialog list Push and SMS and the sample sets; the badge turns **In review**.
6. **Do:** Switch to **Jordan**. **Review → Waiting on me → Statement ready v1 → Approve → Approve v1.**
   - **They see:** Priya's Card Used Abroad v1 waiting too. The review opens on the push and the text message as Maya wrote them, in the composer's look, with Preview one tab away. One approval stage, because alerts have their own chain; then the go-live moment.
   - **Say:** "Alerts go through the same maker-checker as documents."
7. **Do:** **Library → Payment Due Reminder → Usage.**
   - **They see:** Coral rendering v1 every day, a couple of thousand renders over 30 days, and 3 failed SMS renders about two weeks ago, under Recent failures. On the team's Usage page, Push and SMS have their own series in the channel split.
   - **Say:** "Every alert sent is on record, like every document: who, which version, which channel. Never the customer's data."

## Act 6 — Change it safely

*About 8 minutes · Maya, Jordan and Alex · changes data · moves the clock +15 days · needs Coral pinned to v2*

**Goal:** changes never surprise downstream systems, and a bad version can be stopped at once, by two people.

1. **Do:** Switch to **Maya**. Open the template's **Content** tab → **Edit** (a Draft "Based on v2"). At the end of "…APR is 21.99%." type ` The annual fee is {{Annual fee`, choose **Create**, set Type to **Currency**, press Enter, then type `.`
   - **Submit for review**, note `Added the annual fee.`, then **Submit v3**.
   - **They see:** "Contract changes — Breaking change: v3 adds required annual_fee (Currency)".
   - **Say:** "Stencil spots that this change would break Coral before anyone approves it."
2. **Do:** Switch to **Jordan**. **Review →** v3 (tagged Breaking). Turn on **Show changes**. Click **Approve**, tick **Set a sunset date for v2**, and pick **today + 14 days**. Then **Approve v3**.
   - The date defaults to 30 days out. Change it to 14; 30 breaks step 4.
   - **They see:** the new sentence highlighted against v2, with a "Changes only" toggle. The dialog says "Coral still renders v2 (last render today). It will keep working until …" and "Coral has to map annual_fee before it moves to v3."
   - **Say:** "The approver sees which systems are affected, and when, before committing."
3. **Do:** Demo pill → **Open simulator**. Look at **Notices**, open the Spring Travel offer, and **Send** to Olivia and Marcus.
   - **They see:** "v3 available"; notices for the new version and the scheduled sunset; a banner "Stencil released v3. It needs annual_fee mapped…"; still "Pinned to v2"; then "6 delivered", each marked "Newer: v3".
   - **Say:** "Coral keeps working on v2, and it's told what to do and by when."
4. **Do:** Demo pill → **+15 days**, then Esc. **Send to 2 customers** (they're still ticked).
   - **They see:** "v2 stopped rendering. Sends will fail." Then "0 delivered, 6 failed — Version 2 was sunset on … Version 3 is active. 410 version_sunset".
   - **Say:** "After the sunset, old versions stop with a plain reason. No silently wrong documents."
5. **Do:** Under "Map Annual fee to send", choose **Offer · Annual fee**, then **Relink to v3**. Tick Olivia and Marcus again (the picker resets), **Send**, and open Olivia's Web view.
   - **They see:** "Pinned to v3", "6 delivered", and "The annual fee is $95."
6. **Do:** Switch to **Jordan**. **Back to Stencil → Library → Balance Transfer Intro — Terms → Versions → v1 → Revoke v1**. Reason `Wrong intro APR in the legal notices.`, then **Start revoke**.
   - **They see:** "Coral rendered v1 N times… Once confirmed, its renders will fail immediately." Confirm is disabled: "You started this revoke. Another approver must confirm it."
   - **Say:** "There's an emergency stop, and no single person can pull it."
7. **Do:** Switch to **Alex Kim** on the same page. **Confirm revoke**, then **Confirm revoke** in the dialog. Open the simulator → **Balance Transfer** → Send tab → Olivia and Marcus → **Send**.
   - **They see:** Revoked, then "0 delivered, 4 failed — Version 1 was revoked on … Version 2 is active."
   - **Say:** "Once a second approver confirms, the bad version stops everywhere at once."

## Act 7 — Governance

*About 3 minutes · Alex and Taylor · no data changes*

**Goal:** every action is on record and exportable for compliance.

1. **Do:** As Alex: **Back to Stencil → Audit**.
   - **They see:** "Revoke started" by Jordan Ellis and "Revoked" by Alex Kim.
2. **Do:** Switch to **Taylor Nguyen**. Team switcher → **All teams** → **Audit**. Filter **Person → Jordan Ellis**, then **Export**. Clear the filter chip.
   - **They see:** a Team column; filters for Team, Person, Action, Template and Date; Jordan's events counted; a CSV download with When, Who, Team, Template, Version, Action and Details. Times are on the demo clock, in UTC.
   - **Say:** "Compliance gets the full record, across every team, in two clicks."
3. **Do:** **Usage → Consumers** (All teams).
   - **They see:** Coral and Deposits Online. Spring Travel v2 reads "Superseded · Sunset … renders fail"; Balance Transfer v1 reads "Revoked … renders fail".

## Act 8 — Access and admin

*About 11 minutes · Priya, Sam, Morgan, Alex, Riley, Jordan, Maya and Dana · changes data · moves the clock +16 days*

**Goal:** access is self-service but governed, and rules and approval chains are settings, not software releases.

1. **Do:** Switch to **Priya Raman**. Team switcher → **Deposits**. Open **Everyday Checking — Fee Schedule**.
   - **They see:** no New template button, and "View only" with no toolbar.
   - **Say:** "The same person can have different rights on different teams."
2. **Do:** Switch to **Sam Ortiz**. Open Spring Travel, then click SHARE. Do this before step 7, while Sam still has access.
   - **They see:** View only; SHARE still works and lists annual_fee; there's no Settings.
3. **Do:** Switch to **Morgan Lee**. On Request access: **Coral Offers → Request access → Author**, reason `I'm joining the spring campaign and need to draft its offer terms.`, then **Send request**.
   - **They see:** each team's Team Admin, then "Your request for Author access is waiting on Alex Kim."
   - **Say:** "People ask for access in the app, not through an IAM ticket."
4. **Do:** Switch to **Alex Kim**. Click the bell notification ("Morgan Lee asked for Author access to Coral Offers."). In **Settings › Access requests**, click **Approve** on Morgan, then **Approve as Author**.
   - **They see:** the sidebar card "Access requests pending", a strip "Morgan Lee gets Author access…", then "Approved by Alex Kim".
5. **Do:** Switch to **Morgan**.
   - **They see:** the Coral Offers Library, with New template.
6. **Do:** Switch to **Alex**. **Settings → Members**, then **Recertification**: click **Keep** for Jordan, Maya, Priya, Devon and Dana. **Not Sam.** Then **Inactivity**.
   - **They see:** "You can't change your own access."; recertification going from "0 of 6" to "5 of 6"; Devon Lin idle 110 days, due for auto-suspension.
   - **Say:** "Access reviews are built in, and every decision is audited."
7. **Do:** Demo pill → Days to advance `16` → **Advance**. Switch to **Sam**, then back to **Alex › Members**.
   - **They see:** Sam's message: "Your access to Coral Offers lapsed on …: it wasn't confirmed in the access review." In Members, Sam reads "Access lapsed" and Devon "Auto-suspended".
   - **Say:** "Access that nobody confirms simply runs out. No one has to remember to remove it."
8. **Do:** Switch to **Riley Brooks**. **Settings → Teams**, then **Content types**. In **Channel rules**, switch off "Disclosure on Email", read the strip, click **Turn off Email**, then switch it back on.
   - In **Approval chains → Add stage**: name `Legal reviewer`, reviewer **Dana Park · Coral Offers**, then **Add Legal reviewer stage**. Close Settings.
   - **They see:** "4 Active Disclosure versions stop rendering to Email…" before committing, and Now/After cards: "Dana Park will review Disclosure submissions from every team…"
   - **Say:** "Channel rules and approval chains are settings. Adding a Legal step doesn't need a software release."
9. **Do:** Switch to **Jordan**. **Review → Cash Back Welcome Bonus — Terms v3** → **Approve** → **Approve v3**.
   - **They see:** one stage on the stepper, then the go-live moment: v3 was submitted before the Legal stage existed.
   - **Say:** "A version keeps the approval steps it was submitted with. Changing the chain never moves work that's already in review."
10. **Do:** Switch to **Maya**. Open **Cash Back Welcome Bonus — Terms** → **Edit** → **Submit for review** → **Submit v4**.
11. **Do:** Switch to **Jordan**. **Review → Cash Back v4** ("Stage 1 of 2") → **Approve** → **Approve v4**.
    - **They see:** "v4 moves to Legal reviewer… isn't Active until the last stage approves."
12. **Do:** Switch to **Dana Park**. **Review → Cash Back v4** ("Stage 2 of 2") → **Approve v4**.
    - **They see:** the go-live moment, and v4 Active.
    - **Say:** "A two-stage approval, configured a minute ago, already enforced."

## Act 9 — Accelerators and reset

*About 5 minutes · Maya · changes data, then resets*

**Goal:** existing Word and PDF content, and Copilot drafts, come in fast with the rules still enforced.

1. **Do:** Switch to **Maya**. ⌘K → type `import` → Enter → **Import a file** → choose `spring-offer.docx`.
   - **They see:** a draft "Spring Balance Transfer Offer" with variable chips, the fees table, and an empty Legal notices section added. The rail opens on **Original**: Detected, Dropped, Kept as text, and the source "Dear {{First Name}},".
   - **Say:** "Existing Word content comes in as a governed draft, with a report of exactly what changed."
2. **Do:** In the rail: **Variables → Copilot prompt → Copy prompt**, then **Close**. Click at the end of "Terms apply to every transfer." and paste this Copilot answer:

   ```text
   ## Rates and fees

   Your purchase APR is {{purchase_apr}}, and it stays the same for the life of the offer.

   - No annual fee
   - No foreign transaction fee
   ```

   - **They see:** `{{purchase_apr}}` become a chip and the heading merge into the existing section. ⌘Z undoes the whole paste.
   - **Say:** "Teams can draft with Copilot, which the bank already approves, and Stencil turns the answer into a governed draft. No AI runs inside Stencil."
3. **Do:** **New template → Import a file** → choose `rate-change-notice.pdf`.
   - **They see:** a draft "Rate Change Notice" with 6 variables. The PDF's layout is dropped; its text and structure come in.
4. **Do:** Bell → **Mark all as read**.
5. **Do:** Demo pill → **Reset demo** → **Reset**.
   - **They see:** Maya's Library back to 8 templates, and the clock on "Real time". Ready for the next audience.

## Closing: what's next

Recap the six beliefs from the start, then be plain about what the prototype doesn't do yet. Saying it first builds more trust than being asked.

**Not built yet**

- Clone a template from a base template (R15)
- Batch rendering and high-volume PDF throughput (R19)
- Retention, review-by dates and tamper evidence (R21)
- Optional approval on the consumer's side (R24)
- State-specific language (R25)
- An endpoint for consumers to request a draft (R33)

**Stand-ins for production (R35)**

- The persona switcher in place of company sign-in (Entra); a header in place of PingFed
- A Next.js route in place of the Spring API; a config table for Fluxnova
- SQLite and local files in place of Azure SQL and Blob storage
- The Coral simulator in place of the real delivery system (UMP)
- PDF output is a close approximation

The business rules are written to carry over to the production API.

## Requirements coverage

Every requirement from the Discovery Brief (DB) and the Build Plan (BP), in their order, with where to show it.

| # | Requirement (source) | How Stencil answers it | Where to show it | Status |
|---|---|---|---|---|
| R1 | One controlled place for customer content (DB · Purpose and problem) | A Library per team; writing, review and rendering in one app | Library (Maya), Act 1 | Covered |
| R2 | Coral: a T&C disclosure linked to an offer (DB · Scope and first client) | Disclosure content type; Coral links an offer to it | Editor; simulator, Acts 2 and 4 | Covered |
| R3 | Works for any business and many teams (DB · Scope and first client) | Three teams, two consumers; content types, channels and approval chains are settings | Team switcher (Priya); Settings (Riley), Act 8 | Covered |
| R4 | Templates only, no customer data; Stencil renders; consumers can't author (DB · Guiding principles 1–3) | Documents are built on request and never stored; the consumer API can only read and render | Simulator; SHARE, Act 4 | Covered |
| R5 | Review in the tool; maker-checker (DB · Guiding principles 4; Controls and approvals) | Review queue; the author can't approve their own version | Review (Maya, Jordan), Act 3 | Covered |
| R6 | Automatic versioning at submit; consumers never see drafts (DB · Guiding principles 5; Versioning and lifecycle) | Six states; Versions tab with compare; Activity tab | Versions tab, Acts 1 and 3 | Covered |
| R7 | "One click" simplicity for non-technical users (DB · Guiding principles 6; BP · Experience principles) | Two clicks to typing; a slash menu; plain-language dialogs | New template (Maya), Act 2 | Covered |
| R8 | No AI inside the app; a Copilot prompt instead (DB · Guiding principles 7; AI roadmap) | The app writes a prompt to copy; a pasted {{key}} becomes a chip. Risk sign-off is still open | Editor rail (Maya), Act 9 | Covered |
| R9 | Numbers never retyped; customer vs offer variables (DB · Guiding principles 8; Content model and channels) | Typed, auto-formatted variables; Coral maps each to customer or offer data. Variables carry no customer/offer flag, and offer terms are still typed into the text | Variables rail; simulator, Acts 2 and 4 | Partial |
| R10 | One template, many channels; rules per content type (DB · Content model and channels) | Channel chips; a channel rules matrix; a disallowed channel is refused. Documents go to PDF, Web and Email; alerts to Push and SMS | Editor; alerts; Settings (Riley), Acts 2, 5 and 8 | Covered |
| R11 | Import Word, PDF or text as drafts (DB · Content model and channels) | Import a file, with an Original tab and an import report. No step where the author confirms it matches the original | New template (Maya), Act 9 | Partial |
| R12 | A Notion-like editor with draggable placeholders (DB · Content model; BP · The editor) | Draggable blocks; variable chips that can't be broken, inserted by drag, by typing {{ or by click | Editor (Maya), Act 2 | Covered |
| R13 | Blueprints with required sections; a starter gallery (DB · Content model and channels) | Required headings can't be deleted; Blank plus three starters for documents, and for alerts. Required variables aren't preset | Editor; Settings (Riley), Acts 2 and 8 | Partial |
| R14 | One version for all channels; approvers see each channel (DB · Content model and channels) | Email subject and preheader take variables; review has a tab per channel | Preview; Review (Jordan), Acts 2 and 3 | Covered |
| R15 | Clone from a base template (DB · Content model and channels) | Not built. It matters if offer terms stay written into the text | Roadmap | Not built |
| R16 | Render API: binary by default, base64 opt-in, email as JSON, validation (DB · Rendering; BP · Preview and rendering) | A render endpoint whose errors name the problem | SHARE; Coral results, Acts 3 and 4 | Covered |
| R17 | Preview with sample data that matches production (DB · Rendering) | One render function for preview, review and Coral; named sample sets | Preview (Maya), Act 2 | Covered |
| R18 | A log of every render, with no customer data (DB · Rendering) | Records template, version, consumer, channel and outcome, never the values | Usage, Acts 4 and 7 | Covered |
| R19 | Batch rendering; PDF throughput (DB · Rendering; Timeline and risks) | Out of the prototype's scope | Roadmap | Not built |
| R20 | Pin, sunset, and a revoke that needs a reason and two people (DB · Versioning and lifecycle) | Consumers stay pinned; a sunset date set in the Approve dialog; a two-person revoke | Versions (Jordan, Alex); simulator, Act 6 | Covered |
| R21 | Retention, review-by dates, tamper evidence (DB · Versioning and lifecycle) | For production | Roadmap | Not built |
| R22 | Approval chain as configuration (DB · Controls and approvals) | A chain editor; a Legal stage added live. Versions already in review keep the stages they were submitted with | Settings (Riley), Act 8 | Covered |
| R23 | Side-by-side redline; comments pinned to blocks (DB · Controls and approvals) | Redline with "Changes only"; comments in the margin | Review (Jordan), Acts 3 and 6 | Covered |
| R24 | Optional approval on the consumer's side (DB · Controls and approvals) | Not built | Roadmap | Not built |
| R25 | State-specific language (DB · State- and regulation-specific language) | Parked; there's only a US-state variable type | Roadmap | Not built |
| R26 | Teams see only their own content; access per team (DB · Teams and access control) | Each team is its own space; View only mode elsewhere | Team switcher (Priya), Act 8 | Covered |
| R27 | Roles, including Auditor, Legal reviewer, and a Platform Admin who can't edit (DB · Teams and access control; BP · Personas and permissions) | One central permission check for every action | Persona switcher, Acts 1, 7 and 8 | Covered |
| R28 | Access requests in the app, with no self-approval (DB · Teams and access control) | Request access; Access requests; Teams | Request access (Morgan); Settings (Alex), Act 8 | Covered |
| R29 | Recertification, inactivity expiry, detecting team moves (DB · Teams and access control) | Unconfirmed access lapses; flagged at 90 days idle, suspended at 120; every grant audited. Team moves aren't detected | Settings (Alex), Act 8 | Partial |
| R30 | Consumer API: search with paging, get, preview, render (DB · Consumer integration and API surface) | Search, get (contract and JSON Schema) and render work. No paging, no consumer preview with dummy data, and consumers aren't limited to their team's templates | SHARE (Sam), Acts 3 and 8 | Partial |
| R31 | The offer-to-template link lives in the consumer (DB · Consumer integration and API surface) | Coral searches, links and pins Active versions in its own tables | Simulator, Act 4 | Covered |
| R32 | Lifecycle events; "who uses v3?" (DB · Consumer integration; BP · Usage) | A notices API; Coral's Notices page; the Usage dashboard | Usage; simulator, Acts 4 and 6 | Covered |
| R33 | An endpoint for consumers to request a draft (DB · Consumer integration and API surface) | Later; not built | Roadmap | Not built |
| R34 | Status always visible; consequences shown before you commit (BP · Experience principles) | One status badge everywhere; dialogs name the consumers affected | Approve, sunset and revoke dialogs, Acts 1 and 6 | Covered |
| R35 | Production integrations (DB · Architecture overview; BP · Out of scope and caveats) | Stand-ins for sign-in, the API layer, storage and delivery; PDF output is an approximation | Closing | Stand-in |

Summary: 23 covered, 5 partial, 6 not built (R19 was out of the prototype's scope), 1 stand-in.

## Glossary

| Term | Meaning |
|---|---|
| Template | Reusable customer content with a permanent ID, such as UC-4F7K2Q. |
| Variable (chip) | A typed blank, such as APR, filled in for each customer. |
| Version | A frozen, numbered snapshot made when a draft is submitted. |
| Draft, In review, Changes requested | Being written, waiting for approval, or sent back with a reason. |
| Active | The approved version consumers use now. |
| Superseded | An older approved version that still works for consumers pinned to it. |
| Pin and relink | A consumer stays on its version until it chooses to move. |
| Sunset | The date after which a superseded version stops working. |
| Revoke | An emergency stop that takes two approvers. |
| Maker-checker | The author can never approve their own version. |
| Content type | A blueprint: required sections, allowed channels and the approval chain. Disclosure makes documents; Alert makes alerts. |
| Alert | A template with a push notification and a text message, instead of a document. It stays an alert for life. |
| Channel | PDF, Web or Email for a document; Push or SMS for an alert. |
| Sample set | Named dummy data used for preview and review. |
| Render and consumer | A consumer system such as Coral asks Stencil to fill in a template for one customer. Nothing is stored. |
| Contract and breaking change | The variables a consumer must send. Adding a required one breaks the contract. |
| Team (space) | A business line's private area. Platform Admin and Auditor also see "All teams". |
| Recertification | A Team Admin's regular review to keep or remove each member. |
| Simulator, Demo pill, demo clock | Demo-only tools that stand in for Coral, reset the data and move the date forward. |

## Timing, cuts and rules

- **Full run, about 57 minutes:** Act 1 (3) · Act 2 (6) · Act 3 (6) · Act 4 (6) · Act 5 (5) · Act 6 (8) · Act 7 (3) · Act 8 (11) · Act 9 (5), plus a few minutes for the story and closing.
- **The 20-minute cut:** tell the story, then Acts 2 and 3, Act 4 steps 1–3, and Act 6 steps 1–5. Close with the roadmap and reset. This covers authoring, maker-checker, delivery and safe change.
- **Independent pieces:** Acts 1 and 9 work on their own, as Maya, at any point.

Order rules:

- Each act builds on the last. Run them in order from a fresh reset.
- Leave Cash Back v3 for Act 8, and Card Used Abroad v1 for Act 5.
- Run Act 5 before the first clock jump.
- Add the Legal reviewer stage last; it gates Disclosure versions submitted after it.
- Sunset v2 at most 14 days out.
- Sam's step and the recertification Keeps come before the +16-day jump.
- Skipped Act 6? Advance 31 days in Act 8 instead of 16.
- Mid-demo reset: Demo pill → Reset demo → Reset.

## Rough edges on stage

The dry run found no blocking bugs. These are worth knowing so you can name them before anyone asks.

- **The Share sheet's email response example is fixed sample text.** On Spring Travel it mentions an APR change on March 4, 2027. Say it's an example of the response shape, not this template's email.
- **The Share sheet shows "Loading integration details" for about a second.** Pause a beat before talking through it.
- **Importing the PDF adds a second "Rate Change Notice".** There's no duplicate-name warning yet. Reset clears it.
- **Imported placeholders come in as Text.** For example, "Offer end date" arrives as Text rather than Date. Change the type in the Variables rail if someone asks.
- **After clock jumps, relative times read as weeks ago.** Actions from minutes earlier show "1 month ago", and Members shows people last active "31 days ago". Explain that the demo clock has moved forward.
