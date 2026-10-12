# UX / QA review of the running app (slice: `ux`)

Reviewer: the only agent that drove the product. Production build at http://localhost:3200 against `data/review.db`,
driven with headless Playwright 1.63 (Chromium 1243) at 1440×900, plus 320×720, 320×256, 800×700 and 1000×700
reflow passes, `curl` against `/api/v1`, and `@axe-core/playwright` 4.13. Every claim below is `measured` unless
tagged otherwise. Scripts: `scratchpad/ux/s1-landing.mjs` … `s11-reset.mjs`; notes: `scratchpad/ux/notes-s*.txt`;
console/network captures: `scratchpad/ux/issues-s*.json`; 265 screenshots in `scratchpad/ux/`. At the end I reset
the review database through the Demo pill (`s11-reset.mjs`): it is back to 8 templates and "Real time".

## 1. Summary

This is an unusually finished prototype. I walked the whole product end to end as nine personas: author → submit →
maker-checker refusal → approver preview gate → comments → send-back → round 2 → approve with a sunset → Coral
link/deliver → revoke by two people → audit CSV → +31-day clock jump (sunset passed, recert lapse, auto-suspension)
→ reset. Every flow completed, every state the demo script promises exists, and in roughly 160 page loads and
actions I saw zero console errors from the app's own code, zero failed requests other than my deliberate 4xx
probes, zero axe violations on 11 pages (WCAG 2A/AA/2.1AA plus best-practice), and a cumulative layout shift of
exactly 0 on every page, client navigation and tab switch I instrumented. The repo's own UI rules (one black
button, StatusBadge everywhere, disabled-with-reason, 320 px reflow, tokens) hold on every screen I checked; the
few deviations are small and listed. The consumer API is tight: correct status codes, machine-readable errors with
`details`, verbatim digits (a JSON number `21.90` renders "21.90%"), XSS-escaped values, a 1 MB body cap, and
correlation ids. What I found are second-order problems: HTTP 200 on every not-found/forbidden page (a Cache
Components side effect that will blind Dynatrace), silent creation of required variables from any pasted
`{{key}}`, imported variables all typed Text, no presence signal before a two-writer conflict and no live refresh
after another user acts, a 12-column table that the editor and PDF squeeze to one letter per line rather than
refuse, and a 405 KB font payload on every page. None of them blocks a handoff; two or three deserve a decision
record before the Java team inherits them.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 2 | Correctness & robustness (as observed) | 8 | Every lifecycle transition, refusal and time-based rule behaved as specified under adversarial driving; the gaps are UX-level (stale pages, paste-created variables), not wrong state. |
| 5 | UI/UX quality | 9 | Consistent states everywhere (skeletons with final geometry, empty, blocked-with-reason, error), CLS 0, axe 0, 320 px reflow holds, the review/approve/revoke flows are the best I have seen in a prototype; loses a point for the hidden-rather-than-disabled role gaps and silent limits. |
| 9 | Security posture (black-box) | 7 | Values escaped, body size capped, consumer id checked, draft/in-review never served, cross-team template id refused; but identity is a plain cookie, not-found pages answer 200, and an optional-key typo is silently accepted. The known gaps are listed in the backlog; nothing new and exploitable surfaced from the outside. |
| 11 | Handoff readiness, seen from the UI's data needs | 7 | The screens consume a small number of well-shaped read models (library rows, workspace header, versions with `can`, review round, usage aggregates, audit page, notices) and a handful of mutations; all portable. What a Java API must also carry: render-time preview with sample sets, the approver "outputs viewed" record, draft autosave with `rev` compare-and-set and 409, import parsing, and the demo clock. No OpenAPI yet, and two error shapes. |

## 3. Strengths (specific)

- **The review screen's output gate** (`s3-15-preview-pdf.png`, `s3-16-preview-email.png`): Approve is greyed with
  "Preview PDF, Web and Email first."; each channel segment gets a quiet check as it renders on screen, the reason
  shrinks to "Preview Email first.", then "Waiting for a decision" and the button goes black. Request changes never
  waits. For an alert it insists on Push on both phones and SMS (`s3-35-alert-preview-push-android.png`). This is
  the single best piece of compliance UX in the product and it is keyboard-reachable with the reason as tooltip
  (`s9-04-blocked-approve-focus.png`).
- **Consequences before commit**: the Approve dialog says "v1 becomes Superseded; Coral keeps rendering v1 until it
  relinks. Coral has to map review_deadline before it moves to v2." and, once a sunset is ticked, "Coral still
  renders v1 (last render today). It will keep working until November 11, 2026." (`s3-29-approve-dialog-sunset.png`).
  Revoke: "Coral rendered v1 512 times in the last 30 days. Once confirmed, its renders will fail immediately."
  (`s4-06-revoke-dialog.png`). Channel rules: "3 Active Disclosure versions stop rendering to Email."
  (`s6-18-channel-rule-consequence.png`). Approval chain edits show a Now/After pair (`s6-19-add-stage-form.png`).
- **Two-person revoke** (`s4-07-revoke-pending-jordan.png`, `s4-13-confirm-revoke-dialog.png`, `s4-14-revoked.png`):
  the starter sees Confirm greyed with "You started this revoke. Another approver must confirm it.", Withdraw live;
  the confirm dialog opens with focus on Cancel and a red destructive button; the final block reads "Started by
  Jordan Ellis, confirmed by Alex Kim." The audit log and Coral's notices carry the same sentence.
- **Autosave and conflict handling** (`s2b-05-maya-conflict.png`): a second writer's save turns the first page
  read-only in place, the status says "Not saved." and a red line explains "Your latest changes can't be saved —
  this draft changed elsewhere." with a Reload button; Submit is greyed (aria-disabled). Reload mid-edit raised
  `beforeunload` and lost nothing. The save indicator keeps a fixed width (N10 verified: chevron x = 670.34 in both
  states), and the revert toast's Undo is an outline button (N11 verified).
- **Zero layout shift, really**: skeletons have the final geometry (`s1-02-library-skeleton-early.png` vs
  `s1-03-library.png`, `s2-01-content-skeleton.png` vs `s2-02-content.png`, `s4-20-audit-skeleton.png`); CLS was
  0.00000 on 7 pages × 2 runs, the Library→template client navigation, and all four workspace tabs.
- **Alert composer and phone previews** (`s2-06-alert-preview-push.png`, `s2-08-alert-preview-sms.png`,
  `s3-35-alert-preview-push-android.png`): the iPhone/Android lock screens and the SMS thread look right, the
  subtitle is labelled "iPhone only", and the footer reports "GSM-7 · 1 part · Long values: 1 part".
- **Time-based rules work end to end** (`s10-03-sunset-passed-versions.png`, `s10-08-coral-bt-send-failed.png`,
  `s10-10-members-after-clock.png`): after +31 days v1 reads "Superseded · Sunset passed Nov 2", Change sunset is
  greyed with "This version's sunset has passed. It can't render again.", Activity gained "v1 stopped rendering",
  Coral's banner says "A send now fails" and a send returns `410 version_sunset` per document, four members read
  "Access lapsed Nov 11" and Devon "Auto-suspended Nov 6".
- **Import** (`s6-28-import-docx-result.png`, `s6b-02-pdf-import-result.png`): DOCX in 3.6 s, PDF in 3.3 s, TXT
  accepted, a corrupt .docx answered 415 and an inline "This isn't a valid Word file." The Original rail's
  Detected / Dropped / Kept-as-text report is exactly what a regulated author needs.
- **The Share ring / Integration sheet** (`s2-04-share-sheet.png`): template id, active version, the variable
  contract with examples, JSON Schema, a curl/fetch sample per channel, response shapes and the error table, all
  copyable. A consumer team can integrate from this alone.
- **Coral simulator** (`s5-02-sim-home.png`, `s5-07-link-mapping.png`): deliberately not Stencil-styled, reaches
  Stencil only over `/api/v1`, and its link page shows the contract diff and unmapped required variables outlined
  in red with "Map Effective date and Review deadline to send."
- **Performance**: TTFB 1–2 ms, DOMContentLoaded 30–70 ms, FCP 32–72 ms, network-idle under 1 s on all seven key
  pages; a 10,000-word paste rendered in 34 ms, saved in 777 ms and previewed as PDF in 538 ms; typing cost 0.5 ms
  per character with no long tasks; 50 variables created from a paste in one frame.
- **Accessibility**: axe found 0 violations on Library, Content, editor draft, Versions, review queue, review screen,
  Usage, Audit, Settings members, Coral home and Request access. Tab order is sensible, dialogs trap and restore
  focus (`s9-03-revoke-dialog-keyboard.png`), the palette works by keyboard, blocked buttons are focusable with
  their reason.

## 4. Findings (by severity)

### High

None found. Nothing I could do from the UI or the API produced wrong state, lost approved content, or served a
draft to a consumer.

### Medium

**M1 · Every not-found and forbidden page answers HTTP 200** — `measured` — `curl -o /dev/null -w "%{http_code}"`
on `/nope/library`, `/coral-offers/templates/UC-ZZZZZZ`, `/coral-offers/review/UC-D6KSGY/9`, and
`/coral-offers/audit` as Maya all return `200 text/html` while the page shows "Not found" (`s7-01-team-404.png`,
`s4-30-maya-audit.png`). `notFound()` runs inside a `<Stream>` after the static shell has already been sent with
200 (Cache Components). Why it matters: Dynatrace, uptime checks and the Java team's error budgets will never see a
404 from the BFF; a broken link in an email to compliance looks healthy. Fix: decide the not-found/forbidden cases
before streaming (a thin server check in the page or a `proxy.ts`), or accept it and record the decision so
monitoring keys on the body/`x-stencil-*` headers instead. Also `/api/v1/nope` answers 404 with Next's HTML error
page, not the API's JSON shape.

**M2 · Pasting `{{any_key}}` silently creates a required Text variable per key** — `measured` — pasting 50 unknown
`{{stress_var_N}}` placeholders into a draft produced 50 chips and 50 new *required* Text variables in one frame
with no confirmation, no report and no "New" badge summary (`s7-17-50-unknown-keys.png`); the same happens for one
typo. `src/editor/paste/markdown.test.ts:196` confirms "unknown keys are created" is intended for the Copilot flow.
Why it matters: a required variable is a breaking contract change for every consumer, and a typo (`{{purcahse_apr}}`)
becomes a second required variable next to the real one; the author only notices at Submit ("Breaking change").
Fix: show a one-line toast or rail strip after a paste that created variables ("3 variables created from the
paste · Review"), and consider creating them optional until the author confirms the type.

**M3 · Imported variables are all typed Text, including rates, dates and money** — `measured` — DOCX import:
"4 variables, all Text and required: First name, Purchase APR, Offer end date, Annual fee"
(`s6-28-import-docx-result.png`); PDF import: 6 Text variables including Effective date, Purchase APR, Cash APR,
Annual fee (`s6b-02-pdf-import-result.png`); the Copilot prompt then tells Copilot they are Text. Why it matters:
a Text "Purchase APR" renders `21.99` instead of `21.99%` and accepts any string from the consumer; in a regulated
disclosure that is the error class the product exists to prevent, and the import report mentions it only in
passing. Fix: infer type from the placeholder name (`*_apr`, `*_date`, `*_fee`) with a "Check types" strip in the
Original rail, or block Submit while an imported variable is still "Text (unconfirmed)".

**M4 · No presence signal before a two-writer conflict, and the loser's keystrokes are gone after Reload** —
`measured` — Priya opened Maya's open draft and saw an ordinary editable page with no sign Maya was in it
(`s2b-02-priya-opens-draft.png`); after Priya's save, Maya's next keystrokes produced the conflict state and Reload
dropped "MAYA-AFTER-PRIYA" (`s2b-05-maya-conflict.png`, `s2b-06-maya-after-reload.png`). The handling is honest
(I6 is fixed), but the product has no "Priya Raman is editing" hint, no soft lock, and no way to copy the unsaved
text out other than selecting it before pressing Reload. Fix: show the other writer's avatar in the header while
their session is live (the `writers` column already exists), and keep the unsaved text in a "Your unsaved changes"
disclosure after Reload.

**M5 · Screens never refresh after another user acts** — `measured` — Jordan's Versions tab still showed
"Superseded · Sunset Nov 11" with live Confirm/Withdraw buttons two seconds after Alex confirmed the revoke in
another session (`s4-15-jordan-stale-or-live.png`); it stays that way until a navigation. The compare-and-set
refuses the stale click, so no harm, but on a two-person flow the second person's screen is exactly where the
first person is looking. Fix: `router.refresh()` on window focus/visibility and after a notification arrives, or
poll the review/versions read models every 30 s.

**M6 · A 12-column table is squeezed, not refused** — `measured` — in the editor the headings wrap to
"Colu/mn/head/ing 1" and, with the preview rail open, to one letter per line (`s7-20-table-12-cols.png`,
`s7-21-table-preview-pdf.png`); the PDF squeezes 12 columns into the text measure at about 6 pt. The Web render
puts the table in `div.table-wrap { overflow-x: auto }` (608 px box, 991 px table), so customers scroll it
(`s7-22-table-preview-web.png`). The repo's own rule is "When a channel can't reproduce something, restrict it in
the editor rather than render it approximately." Fix: cap columns per content type (6–8) in the editor with the
refusal at the control, or let the document canvas and PDF honour a minimum column width and scroll/landscape.

**M7 · 405 KB of web fonts on every page, and preload warnings on every navigation** — `measured` — six `.woff2`
files, 405 KB encoded, load on every route (Library, editor, review, Coral); Chromium logs "The resource …woff2 /
…css was preloaded using link preload but not used within a few seconds" four to six times per navigation
(`issues-s4.json`, `issues-s6.json`). JS is reasonable for the editor (674 KB gzip, 2.1 MB raw, 37 files before
load) and the Library pays 357 KB gzip up front plus 329 KB of route prefetch. Why it matters: on a corporate
laptop over VPN the fonts are the largest single cost of first paint, and the console noise will hide real
warnings from the Java team. Fix: subset the display face, drop unused weights, and preload only what the first
paint uses.

### Low

**L1 · Members table hides controls instead of disabling them** — `measured` — Alex's own row reads "You can't
change your own access." with no Edit roles/Remove buttons (`s6-11-settings-members.png`), and Riley/Taylor/Sam
see no Edit/Approve/New template controls at all; the checklist says "Disabled, not hidden" with the reason as
tooltip. Role-based hiding is defensible; say so in the checklist or use `BlockedButton` here too.

**L2 · Template name is capped at 120 characters silently** — `measured` — a 185-character name was cut at
"…The Review Queue — Sp" with no message (`s7-11-long-name-header.png`; `MAX_NAME_LENGTH` in
`src/domain/import.ts:26`, `maxLength` in `src/components/workspace/name-field.tsx:160`). A counter or a one-line
refusal at the field would match the "explain at the control" rule. Long names otherwise behave: the Library
truncates with an ellipsis, 320 px wraps (`s7-14-long-name-320.png`).

**L3 · The Library's status filter has no "Changes requested", "Superseded" or "Revoked" chip** — `measured` —
chips are All/Draft/In review/Active (`s1-03-library.png`); Annual Fee Waiver, whose v1 was sent back, shows as
"Draft". Defensible (the row shows the working state), but an approver looking for "what did I send back" has to
go to Review › Recently decided.

**L4 · Comment quotes are not snapped to word boundaries** — `measured` — a selection that started mid-word
produced the quote "o qualify for this o" in the rail and the gutter (`s3c-03-after-reply.png`). Snap the quote
to words or show an ellipsis.

**L5 · Two error shapes between the BFF's routes** — `measured` — `/api/v1` answers `{"error":{"code","message",
"details"}}`; `/api/templates/*/integration` and the audit export answer `{"ok":false,"code","reason"}`;
`GET /api/v1/templates/{id}/render` answers 405 with an empty body; `/api/v1/nope` answers Next's HTML. One shape
(or at least JSON everywhere under `/api`) before the Java team copies both.

**L6 · Unknown optional keys are accepted silently** — `measured` — `offer_end_dat` (typo) → 200 and the optional
line is dropped. Required typos surface as `missing_variables`, so this is low; an `ignored: [...]` entry in the
response headers or body would help consumers.

**L7 · Submit dialog takes ~3 s to open on a 55-variable, 10,000-word draft** — `measured` — versus ~1 s normally
(`s7-26-submit-stress.png`); the button gives no pending state during that time.

**L8 · No skip-to-content link** — `measured` — the first Tab lands on the "Stencil home" logo, then Switch team,
Library…; the main content is the 10th stop. axe's `bypass` passes because of landmarks, but a visually hidden
"Skip to content" is cheap.

**L9 · Authors can resolve a reviewer's thread while the version is in review** — `measured` — Maya resolved
Jordan's open comment on v3 round 2 before resubmitting (`s3c-08-maya-resolved.png`). The policy lives in
`src/domain/comments.ts` (S7), so this is a product decision, not a bug; record it either way.

**L10 · The Coral Send button stays live after "A send now fails."** — `measured` — `s10-07-coral-bt-after-sunset.png`.
Fine for a simulator that exists to show the 410; note it in the simulator README so nobody "fixes" the API.

### What I could not force

A thrown read behind an error boundary (I7's `error.tsx`): I found no input that throws. A real second browser
tab's `beforeunload` prompt text (Playwright accepts it). The Legal-reviewer two-stage chain and the "Platform
time zone" page (left to the demo script; `s6-17-platform-approval-chains.png` shows the editor).

## 5. Backlog check (docs/handoff-review.md)

| Finding | Status line | Verified? |
| --- | --- | --- |
| N4 passed sunset badge | Fixed | **True** — "Superseded · Sunset passed Nov 2" on Versions, Usage and Coral after +31 days (`s10-03-sunset-passed-versions.png`). |
| N8 Submit after saving stops | Fixed | **True** — Submit is `aria-disabled` during the conflict state (`s2b-05-maya-conflict.png`). |
| N10 chevron moves | Fixed | **True** — chevron x identical for "Saving…" and "Saved" (`notes-s8b.txt`). |
| N11 revert toast Undo | Fixed | **True** — Undo is white with a hairline border (`notes-s8b.txt`). |
| N12 heatmap legend hover-only | Fixed | **True** — printed key "1–160 / 161–228 / …" with sr text (`notes-s6.txt`, `s6-22-usage.png`). |
| N13 Library filter third style | Fixed | **True** — it is a `Segmented` (`s1-04-library-filter-active.png`). |
| N22 per-channel split on the template Usage tab | Fixed | **True** — "Renders by channel" card (`s2-02-usage.png`). |
| N24 Library says Document/Alert | Fixed | **True** — "UC-FYN38M · Alert" on every row. |
| N25 subject can take a review comment | Fixed | **True** — gutter button on the Subject field (`s3-11-selection-floating.png`). |
| N27 reflow below 800 px | Fixed | **True** — no page or canvas horizontal scroll at 320 on Library, template, Versions, editor, Settings, Submit dialog (incl. 320×256), Coral (`s1-20-library-320.png`, `s7-25-submit-dialog-320x256.png`, `s6-15-settings-320.png`). |
| I6 conflict leaves editor editable | Fixed | **True** — editor `contenteditable=false`, text typed after the conflict is not accepted. |
| I10 large drafts lose edits on close | Fixed | **True** — `beforeunload` fired on reload mid-edit; marker survived. |
| I13 blocked decisions not keyboard-reachable | Fixed | **True** — Tab reaches the greyed Approve, tooltip "You submitted this version." shows on focus. |
| S7 comments on any state | Fixed | Consistent with what I saw (comments only on draft/in-review); not provable black-box. |
| N26 phone previews unchecked on real phones | Fixed (decision 0046) | Status is a decision, not a fix; the previews look plausible (`s2-06-alert-preview-push.png`). |

New, not in the backlog: M1 (HTTP 200 on not-found), M2 (paste creates required variables), M3 (import types), M4
(presence), M5 (stale screens), M6 (wide tables), M7 (fonts/preload), L2–L8.

## 6. For the Java team

What the UI needs from a backend, as observed from the outside (ports cleanly as REST + JPA):

- **Read models the screens consume**: library rows (status, active version, last edited, owner, kind), workspace
  header (name, state, based-on, rev, writers), versions with decided permissions (`can.sunset`, `can.revoke`,
  `can.confirm`, each `{ok} | {code, reason}`), the review round (document, redline against the baseline, stage
  stepper, note, contract diff, threads, outputs viewed), usage aggregates (30-day totals, by channel, by version
  by week, consumers table, failures per day), the audit page with facet counts per filter, notifications,
  consumer notices. Each is one GET; the UI never composes them client-side.
- **Mutations**: draft autosave `PUT /api/drafts/{id}` with `rev` compare-and-set → 409 (the UI relies on that
  409); submit; approve (with optional sunset); request changes; comment/reply/resolve/reopen; set sunset; start,
  withdraw, confirm revoke; access request/approve/deny; roles; recert keep/remove; channel rules; approval
  chains; import upload (415 on bad files, 1 MB cap). All return `{ok} | {ok:false, code, reason}`.
- **Semantics to keep**: sunset is an instant at 00:00 in the business zone with `sunsetDay` + `zone` beside it;
  the approver's viewed-outputs list is recorded on the approval; render values are strings whose digits are
  rendered verbatim (a JSON number `21.90` must still print "21.90%", so do not parse into `double`/`BigDecimal`
  without keeping the lexeme); the render log stores keys, never values; a consumer may read only its own
  notices (`consumer_mismatch`).
- **Needs rethinking before port**: the not-found/forbidden-as-200 behaviour (M1) if the BFF stays on Cache
  Components; one error envelope for `/api/v1` and the internal routes (L5); presence/locking for drafts (M4)
  needs a server-side "who is editing" with a TTL; the demo clock (`now()`) must become an injectable Clock in
  Spring, since every time rule (sunset, recert, inactivity) read it correctly in my +31-day test.
- **Read first**: `src/contracts/api-v1.ts` and `src/contracts/README.md`; `src/server/actions/kit.ts`
  (`serverAction`), `src/server/queries/versions.ts` (a read model with `can`), `src/domain/lifecycle/revoke.ts`,
  `e2e/demo-script.spec.ts` (the whole product as one executable script), `docs/guides/demo-script.md`.

## 7. Files

**Models of good code I read while driving**: `e2e/helpers/review.ts` (the output gate in 50 readable lines),
`e2e/autosave-session.spec.ts` (the three autosave stories as a header comment, then tests that match),
`e2e/approver-views-output.spec.ts` (header explains decision 0037 better than the decision), `src/components/
comments/thread-card.tsx` (one card, every state, plain names), `src/components/versions/version-actions.tsx`.

**A human will struggle with**: `e2e/demo-script.spec.ts` (1,340 lines; it is the product's acceptance test and
the demo pacing tool at once; split by act), the audit `Action` filter's facet options (empty accessible text on
the checkboxes themselves; the labels sit beside them, so screen readers get them but tests and tooling don't).

## Measurements

| Page (cold context, 2 runs) | TTFB | DCL | FCP | idle | JS before load (gzip / raw) | CLS |
| --- | --- | --- | --- | --- | --- | --- |
| Library | 1 ms | 30 ms | 32 ms | 0.92 s | 357 KB / 1.1 MB (+329 KB prefetch) | 0 |
| Template Content | 2 ms | 33 ms | 60 ms | 0.94 s | ~2.2 MB raw | 0 |
| Editor (draft) | 2 ms | 34 ms | 60 ms | 0.95 s | 674 KB / 2.1 MB | 0 |
| Review screen | 1 ms | 34 ms | 56 ms | 0.95 s | 687 KB / 2.1 MB | 0 |
| Usage | 1 ms | 70 ms | 72 ms | 0.97 s | 1.27 MB raw | 0 |
| Audit | 1 ms | 53 ms | 64 ms | 0.90 s | 1.1 MB raw | 0 |
| Coral /sim | 1 ms | 37 ms | 40 ms | 0.91 s | 1.18 MB raw | 0 |

Fonts: 6 files, 405 KB on every page. CSS: 36 KB gzip. HTML shell: 18–27 KB gzip. Client nav Library→template:
heading in 167 ms, document in 168 ms. Coral send of 24 documents (8 customers × 3 channels): 4.6 s. PDF render via
API: 32 KB, well-formed (`scratchpad/ux/api/render.pdf`). Console: 0 app errors; the only errors are my 4xx probes
and the 409 the conflict test provokes; warnings are the preload notices (M7).

API probes (`scratchpad/ux/api/`): list/paging/search 200; no header 400 `consumer_required`; unknown consumer 403;
other consumer's notices 403 `consumer_mismatch`; unknown template 404; `../../etc` id 404; missing values 422
with `details.missing`; bad values 422 with `expected`; channel not enabled 422; unknown channel 400; push without
platform 400; in-review 409 `version_not_released`; sent-back 409; revoked 410 with `at`; sunset 410
`version_sunset`; version 99 404; invalid JSON 400; 3 MB body 413; 1,500-char value 422 `maxLength`; XSS value
escaped; superseded render 200 with `x-stencil-newer-version: 2`; base64 opt-in 200.

## The 10 most informative screenshots

1. `scratchpad/ux/s3-16-preview-email.png` — the output gate just satisfied: Approve turned black, three channel checks, email preview.
2. `scratchpad/ux/s2b-05-maya-conflict.png` — the two-writer conflict state: red explanation, Reload, greyed Submit, read-only body.
3. `scratchpad/ux/s3-29-approve-dialog-sunset.png` — Approve with consequences and the sunset calendar inside the dialog.
4. `scratchpad/ux/s4-13-confirm-revoke-dialog.png` — second approver's confirm dialog, focus on Cancel, red destructive action.
5. `scratchpad/ux/s7-21-table-preview-pdf.png` — M6: the 12-column table squeezed to one letter per line in the editor and tiny in the PDF.
6. `scratchpad/ux/s7-17-50-unknown-keys.png` — M2: 50 required variables created by one paste, no message.
7. `scratchpad/ux/s6-28-import-docx-result.png` — DOCX import with the Original rail; M3 visible in "all Text and required".
8. `scratchpad/ux/s10-10-members-after-clock.png` — +31 days: access lapsed / auto-suspended rows with Restore.
9. `scratchpad/ux/s10-08-coral-bt-send-failed.png` — Coral after the sunset: "0 delivered, 4 failed · 410 version_sunset".
10. `scratchpad/ux/s7-01-team-404.png` — M1: the bare "Not found" page that the server sends with HTTP 200.

Honourable mentions: `s1-03-library.png` (first impression), `s2-04-share-sheet.png` (integration sheet),
`s3-09-redline.png` (Show changes), `s6-19-add-stage-form.png` (Now/After chain editor), `s1-20-library-320.png`
and `s7-25-submit-dialog-320x256.png` (reflow), `s9-04-blocked-approve-focus.png` (blocked button by keyboard).
