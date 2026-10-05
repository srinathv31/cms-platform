# Track B decisions (Phase 6, access and admin)

Autonomous calls made by the lead. Each can be overruled at review. Mocks: `/design/settings?v=a|b|c`, `/design/audit?v=a|b|c` (kept as references). Media: `docs/decisions/media/track-b/` (walkthroughs: `settings-walkthrough.webm`, `audit-walkthrough.webm`).

## Settings modal sections: **A (Rows)** with three borrowings from C
- **Picked:** A, dense table rows with inline actions and a consequence strip under the row; plain caps-label groups TEAM / PLATFORM in the nav, as in Unknown-3.png. Stills: `settings-a-members.png`, `settings-a-members-suspend.png`, `settings-a-access-requests.png`, `settings-a-recertification.png`, `settings-a-inactivity.png`, `settings-a-approval-chains-add.png`.
- **Borrowed from C:** muted count trails on the nav for items needing action (Access requests, Recertification, Inactivity); the Recertification "4 of 6 · 30 days" stat card; the side-by-side "Now / After" chain cards as the consequence when adding Dana Park's Legal stage (`settings-c-approval-chains-add.png`). These make consequences visible before commitment, the strongest part of C.
- **Rejected B (List + detail)** (`settings-b-*.png`): two clicks per person, hides the overview, and the Team|Platform scope switch breaks Unknown-3.png's one-glance nav.
- **Rejected C as a whole** (`settings-c-*.png`): tall cards make six members scroll; reads heavier than the reference.
- **Frame change:** content padding px-14 → px-10 and nav 17rem → 15rem so the member table columns fit.
- **Member states** (Suspended, Lapsed) render as muted text on a dimmed row, not StatusBadge (StatusBadge is for template version states only).

## Audit filters: **A (filter bar with chips)**
- **Picked:** A, five menus (Team, Person, Action, Template, Date) whose picks become removable chips, "Clear all", and "Export N events" that follows the filters. Lowest risk and maximum room for the table. Stills: `audit-a.png`, `audit-a-filtered.png`, `audit-a-menu.png`, `audit-a-date.png`.
- **Rejected B (facet rail)** (`audit-b*.png`): costs 15rem of table width, truncates Template and Details, heaviest chrome.
- **Rejected C (token query field)** (`audit-c*.png`): least discoverable for C-suite and business users; a candidate for a later power-user mode.
- Replace the mock's native date inputs with the app's date picker / presets (7, 30, 90 days on the demo clock).

## Contracts (accepted from the Phase 6 brief)
- **Dana Park is a 9th persona** (Coral Offers Viewer), so the Legal reviewer stage has someone to switch to. The build plan's stretch goals list "A Legal reviewer persona".
- **A stage reviewer can act across teams.** A Legal stage applies to every team's disclosures. Being named on a stage lets that person open and decide (and comment on) any submission currently waiting on their stage, in any team, even with no membership there. Otherwise a Deposits submission would wait forever on someone who can't see it. The chain editor states this when the stage is added.
- **Recertification excludes Team Admins** (they certify others). 6 items in the seed.
- **The access sweep runs on Advance clock and on persona switch** (not on a timer). Lapses are backdated to the moment the deadline was crossed; when two deadlines hit one person the earlier wins, and a tie goes to recertification. Running the sweep twice changes nothing.
- **Inactivity is counted from the latest of last sign-in, date added and the last Keep.** Keep and Reinstate restart the clock.
- **Nobody changes their own access**, and every team keeps at least one Team Admin.
- **A denial needs a note**, which the requester sees.
- **Seed notification kinds renamed** to match the code (`version_active` → `version_live`, etc.).

## Access server (S1)
- **The recertification sidebar card keeps one id for the whole review**, so a dismissed card doesn't come back after each Keep. The access-requests card's id changes with the newest request and the count.
- **A member removed while undecided counts as removed**, so a review can close early without them.
- **Persona switch order:** cookie → sweep → `lastActiveAt = now()` → revalidate → redirect.
- **`getHomeCard()`** is a separate query for people with no space (the "my request" card).

## Platform config and two-stage approval (P1)
- **A stage reviewer outside the team opens the version through their own space** (`/<their-space>/review/{id}/{n}`); it shows in their queue and badge. They keep seeing it after deciding; other versions of that template stay 404. They still need active access somewhere.
- **Nobody approves two stages of the same round** ("You approved an earlier stage."); Approve is disabled with that reason.
- **Required-section edits affect only templates created afterwards.** Nothing checks sections at submit, so removal can't break a draft; at least one section must remain. New templates conform to the type (removed sections become ordinary headings, renamed ones take the new title, new ones are appended).
- **Turning a channel off** shows its consequence before saving ("2 Active Disclosure versions stop rendering to Email.").

## Audit and notifications server (S3)
- **Audit filters are multi-select** (comma lists): values within a field are ORed, fields are ANDed; facet counts are computed under every other filter.
- **The Person filter matches the actor or the subject**, so "Person: Sam" shows his lapse. Events with no actor show as "UCOMP".
- **An approver's activation reads "Approved"**; with no actor, "Became Active".
- **CSV export**: When (ISO, demo clock), Who, Team, Template ("Name (UC-…)"), Version, Action, Details; BOM; all matching rows; fields starting with `= + - @` get a leading apostrophe (formula-injection guard). 403 without `audit.view`.
- **Notifications** list the newest 30 plus the unread count; only the owner can mark one read.

## Team settings UI (U1)
- **Members has no "Added" column** (it didn't fit at 1280); job-title sublines truncate with the full text in `title`.
- **Labels:** "Restore" (not "Reactivate") and "Deny" (not "Decline"), matching the actions.
- **On a dimmed (suspended/lapsed) row only the person and cells dim**; actions stay full strength.
- **A blocked row shows the single refusal sentence instead of buttons** (e.g. your own row: "You can't change your own access.").
- **The hard-nav settings route opts out of instant navigation** (`instant = false`), like the modal route, to avoid a dev console error on section actions.

## Platform settings UI (U2)
- **Turning a channel on is immediate; turning one off** shows its consequence and commits only on confirm. The last channel left on can't be turned off.
- **Approval chain edits are drafted** (add, edit, reorder, remove) and saved together behind one strip with the Now/After cards. Removing a stage is blocked while a version waits on it, or when it's the only stage.
- **Reviewer picker offers only people with active access.**
- **Unsaved drafts survive switching sections** in the modal (hidden routes stay mounted). Left as is.

## Audit page (U4)
- **Filters live in the URL** (shareable; back/forward work), with optimistic chips.
- **Date offers presets only** (Last 7 / 30 / 90 days on the demo clock); a custom range arriving by URL still shows as a chip.
- **"Clear all" shows with two or more chips**; with one, the chip's × is the way out.
- **The list shows the newest 500** ("Newest 500 of N events"); Export always includes every matching row.
- **Team column only on All teams**; platform events read "Platform", system events "UCOMP".

## Review fixes (R1)
- **The sweep never ends a team's last active Team Admin.** When the clock would end every active Team Admin a team has (day 120 or a review's deadline), the one whose access would end last stays active, still flagged; `access.kept_last_admin` is recorded at the boundary and the Platform Admins are told (link: All teams → Settings → Teams). Said once per inactivity clock (marker: `inactivityFlaggedAt = suspendAt`); a Team Admin added later can suspend them from Inactivity.
- **A 90-day flag from before a sign-in doesn't count**: the next 90 idle days flag (and notify) again.
- **An Auditor can't be named on a stage** (read-only everywhere; nor can someone with no active access). An Auditor named anyway gets nothing from it.
- **A stage reviewer outside the team** gets review notifications linking into their own first space, and can preview the version they're reviewing.
- **New templates also drop channels the content type no longer allows.**
- **Known rough edge (deferred): reordering approval stages doesn't remap versions already waiting.** Moving a stage ahead of a waiting version's stage makes it skip that stage; changes-requested versions and past approvals aren't remapped, so the stepper can mislabel stages after a reorder. Adding or removing a stage (the demo path) is correct. Reason: rare in practice, and a correct remap needs a product rule for in-flight reviews.
- **Platform Admins can't add a Team Admin to an existing team** (only via a new team's first admin), so the "kept last Team Admin" alert can only inform.

## QA and review fixes (B-fix)
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
- **Dimmed rows mute their text and fade only the avatar** (fading text failed contrast). Muted counts turn full strength on the selected and hover fills.
- **An access request's reason shows in full in the Approve and Deny strips.**
- **Content types' strip says its scope from the start**: "Applies to new Disclosure templates only. Existing templates keep their sections."
- **Audit grid:** Action 10rem (fits "Configuration changed"), Template and Details floored; under the width those need, Who stacks under When and Details under Template; narrower still, Action under Template. Details and Action carry their full text in `title`. The chip row's height is reserved, so the first chip doesn't move the table. Zero-count options read muted. Filter popovers are named "<Field> filter".
- **Relative times on the audit and in notifications count calendar days** (UTC, the demo clock): "Yesterday", "4 days ago"; same-day times stay "3 hours ago".
- **The sidebar is one navigation landmark** ("Sidebar"), covering the switcher, the pages, the card, Settings and Help.
- **The role picker is a radio group** (Tab to the chosen role, arrows move it), in the same segmented look.
