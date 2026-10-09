> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# UCOMP Prototype — Build Plan for Claude Code

Oct 3, 2026 · @Sri

## Overview

Build a clickable, persistent prototype of the UCOMP content app that takes one disclosure from a blank page to "live" with a mocked consumer. The editor and the overall feel matter most: someone who has never seen the app should understand it without onboarding.

**How to use this doc**

- Read it with the **UCOMP Content Platform — Discovery Brief** (business background, decisions, open questions) and the three Wispr Flow screenshots (look-and-feel reference).
- This doc defines **prototype scope**. Where it differs from the brief's release 1 scope, this doc wins for the prototype. For example, the prototype mocks delivery and skips real login.
- It says what the app must do and why, not how to build it. Write your own implementation plan; the Architecture section lists the few hard constraints.
- All data is fictional. No real customer, account or bank content anywhere.

**What success looks like**

- Every feature in the brief can be clicked through, as different personas, from a new template to a live one.
- A first-time user can create a disclosure and submit it for review without asking a question.
- One click resets the demo to a clean, seeded state.

## Business context

The bank has no single, controlled place to create customer content like disclosures and notifications. UCOMP is that place: business teams author templates there, and other systems call UCOMP to render them with customer data.

**The problem today.** Business and marketing teams write content in Word or ad hoc templates and publish it with no central controls. Teams interpret requirements differently, disclosures go out with wrong information, and invalid notifications reach customers. A disclosure is legal text: if an offer says "spend $1,000, get $200," the disclosure must say exactly that.

**How UCOMP works.**

- UCOMP stores **templates only**: content with typed placeholders (variables) like first name, APR or state. It never stores customer data or rendered documents.
- A consumer system (the first is **Coral**, the bank's offers platform) calls UCOMP with a template ID and the customer's values. UCOMP renders the document at runtime and returns it. Nothing is kept.
- One template can serve millions of customers. Rendering is where the volume is; storage stays tiny.
- The consumer, not UCOMP, decides which template goes with which offer.

**First client.** The Coral business team creates a terms-and-conditions disclosure in UCOMP, gets it approved, and Coral links it to an offer. UCOMP itself must stay business-agnostic: Coral is just the first team on the platform.

**Users.** Business users who are not technical. The platform only works if they prefer authoring here to Word.

**What this prototype must prove.**

1. The editor is easy enough that business users would choose it.
2. The lifecycle (draft, review, approve, live, supersede, retire) is understandable at a glance.
3. Teams and roles feel natural: people see only their team's content, with the right level of access.
4. Sri can watch real users click through it and see which features they actually use, before deciding where to spend deep-dive time.

## Experience principles

User experience is the top priority, ahead of feature completeness. If a feature can't be made obvious, simplify it before adding explanation.

1. **Self-evident, no onboarding.** A new person opens the app and knows what to do. No tours, no coach marks, no instructional hint text sprinkled across screens. Rely on familiar patterns instead: a slash menu, drag handles on hover, chips for variables, clear button labels.
2. **The editor is the product.** Getting the editor right is about 70% of the prototype's value. Spend the most design and build effort there.
3. **One-click philosophy.** Every feature should cut steps. Getting from the library to typing in a new template should take two clicks.
4. **Status is always visible.** Any template or version shows its state (Draft, In review, Active, Superseded, Revoked) the same way everywhere: same badge, same color, same wording.
5. **Empty states are actions, not instructions.** An empty library shows the starter gallery, not a paragraph about how to create templates.
6. **Explain only when blocked.** When something is unavailable (for example, approving your own work), say why in a few words, right where the user tried. That's the one place short explanatory text belongs.
7. **Consequences before commitment.** Actions that affect consumers or can't be undone (approve, sunset, revoke) show what will happen, in plain language, before confirming.
8. **Calm density.** Generous whitespace, few colors, one primary action per screen.

## Look and feel

Match the *feel* of the Wispr Flow desktop app screenshots: warm, calm, editorial and tactile. It's not minimalism and not neobrutalism; it's a soft, modern desktop app with a few crafted details. Take the feel, not the brand.

**What to take from the screenshots**

| Element | What it looks like in Flow | Use it in UCOMP for |
| --- | --- | --- |
| Canvas | Warm stone/off-white app background; content sits in one large rounded panel (about 20–24px radius) with a hairline border, inset from the window | The whole app shell |
| Sidebar | Line icon + label per item, relaxed spacing; active item is a soft filled rounded shape, not a loud color; utility links grouped at the bottom; one dismissible card | Main navigation (see App map) |
| Type | Elegant serif for display titles ("My Transforms", "Connectors"); clean sans for UI; small uppercase, letter-spaced labels; big numerals for stats | Page titles in serif, UI in sans, metric labels in tracked caps |
| Surfaces | Light cards, 1px warm-grey border, 12–16px radius, almost no shadow, hairline dividers | Template cards, panels, review blocks |
| Color | Warm neutrals; one deep teal-green accent for data and active states; mint tints for scales; black pill for the primary button; white bordered secondary buttons | Accent = placeholder green (TD later); one primary action per screen |
| Small details | Keycap chips (⌥ Opt, 1), black "Beta" tag, lavender "Pro" pill, dark pill toggles | Shortcut hints on menus, status badges, toggles |
| Data viz | Semicircle gauge, horizontal bars with percent pills, calendar heatmap with a teal scale and a More/Less legend | The Usage page |
| Settings | Large centered modal with its own grouped left nav and small uppercase section labels | Team and platform administration |
| Signature | A circular text ring ("SHARE · SHARE ·") wrapped 360° around an icon button | See below |

**The signature detail.** Use the circular text ring once or twice so it stays special. Best fit: the **Share** button on an Active template, which opens the integration panel for consumer teams. A second option is the moment a version goes live, as a brief celebratory state. A slow rotation on hover is fine; respect reduced-motion settings.

**What not to copy.** Flow's logo, product names, illustrations, hero imagery or copy. Don't clone layouts pixel for pixel.

**Theming for TD later.** Sri will later ask a Claude Code session on his work laptop to apply TD's style guide. Make that a token swap, not a rewrite:

- Every color, radius, shadow, spacing step and font goes through design tokens (CSS variables feeding Tailwind and the shadcn/ui theme). No hard-coded hex values in components.
- Use a placeholder green-teal accent for now.
- Use free fonts: a display serif (for example Instrument Serif or Fraunces) and a UI sans (for example Inter or DM Sans).
- Light theme only. Desktop-first: it must look right from 1280px wide upward. Mobile isn't needed.

## Personas and permissions

There's no real login. A persona switcher in the top-right profile menu changes who you are, and the whole app re-renders with that person's teams and permissions. That's how Sri will show stakeholders how different people see the app.

**Roles.** Access is per team. A person can hold several roles on a team and different roles on different teams.

- **Viewer:** sees the team's templates, versions and integration details.
- **Author:** creates and edits drafts, imports files, manages variables, submits for review.
- **Approver:** reviews, approves or requests changes, sets sunset dates, revokes.
- **Team Admin:** manages the team's members, access requests and recertification.
- **Platform Admin** (cross-team): manages teams, content types, channel rules and approval chains. Can view all content but never edit it.
- **Auditor** (cross-team): read-only across every team, with the full audit log.

**Seed personas** (fictional)

| Persona | Teams and roles | What it demonstrates |
| --- | --- | --- |
| Maya Chen | Coral Offers: Author | Single-team author; the main character of the demo |
| Jordan Ellis | Coral Offers: Approver | Single-team approver; reviews Maya's work |
| Alex Kim | Coral Offers: Team Admin, Approver | Membership, access requests, recertification; second approver for revokes |
| Priya Raman | Coral Offers: Author · Deposits: Viewer | Multi-team user with different access per team |
| Sam Ortiz | Coral Offers: Viewer | Read-only stakeholder; also stands in for a Coral engineer using the integration panel |
| Riley Brooks | Platform Admin | Configures the platform; cannot edit templates |
| Taylor Nguyen | Auditor | Sees everything, changes nothing |
| Morgan Lee | No team yet | First-time user who must request access |

**Permission matrix**

| Action | Viewer | Author | Approver | Team Admin | Platform Admin | Auditor |
| --- | --- | --- | --- | --- | --- | --- |
| View team templates and versions | Yes | Yes | Yes | Yes | All teams | All teams |
| Create, edit, import, manage variables | — | Yes | — | — | — | — |
| Submit for review | — | Yes | — | — | — | — |
| Comment during review | — | Yes | Yes | — | — | — |
| Approve or request changes | — | — | Yes, never on a version they authored | — | — | — |
| Set sunset date | — | — | Yes | — | — | — |
| Revoke | — | — | Start or confirm; confirmer must be a different approver | — | — | — |
| Use integration panel | Yes | Yes | Yes | Yes | Yes | Yes |
| Manage members, access requests, recertification | — | — | — | Yes, never their own request | — | — |
| Manage teams, content types, channel rules, approval chains | — | — | — | — | Yes | — |
| View audit log | — | — | — | Own team | All teams | All teams |
| Request access to a team | Anyone |  |  |  |  |  |

**Behavior rules**

- Enforce permissions on the server through one central check, and make the UI agree with it. Actions a persona can't take are hidden, unless seeing them disabled helps (for example, Approve on your own version, with a one-line reason).
- Read-only templates open in the same editor with no toolbar, no drag handles and no editing, plus a small "View only" badge in the header.
- A multi-team persona switches teams with a team switcher at the top of the sidebar. Each team is its own space: library, review queue, usage.

## App map

The app has a team-scoped sidebar, a few top-level pages, a template workspace where most work happens, and a settings modal for administration. Demo-only tools live in a separate drawer so they never mix with the product.

**Shell**

- **Sidebar, top:** the team switcher (team name and icon). It lists the persona's teams; Platform Admin and Auditor also get "All teams".
- **Sidebar, main:** Library, Review (with a count badge for items waiting on me), Usage, Audit (only for roles that can see it).
- **Sidebar, bottom:** Settings (opens the settings modal for Team Admins and Platform Admins) and Help. One dismissible card slot, Flow-style, used for something actionable: "Recertification due" for a Team Admin, or "Access request pending" for a new user.
- **Top-right:** search (⌘K), notifications bell, and the profile menu with the persona switcher.
- **Demo pill**, bottom-right: opens the demo drawer (reset, demo clock, consumer simulator). Style it so it's clearly not part of the product, for example a dashed outline.

**Screens**

| Screen | What it's for | Key contents |
| --- | --- | --- |
| Library | Find and start templates | Search, status filters, rows with name, status badge, active version, last edited, owner; **New template** as the one primary button |
| New template | Start in two clicks | Starter gallery: Blank first, then a few example disclosures; picking one opens the editor |
| Template workspace | Everything about one template | Header with name, template ID, status and version switcher; tabs for Content, Versions, Usage, Activity; the **Share** signature button once a version is Active |
| Editor | Author content | See "The editor" |
| Versions | History and lifecycle actions | Timeline of versions with state, author, approver and dates; compare any two; set sunset date; revoke |
| Review queue | Work waiting on me | Tabs: Waiting on me, Submitted by me, Recently decided |
| Review screen | Decide on a version | See "Review and approval" |
| Usage | Who renders what | Team dashboard in the style of Flow's Insights page; per-template view in the workspace |
| Integration panel | Hand-off to consumer teams | Slide-over opened by Share: template ID, version, variable contract, sample request |
| Audit | Who did what, when | Filterable event table |
| Notifications | What changed for me | Popover from the bell |
| Settings modal | Administration | Flow-style modal with grouped left nav (Team / Platform) |
| Request access | First-time user with no team | Choose a team and role, add a reason, submit; then a pending state |
| Consumer simulator | Mock "going live" | Demo-only; styled as an outside system ("Coral — simulated") |

**Nice to have:** a ⌘K command palette to search templates and jump between pages.

## The editor

The editor is where everything starts and about 70% of the prototype's value. Think Notion for regulated content: a calm document page, blocks you can drag, and variables that are impossible to break. Build it on TipTap using only open-source extensions; where a paid TipTap Pro extension would be needed (for example a drag handle), build a lightweight equivalent instead.

### Layout

- **Canvas:** a document-like page at a comfortable reading width (about 720–800px), centered in the main panel.
- **Header bar:** template name (click to rename), status badge, version label ("Draft of v3"), a quiet save indicator ("Saved"), channel chips (PDF, Web, Email), **Preview**, and the one primary button, **Submit for review**.
- **Right panel:** Variables by default. When Email is on, an Email details group sits at the top of the panel: subject and preheader, both of which accept variables.
- **Preview:** opens a split view, editor left and rendered output right (see "Preview and rendering").

### Blocks

- Paragraph, headings (three levels), bulleted and numbered lists, table, callout (a boxed notice), divider.
- **Required sections** come from the content type. For a disclosure: Offer details, Rates and fees, Legal notices. Their headings can't be deleted or renamed; their content is free. Trying to delete one shows a short inline "Required for disclosures".
- Inline formatting: bold, italic, underline, link.

### Interactions

- Typing **/** opens a block menu with keycap shortcut chips.
- Hovering a block shows a **drag handle (⋮⋮)** to reorder and a **+** to insert a block below, the Notion pattern.
- Selecting text shows a small floating format toolbar.
- Undo and redo work everywhere, including variable insertions.
- Paste from Word keeps headings, lists, tables and bold, and drops styling.
- The only placeholder text allowed is a faint one on an empty line, like "Type / for blocks". No other instructional copy.

### Variables

Variables are typed, inline, atomic chips. Users can't type inside them or half-delete them.

- **Three ways to insert:** drag a variable from the panel into the text; type **{{** to open a searchable picker (with "Create variable" at the bottom); or click a variable in the panel to insert it at the cursor.
- **Chip:** a pill with a type icon and the variable's label. Clicking it shows a popover with label, key, type, sample value and where else it's used. Backspace removes the whole chip.
- **Panel:** each variable shows type icon, label, key (small monospace), required toggle and usage count. Unused variables appear muted. **New variable** is an inline row: type a label, the key is generated in snake\_case (editable), pick a type, set required and a sample value.
- **Types and formatting:**

| Type | Example key | Renders as |
| --- | --- | --- |
| Text | first\_name | As given |
| Currency | annual\_fee | $1,000.00 |
| Percent | purchase\_apr | 21.99% |
| Date | offer\_end\_date | March 4, 2027 |
| Number | bonus\_points | 20,000 |
| US state | home\_state | New Jersey |

- Renaming a label updates every chip. Changing a key, a type, or the required flag on a template that already has an Active version is a **contract change**: flag it in the panel and again at review (see "Template lifecycle").
- Deleting a variable that's in use asks whether to remove its chips too.

### Starting points

- **Starter gallery:** Blank first, then three or four example disclosures (for example "Card offer terms", "Rate change notice", "Fee schedule"). Blank still includes the content type's required sections, with the cursor in the first one.
- **Import:** upload .docx, .pdf or .txt. The file becomes a new draft. Word keeps headings, lists, tables and bold; text is plain; PDF is text only. Any {{placeholder}} in the file becomes a variable chip, created as Text for the author to retype. A **Compare with original** toggle shows the source file beside the draft.
- **Copy prompt for Copilot** (Sri's idea; no AI inside the app): a button that opens a generated prompt describing the template's purpose, required sections and variables in {{key}} syntax. The user pastes it into the Copilot on their laptop and pastes the result back; pasted {{key}} tokens become chips.

### Drafts and editing rules

- Autosave on every change. Draft saves are recorded in the activity log but never create a version number.
- Editing an Active template creates a new draft from it ("Draft of v3"). Only one open draft per template.
- Review comments appear in the margin beside the blocks they're attached to, and the author can resolve them there.
- Non-authors get the same page read-only: no toolbar, no handles, no panel editing, and a small "View only" badge.
- Store content as TipTap JSON. A variable node holds only its key; label and type come from the template's variable list.
- Fully keyboard-navigable, with visible focus states.

## Preview and rendering

All rendering goes through one server-side render function that stands in for the future Java API. The editor preview, the review screen and the consumer simulator all call it, so what an approver sees is exactly what a customer would get.

**Channels**

| Channel | How the preview looks |
| --- | --- |
| PDF | Letter-size pages with margins, page breaks and page numbers; a Download PDF action. An approximation is fine: the production renderer will be different. |
| Web | Responsive HTML as it would appear on the web or in the app, with a desktop / mobile width toggle |
| Email | An email-client frame: sender, subject, preheader snippet, then the body |

Only the channels allowed by the content type can be turned on. Disclosures allow PDF, Web and Email.

**Sample data sets**

- Each version carries named sample data sets. Defaults are generated from the variables' sample values: "Typical customer", "Long name and maximum values", "Minimum values". Authors can edit them or add more.
- The preview has a sample-set switcher next to the channel tabs. Values are formatted by type.
- Approvers review against these same sets, so the approval records what was seen.

**Render behavior** (shape it like the future API)

- One route, for example `POST /api/v1/templates/{templateId}/render`, taking a version, a channel and the variable values.
- Responses:
  - PDF returns binary with `application/pdf` by default.
  - Web returns HTML.
  - Email returns JSON: subject, preheader, HTML body, text body.
  - Base64 is available only as an opt-in, for consumers that can't accept binary.
- **Validation, with errors that name the problem:**
  - Missing required variables: list them by key.
  - Wrong type: name the variable and the expected type.
  - Channel not allowed for the content type: reject.
- **Version rules:**
  - Consumers always ask for a specific version (pinning).
  - A Superseded version still renders, with a "newer version available" flag in the response.
  - A Superseded version past its sunset date, or a Revoked version, returns an error that says what happened and which version is active. For example: "Version 1 was sunset on March 1, 2027. Version 2 is active."
- **Render log:** every render writes an entry with template, version, consumer, channel, timestamp, correlation ID and outcome. Never the values. CMS previews are tagged as previews and don't count toward usage.

## Template lifecycle

A template is a stable ID with numbered versions. A version number is assigned only at submit; after that, the version is frozen, and any further change becomes a new version. The audit trail matters more than tidy numbering.

**States and badges**

| State | Meaning | Renders for consumers? | Badge |
| --- | --- | --- | --- |
| Draft | Being written; autosaved; no version number | No (preview only) | Neutral |
| In review | Submitted, frozen, waiting on approvers | No (preview only) | Amber |
| Changes requested | Returned by an approver; kept read-only as a record | No | Neutral with a return icon |
| Active | The current approved version | Yes | Accent green |
| Superseded | A newer version is Active; consumers pinned here keep working | Yes, until its sunset date | Muted, with "Sunset Mar 1" when set |
| Revoked | Stopped for an emergency | No, immediately | Red |

**Transitions**

| From | Action | Who | To | What happens |
| --- | --- | --- | --- | --- |
| — | Create (Blank, starter or import) | Author | Draft | Opens in the editor |
| Draft | Submit for review | Author | In review | Next version number assigned; contract changes computed; approvers notified |
| In review | Request changes, with a reason | Approver, not the author | Changes requested | A new Draft is created from it, carrying the comments; resubmitting gets the next number |
| In review | Approve | Approver(s) per the approval chain, never the author | Active | The previous Active becomes Superseded; consumers on it are notified |
| Active | Edit | Author | New Draft ("Draft of v3") | The Active version keeps serving |
| Superseded | Set sunset date | Approver | Superseded, sunset scheduled | Consumers still rendering it are notified with the date and the contract changes |
| Superseded | Sunset date passes (demo clock) | System | Superseded, sunset passed | Renders fail with a clear error |
| Active or Superseded | Revoke, with a reason | One approver starts, a different approver confirms | Revoked | Renders fail immediately; consumers notified |

**Superseding: pin, sunset, revoke** (decided)

- **Pin (default):** consumers keep rendering the version they linked until they relink. Nothing changes silently and production never breaks.
- **Sunset:** an approver sets an end date on a superseded version, giving consumer teams notice to upgrade on their own schedule.
- **Revoke:** emergencies only, such as wrong legal text. Rendering stops at once.

**Contract changes.** A version's variable list is the consumer's API contract. On submit, compare it with the current Active version:

- **Breaking:** a required variable added; a variable removed; a key renamed; a type changed; optional made required.
- **Non-breaking:** an optional variable added; a label changed.

Show contract changes in the submit dialog, on the review screen, in "new version available" notifications, in sunset notices, and in the integration panel. For example: "v2 adds required `annual_fee` (Currency)."

**Consequences before commitment.** Approve, sunset and revoke dialogs say who is affected, in plain words, using the render log. For example: "Coral still renders v1 (last render today). It will keep working until the sunset date."

## Review and approval

All review happens inside UCOMP, never in email. The person who submitted a version can never approve it. The review screen should let an approver decide confidently in a couple of minutes.

**Submit dialog.** Shows the version number about to be assigned, enabled channels, sample data sets, and contract changes compared with the Active version. It has an optional note to reviewers and a **Submit v2** button.

**Review queue.** Three tabs:

- **Waiting on me:** the count also appears on the sidebar badge.
- **Submitted by me.**
- **Recently decided.**

Rows show template, version, author, when submitted, the approval stage, and a "Breaking change" badge when the contract changes.

**Review screen**

- **Left:**
  - The rendered output, with the channel tabs and the sample-set switcher.
  - A toggle to a redline view: a block-level diff against the Active version, with additions underlined in green and removals struck through in red, plus a "Changes only" filter.
- **Right, the decision panel:**
  - The approval-chain stepper.
  - Contract changes.
  - Comment threads.
  - **Approve** (primary) and **Request changes**.
- **Comments:** click a block or select text to comment. Threads attach to the block, support replies and can be resolved. The author sees them in the editor margin.
- **Request changes:** needs a short reason, which becomes a comment.
- **Approve dialog:**
  - Spells out the consequences, for example: "v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks."
  - Offers to set a sunset date for the previous version in the same step.
- **Going live:** the moment a version becomes Active is a good place for the signature ring as a brief, quiet celebration.
- **Maker-checker:** the submitting author sees Approve disabled, with one line: "You submitted this version."

**Approval chain as configuration.** Release 1 uses a single stage. Store the chain as configuration, not code, so Sri can show it growing:

- The Platform Admin edits a table of content types and their ordered stages. Each stage has a name and who approves it. The default is Disclosure → "Team approver".
- With more than one stage, approvals happen in order and the stepper shows progress.
- Stretch: seed a cross-team "Legal reviewer" persona (Dana Park) so a Legal stage can be added and demoed live.

## Going live (mocked)

The lifecycle should end with Sri seeing a disclosure reach customers. Delivery is mocked through a consumer simulator that stands in for Coral. The Usage page and the integration panel show the UCOMP side of the same story.

### Consumer simulator (demo only)

The simulator represents Coral's own system, so style it as an outside app ("Coral — simulated") and open it from the demo drawer. It respects the real boundary: the offer-to-template link and all customer data live in the simulator's own tables, never in UCOMP's tables or render log.

- **Offers:** a few fictional offers, for example "Spring Travel Rewards — spend $1,000 in 3 months, get $200 back".
- **Link a template:** pick a template with UCOMP's search (by name or ID). Only Active versions are offered, and the link pins that version.
- **Map values:** each template variable maps to a customer or offer field in the simulator. Unmapped required variables block sending, and the block names them.
- **Send to customers:** choose a handful of fictional customers (name, state, APR). The simulator calls the render route once per customer and shows a results grid: customer, channel, status (Delivered (mock) or Failed, with the error).
- **Customer view:** click a result to see the disclosure as the customer would, in a phone frame (app) or an inbox (email), or open the PDF.
- **Upgrade path:**
  - When a newer version goes Active, the linked offer shows "v2 available" with its contract changes.
  - Relinking walks through mapping any new required variables.
  - After a sunset date passes or a revoke, sending fails with the render error.

### Usage

Take the layout cues from Flow's Insights page.

- **Team dashboard:**
  - Stat cards with big numerals and tracked-caps labels: renders this month (with a trend pill), active templates, consumers, versions nearing sunset.
  - A calendar heatmap of daily render activity, using the accent scale and a More/Less legend.
  - Horizontal bars of renders by consumer.
- **Consumers table:** consumer, template, version, renders, last render, and tags like "On superseded v1 · sunset in 6 days".
- **Per-template Usage tab:** which consumers render which version. The same data feeds the consequence text in the approve, sunset and revoke dialogs.
- All numbers come from the render log. Seed about 90 days of synthetic render history so the charts aren't empty on first load.

### Integration panel

Opened by the **Share** signature button on an Active template. It's how a consumer team learns to call the template.

- Template ID, Active version, enabled channels.
- The variable contract as a readable table and as a copyable JSON schema.
- A sample render request and the response formats: binary PDF by default, JSON for email, base64 on request.
- "What changed since" a chosen older version, for teams upgrading from a pinned version.
- Copy buttons on everything.

## Teams, access and administration

Access is managed inside the app (decided for release 1). The real login provider only gets people through the door, and teams and roles live in UCOMP. The prototype should make that feel simple and trustworthy.

**Requesting access** (Morgan, no team yet)

- Morgan sees a clean screen with no hint text: available teams, each with a one-line description and its admin.
- Pick a team and a role (Viewer, Author or Approver), add a short reason, submit. A pending state replaces the form.
- The Team Admin gets a notification and a sidebar card. On approval, Morgan's next view shows the team. On denial, Morgan sees the admin's note.

**Settings modal** (Flow-style, grouped left nav, a small version label at the bottom)

| Group | Page | Who | What it does |
| --- | --- | --- | --- |
| Team | Members | Team Admin | Names, roles, last active, date added; edit roles; remove |
| Team | Access requests | Team Admin | Approve or deny with a note; never their own request |
| Team | Recertification | Team Admin | Quarterly review: Keep or Remove per member, progress like "4 of 6 confirmed"; unconfirmed access lapses at the deadline (demo clock) |
| Team | Inactivity | Team Admin | Members with no login for 90 days are flagged, then suspended |
| Platform | Teams | Platform Admin | Create a team and assign its first Team Admin |
| Platform | Content types | Platform Admin | Required sections and allowed channels; Disclosure is the only seeded type |
| Platform | Channel rules | Platform Admin | A content type × channel matrix of what's allowed |
| Platform | Approval chains | Platform Admin | Ordered approval stages per content type |

The Platform Admin can open any template but never edit it. The editor is read-only for them.

**Auditor.** Gets "All teams" in the switcher and read-only access everywhere, including the Audit page across teams.

**Audit log**

- **Events to record:**
  - **Templates:** template created; draft activity (grouped per editing session); submitted; commented; changes requested; approved; sunset set or passed; revoke started and confirmed.
  - **Access:** requested, granted or denied; role changed; recertified.
  - **Platform:** configuration changed.
- **Columns:** when (demo clock), who, team, template and version, action, details.
- **Filters:** team, person, action, date. A CSV export is nice to have.

**Notifications** (bell popover, unread dot, mark as read)

- Review requested, decision made, comment added, version went Active.
- Access request waiting, recertification due.
- Consumer-facing notices (new version available, sunset scheduled) appear inside the consumer simulator, since that's where Coral would see them.

## Seed data

The seed should make every feature visible on first load, with every lifecycle state present, while leaving the main demo story (creating a new disclosure from scratch) untouched. Everything is fictional.

**Teams**

- **Coral Offers:** card offer disclosures. Maya, Jordan, Alex, Priya and Sam belong here.
- **Deposits:** savings and checking disclosures. Priya is a Viewer; the other members are seeded, non-switchable users.
- **Card Statements:** statement inserts. No switchable persona belongs here, which shows that teams are isolated.

**Coral Offers templates** (so every state is on screen)

| Template | Versions and state | Why it's there |
| --- | --- | --- |
| Balance Transfer Intro — Terms | v1 Superseded (sunset in 21 days, Coral still renders it); v2 Active | Pin and sunset, the upgrade path |
| Cash Back Welcome Bonus — Terms | v2 Active; v3 In review, submitted by Maya, with a breaking contract change | Jordan's review queue |
| Annual Fee Waiver — Terms | v1 Changes requested; open Draft with one resolved and one open comment | The return-for-changes loop |
| Holiday Points Promo — Terms | v1 Revoked (reason: wrong bonus amount); v2 Active | Revoke history |
| Rate Change Notice | v1 Active, created from a starter | A simple, settled template |

Add two or three templates each for Deposits and Card Statements, in Active and Draft.

**Variables used across seeds**

- Customer values: `first_name` and `last_name` (Text), `purchase_apr` (Percent), `home_state` (US state). All required.
- `offer_end_date` (Date, optional).
- `annual_fee` (Currency), the variable whose addition causes the breaking change.

**Content style.** Offer terms are written into the text (the way the business is leaning); customer values are variables. For example: "Hi {{first\_name}}, spend $1,000 on purchases in your first 3 months and earn a $200 statement credit. Your purchase APR is {{purchase\_apr}}." Keep the legal prose plausible and short.

**Starter gallery:** Blank, Card offer terms, Rate change notice, Fee schedule.

**Consumers** (UCOMP's registry): Coral (offers platform) and Deposits Online, each with a mock client name.

**Simulator data** (outside UCOMP)

- Three Coral offers, each with its template link and pinned version.
- About ten fictional customers across several states and APRs, including one very long name for layout testing.

**History**

- About 90 days of synthetic render-log entries.
- An audit trail consistent with every seeded state.
- Seeded notifications: Jordan has one review waiting. Alex has one access request from a seeded user and a recertification due in 30 days (late enough that the clock jumps in scenario 5 don't trip it).

**Demo clock.** Starts on a fixed date, for example Monday, February 1, 2027, so every demo plays out the same way.

## Architecture

Keep it as simple as possible: one standalone Next.js app that does everything, with a lightweight local database that persists between sessions. It runs on localhost only for now.

**Hard constraints**

- **One app:** Next.js (App Router) with TypeScript on Node 22, using pnpm. No separate backend service.
- **UI:** Tailwind CSS with shadcn/ui, themed entirely through tokens (see "Look and feel"). The editor uses TipTap, open-source extensions only.
- **Data:** SQLite via libSQL (`@libsql/client` with a local file URL such as `file:./data/ucomp.db`), with Drizzle ORM and drizzle-kit migrations. The same client can point at Turso later by changing environment variables, with no code change and no Turso account needed now.
- **No system installs:** everything must run with `pnpm install` and `pnpm dev`. Avoid tools that need LibreOffice, headless Chrome or other system packages; prefer pure JavaScript libraries (for example mammoth for .docx and pdfjs-dist for PDF text).
- **Uploads:** original files go in a local folder (for example `./data/uploads`), referenced from the database. This stands in for Azure Blob.

**Patterns that matter for the demo**

- **Personas:** the current persona lives in a cookie set by the switcher. No auth library.
- **One permission check:** a single module answers "can this persona do this action on this thing?" Every server mutation calls it, and the UI uses it to show or hide actions.
- **Demo clock:** the current date is stored in the database and read through one `now()` helper. Sunsets, recertification deadlines, audit timestamps and the render log all use it. Domain logic never reads the system clock directly.
- **Reset:** "Reset demo" in the demo drawer (with a confirm) drops and re-seeds the database. A `pnpm db:reset` script does the same. The seed is deterministic.
- **One domain layer:** keep the business rules in one readable place, so they can later be ported to the Spring Boot API: lifecycle transitions, maker-checker, contract diff, render validation, the permission matrix. Cover them with co-located tests.
- **Render route:** shaped like the future API, as described in "Preview and rendering". Everything else (app mutations and reads) can use server actions or route handlers, whichever is simpler.
- **Simulator separation:** the consumer simulator's offers, links, customers and deliveries live in their own tables (for example prefixed `sim_`). UCOMP code never reads them.

**Entities** (the shape, not a schema): teams; users (personas and seeded users); memberships with roles; content types (required sections, allowed channels); approval chains; templates; versions (number, state, TipTap JSON body, email subject and preheader, variables, sample data sets, enabled channels, author, decisions, sunset date, revoke details); comments with block anchors; approvals per stage; render log; consumers; audit events; notifications; access requests; recertifications; settings (the demo clock).

## Out of scope and caveats

The prototype demonstrates the product, not the production system. Every production integration is stubbed with the simplest stand-in that still behaves the same from the user's point of view.

**Stand-ins**

| In production | In the prototype |
| --- | --- |
| Login: Better Auth in the CMS with Entra ID SSO | Persona switcher (cookie) |
| Spring Boot UCOMP API | A Next.js render route shaped like it |
| PingFed client IDs for consumers | None; the simulator calls the route directly |
| Fluxnova approval workflow | An approval-chain config table and simple logic |
| Azure SQL | SQLite via libSQL |
| Azure Blob | A local uploads folder |
| Delivery to customers via UMP | The consumer simulator's mock delivery |
| Production PDF and email-safe HTML renderers | Approximate PDF and a simple email preview |

**Not included:** in-app AI features (future state, estimated end of 2027), SMS and banner channels, state-specific language (parked), languages other than English.

**Stretch, if time allows:**

- Draft requests: "Request a disclosure" from a simulator offer appears in the team's library as a request an author can pick up.
- A Legal reviewer persona and a second approval stage.
- A ⌘K command palette.
- Audit CSV export.

**Caveats for later sessions**

- **Azure App Service deployment** comes in a future session. The SQLite file needs persistent storage there (or a switch to Turso or Azure SQL), and localhost assumptions need a review.
- **The persona switcher is effectively "sign in as anyone."** It must be removed or locked down in any shared deployment.
- **TD styling** will be applied later by swapping tokens and fonts. Keep components free of hard-coded styles.
- **Fictional data only.** Never load real customer data, real disclosures or internal bank content, especially anywhere hosted outside the bank.
- **Not production code.** The domain rules are a useful reference for the real API, and UI components may carry forward. The data layer and stand-ins will be replaced.

## Demo script

These scenarios are the acceptance test. Each must run start to finish from a fresh reset, with no errors and nothing the presenter has to explain. Run them in order; together they tell the whole story.

1. **First impression (Maya).** The Library shows Coral Offers templates in mixed states. Status reads at a glance, and there's one obvious primary action.
2. **Create (Maya).**
   1. New template, pick "Card offer terms", rename it "Spring Travel Rewards — Terms". That's two clicks from the Library to typing.
   2. Write the offer text. Drag `first_name` in from the panel. Type {{ to insert `purchase_apr`. Create `offer_end_date` (Date) inline.
   3. Try to delete "Legal notices"; it's blocked inline.
   4. Preview PDF, Web and Email with the "Typical" and "Long name" sets. Turn on Email and put {{first\_name}} in the subject.
   5. Submit; it becomes v1, In review.
3. **Review loop.**
   1. Maya sees Approve disabled with "You submitted this version."
   2. Switch to Jordan: the Review badge shows the item. He comments on a block and requests changes with a reason. v1 becomes Changes requested, and a new draft appears.
   3. Switch to Maya: she sees the comment in the margin, fixes it, resolves it and resubmits as v2.
   4. Switch to Jordan: he approves. v2 goes Active with the signature moment, and the Share button appears.
4. **Going live.**
   1. Open the simulator from the demo drawer. Link the Spring Travel Rewards offer to the template (found by search), pinned to v2. Map the variables.
   2. Send to five customers: all show Delivered. Open one in the phone frame and one as a PDF. The long-name customer's layout holds.
   3. Usage reflects the renders, and the render log holds no customer values.
5. **Breaking change, pin and sunset.**
   1. Maya edits, adds required `annual_fee`, and submits v3. The submit dialog flags the breaking change.
   2. Jordan sees the contract change, approves, and sets v2's sunset 14 days out in the same dialog. The consequence text names Coral.
   3. In the simulator, the offer shows "v3 available" and still sends on v2.
   4. Advance the clock 15 days: sending fails with the sunset message.
   5. Relink to v3. Mapping asks for `annual_fee`. Map it, send, and it succeeds.
6. **Revoke.**
   1. Jordan starts a revoke on Balance Transfer Intro v1 (still rendered by Coral) with a reason, and can't confirm it himself.
   2. Alex confirms. Coral's sends on that offer fail immediately with the revoke message.
   3. The audit log shows both steps.
7. **Teams and roles.**
   - Priya switches between Coral Offers (editing) and Deposits (View only, with no toolbar).
   - Sam can view and use the integration panel but can't edit.
   - Riley changes a channel rule and can open, but not edit, a template.
   - Taylor sees all teams and the whole story in the audit log, with demo-clock times.
8. **Access.**
   1. Morgan requests Author on Coral Offers. Alex sees the sidebar card and notification, and approves. Morgan now sees the Library.
   2. Alex runs recertification and leaves one member unconfirmed.
   3. Advance the clock past the deadline: that member loses access.
9. **Import.** Maya imports a .docx containing {{first\_name}} and a table. The draft has a chip and the table. "Compare with original" shows the source.
10. **Copilot prompt.** Maya copies the generated prompt, then pastes back text containing {{purchase\_apr}}, which becomes a chip.
11. **Reset.** Reset from the demo drawer returns the seeded data and the starting clock date.

## Suggested build order

Build the shell and the editor first and put them in front of Sri early, because feel matters most and will take iteration. Pause for Sri's review at the end of each phase before starting the next.

| Phase | What gets built | Review gate |
| --- | --- | --- |
| 1. Foundation | Project setup, design tokens and theme, app shell (sidebar, top bar, settings modal frame, demo pill), database, deterministic seed and reset, demo clock, personas and switcher, permission module | The shell feels like the screenshots; switching personas changes teams and navigation |
| 2. Editor | Library, starter gallery, TipTap editor (blocks, slash menu, drag handles, required sections, variable chips and panel, autosave, read-only mode) | Demo scenario 2, steps 1–3, feels effortless. Expect several rounds here |
| 3. Preview and render | Render function, PDF / Web / Email previews, sample data sets, render route with validation and render log | Scenario 2 complete |
| 4. Lifecycle and review | Versions, submit dialog, contract diff, review queue and screen, redline, comments, approve and request changes, sunset, two-person revoke, Versions tab | Scenarios 3 and 6 |
| 5. Going live | Consumer simulator, Usage dashboard with seeded history, integration panel behind the Share button | Scenarios 4 and 5 end to end |
| 6. Access and admin | Request access, team settings, recertification, inactivity, platform settings and approval chains, Auditor view, audit log, notifications | Scenarios 7 and 8 |
| 7. Import and polish | Import with compare, Copilot prompt, a full UX pass against the experience principles (remove stray hint text, check badge and wording consistency), then the whole demo script from a fresh reset | Scenarios 1–11 |
