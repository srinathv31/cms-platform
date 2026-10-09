# Codebase review (October 2026)

Ten independent reviewers read the whole codebase at `main` @ ec3978b (October 7, 2026), looking for what a production dev team, or an AI agent copying the code, would trip over. This page is that review as a working backlog: every finding, its severity, where it is, what happens and how to fix it, with its current status.

## How to use this page

- **Pick work** from [Fix first](#fix-first), then by severity within an area. Skip anything marked Fixed or Deferred.
- **Fix a finding in its own PR** (or a small group of related ones), and change its **Status** line here in the same PR: `Open` → `Fixed`, with one sentence saying what changed, and update the counts in [Status](#status). Keep the heading as it is so links to it keep working. That keeps this page true; a finding marked Open must still be reproducible.
- **Line numbers are from ec3978b.** Files touched since then have moved; find the code by the symbol or behaviour described. A path that no longer exists is marked as moved or removed.
- **Evidence** says how sure the finding is: *measured* (from a check run for the review), *verified* (re-read in the code after the reviewer reported it), *reproduced* (proved with a throwaway test), *traced* (followed through the code, not run). Re-check a *traced* finding before fixing it.
- **Rules still apply.** Read [AGENTS.md](../AGENTS.md) and the README of the layer you're changing. Rendering changes must keep the golden files and parity tests green ([src/server/render/golden](../src/server/render/golden/README.md)).

## Status

| Status | Critical | High | Medium | Low | Total |
| --- | --- | --- | --- | --- | --- |
| Open | 0 | 15 | 31 | 13 | 59 |
| Partly fixed | 0 | 4 | 3 | 1 | 8 |
| Fixed | 1 | 7 | 4 | 1 | 13 |
| Deferred | 1 | 2 | 1 | 0 | 4 |

Fixed so far: PR #6 (the render engine prints exactly what the author typed, in every channel), PR #7 (golden files and parity tests), PR #8 (the in-repo documentation system).

**Deferred** findings are demo and login stand-ins the owner will replace with real login and by removing the demo tools; don't fix them in place.

## Fix first

Open findings that lose data, break a core flow, or put the wrong content in front of a customer, in the order to take them.

1. [D1: Revoking the live version freezes the template for good](#d1--high-revoking-the-live-version-freezes-the-template-for-good)
2. [I1: Renaming a draft outside the Content tab is never saved, but shows "Saved"](#i1--high-renaming-a-draft-outside-the-content-tab-is-never-saved-but-shows-saved)
3. [I2: The revert toast's Undo overwrites edits made after the revert](#i2--high-the-revert-toasts-undo-overwrites-edits-made-after-the-revert)
4. [I3: Renaming a variable with Email off orphans its chips in the subject](#i3--high-renaming-a-variable-with-email-off-orphans-its-chips-in-the-subject)
5. [I4: A panel drop followed by a block move orphans comment threads](#i4--high-a-panel-drop-followed-by-a-block-move-orphans-comment-threads)
6. [S3: Maker-checker only stops the submitter, not the author](#s3--high-maker-checker-only-stops-the-submitter-not-the-author)
7. [D2: Setting a new sunset brings a sunset version back to life](#d2--high-setting-a-new-sunset-brings-a-sunset-version-back-to-life)
8. [D3: Editing the approval chain mid-review stalls or skips stages](#d3--high-editing-the-approval-chain-mid-review-stalls-or-skips-stages)
9. [D4: The chain editor saves chains nobody can approve](#d4--high-the-chain-editor-saves-chains-nobody-can-approve)
10. [I5: A draft rename goes live without review](#i5--high-a-draft-rename-goes-live-without-review)
11. [T1: main fails e2e: the undo/redo merge added a layout shift](#t1--high-main-fails-e2e-the-undoredo-merge-added-a-layout-shift)
12. [S5: Consumer identity is a self-asserted header](#s5--high-consumer-identity-is-a-self-asserted-header)
13. [S6: Body size limits trust the declared Content-Length](#s6--medium-body-size-limits-trust-the-declared-content-length)

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

- **Status:** Open
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

- **Status:** Open
- **Where:** `src/app/api/drafts/[versionId]/route.ts` line 18; `src/app/api/v1/templates/[templateId]/render/route.ts` line 127
- **What happens:** Both routes compare the `Content-Length` header, then call `request.text()`. A chunked body has no length, so the whole body is buffered. The autosave route reads the body before any permission check and never checks the size after reading; the render route is anonymous. Render values have no length cap either: one 100,000-word value costs about a second of main-thread CPU in the PDF.
- **Fix:** Reuse `readBodyCapped` from `src/server/import/read-body.ts`, authorize before reading, and add a `maxLength` per value in validation and the schema.
- **Evidence:** verified

#### S7 · Medium: Comments are accepted on any version state

- **Status:** Open
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

- **Status:** Open
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

- **Status:** Open
- **Where:** `src/domain/lifecycle.ts` line 198; `src/domain/lifecycle.test.ts` line 203
- **What happens:** Revoke is allowed on the Active version, the emergency case for wrong legal text. Afterwards `planDraftStart` finds the latest version revoked and refuses with "Only an Active template can be edited." Nobody can make the corrected draft. A test asserts this behavior; the demo only revokes Superseded versions, so it never shows.
- **Fix:** Product call needed: allow a new draft from the revoked or latest released content, using the newest version that still renders as the contract baseline. Update the test.
- **Evidence:** verified

#### D2 · High: Setting a new sunset brings a sunset version back to life

- **Status:** Open
- **Where:** `src/domain/lifecycle.ts` line 723
- **What happens:** `setSunset` checks only that the version is Superseded and the new date is after today. It never checks that the old sunset already passed. v1 sunset October 1 stops rendering; setting December 1 makes it render again. The Versions screen offers this.
- **Fix:** Refuse when the current `sunsetAt` is in the past, and add the `sunsetPassed` transition the plan lists (see D7).
- **Evidence:** verified

#### D3 · High: Editing the approval chain mid-review stalls or skips stages

- **Status:** Open
- **Where:** `src/domain/platform-config.ts` line 486; `src/domain/approval-chain.ts` line 68
- **What happens:** Chain [Legal (Dana), Team]: Dana approves Legal, the chain is reordered to [Team, Legal], Jordan approves Team, the version waits on Legal again and Dana is refused as having approved an earlier stage. It's stuck for good. Adding a stage before the current one lets waiting versions skip it. The stepper reads past decisions against today's chain by position, so Jordan's old approval shows as "Legal: done by Jordan". `versions.current_stage` is a position, not a stage id.
- **Fix:** Snapshot the chain (stage ids and names) on each version at submit and match decisions by stage id.
- **Evidence:** reproduced

#### D4 · High: The chain editor saves chains nobody can approve

- **Status:** Open
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

- **Status:** Open
- **Where:** `src/domain/lifecycle.ts` line 933; `src/domain/render/version-rules.ts` line 31
- **What happens:** "Sunset on March 1" stops renders at 7 PM Eastern on February 28. The port needs an explicit rule.
- **Fix:** Store a calendar date plus a business time zone, or an instant chosen in the UI, and document which.
- **Evidence:** traced

#### D7 · Medium: Nothing records when a sunset passes

- **Status:** Open
- **Where:** `src/domain/lifecycle.ts` line 712
- **What happens:** The build plan's audit list includes "sunset set or passed" and the implementation plan lists a `sunsetPassed` transition. Neither exists, so the audit never shows when a version stopped rendering. The "sunset passed" test is also written out four times (`usage.ts`, `versions.ts`, `consumer-api.ts`, `version-rules.ts`).
- **Fix:** One domain predicate and a sweep, like `sweepAccess`, that writes `version.sunset_passed`.
- **Evidence:** traced

#### D8 · Medium: Variable renames are lost between the panel and submit

- **Status:** Open
- **Where:** `src/domain/lifecycle.ts` line 297; `src/components/submit/contract-lines.ts` line 34
- **What happens:** The variables panel diffs with renames; submit, review and notices don't, so a rename is stored as removed plus added and `key_renamed` is never saved. `ContractChange` is one type with optional fields rather than a union per kind, which is why callers need `?? change.key` fallbacks.
- **Fix:** A discriminated union per change kind, and keep rename information through submit.
- **Evidence:** traced

#### D9 · Medium: "Today" and "yesterday" disagree between screens

- **Status:** Open
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

- **Status:** Partly fixed. us_state lookups use `Object.hasOwn` (PR #6). `parseInstant`, `localeCompare` ordering and `canonicalAction` remain.
- **Where:** `src/domain/audit.ts` line 93; `src/domain/golive/api-errors.ts` line 61
- **What happens:** A plain-object lookup with untrusted keys (`canonicalAction("toString")` returns a function). `parseInstant("2026-02-30")` rolls over to March 2. `localeCompare` orders ids and names (ICU collation, unlike Java's `compareTo`). If a key is renamed and a new variable reuses the old key, the diff reports only the rename.
- **Fix:** Use `Map` or `Object.hasOwn`; validate dates by round-trip; compare ids by code point; fix the contract matcher.
- **Evidence:** reproduced

### Editing, autosave and UI correctness

#### I1 · High: Renaming a draft outside the Content tab is never saved, but shows "Saved"

- **Status:** Open
- **Where:** `src/components/workspace/name-field.tsx` line 103; `src/components/workspace/session/session-store.ts` line 329; `src/components/workspace/content/content-workspace.tsx` line 119
- **What happens:** The name field sits in the header on every tab, but only the Content tab binds the autosave session. Reload or deep-link into Versions, Usage or Activity, rename the template, and the change is parked in `held`; `flush()` resolves at once and the status stays "Saved". Leaving the template discards it.
- **Fix:** Bind the session from the template layout (the header query already knows the draft), or make the name read-only until a draft is bound.
- **Evidence:** verified

#### I2 · High: The revert toast's Undo overwrites edits made after the revert

- **Status:** Open
- **Where:** `src/components/workspace/save-status.tsx` line 171; `src/components/workspace/session/session-store.ts` line 369
- **What happens:** Undo stays live for the toast's lifetime and `restore(previous)` applies the pre-revert values unconditionally. Revert, type a paragraph, click Undo: the paragraph is gone, and the remount already wiped the editor's history. If the author switched tabs first, `restore` sends content the hidden editor doesn't show, and the next keystroke saves the reverted content over it. New in the undo/redo merge.
- **Fix:** Track a save generation and make `restore` refuse (and dismiss the toast) when anything was edited since, or when not every field is on screen.
- **Evidence:** verified

#### I3 · High: Renaming a variable with Email off orphans its chips in the subject

- **Status:** Open
- **Where:** `src/editor/state/editor-root.ts` line 317; `src/components/workspace/content/email-details.tsx` line 48
- **What happens:** With Email off, the subject and preheader fields unmount, so a rename doesn't reach them. Turn Email back on: the subject shows an unknown chip, the saved subject keeps the old key, and Submit fails with "Define or remove {{first_name}}". The hidden chips aren't counted either, so the variable can be deleted as unused without the confirm dialog.
- **Fix:** Keep the fields mounted but hidden, or apply the root's rename forwards and tombstones when a field mounts.
- **Evidence:** reproduced

#### I4 · High: A panel drop followed by a block move orphans comment threads

- **Status:** Open
- **Where:** `src/editor/extensions/field-binding.ts` line 90
- **What happens:** Dropping a variable row from the panel sets UniqueID's private paste flag, and the custom drop handler consumes the event before the flag is reset. The next drag-handle move strips the moved block's ids. Threads anchored to it fall to "On removed content" and the redline sees a delete plus an insert.
- **Fix:** Handle the panel drop in `handleDOMEvents.drop` ahead of UniqueID, or add a `text/plain` payload so the flag is consumed. Add a regression test.
- **Evidence:** reproduced

#### I5 · High: A draft rename goes live without review

- **Status:** Open
- **Where:** `src/server/drafts/apply-patch.ts` line 165; `src/server/render/channels/web.ts` line 79
- **What happens:** Autosave writes `templates.name` directly. The name isn't versioned, so the Active version's web ``, PDF title metadata, API `name` and notice payloads change the moment an author types. The RenderDoc documents the name as internal-only, yet browsers show both titles to customers.
- **Fix:** Make the name a version field, and give customer output its own title (the first heading or a dedicated field).
- **Evidence:** verified

#### I6 · Medium: After a save conflict the editor stays editable but nothing saves

- **Status:** Open
- **Where:** `src/components/workspace/autosave/autosave-scheduler.ts` line 194
- **What happens:** After `conflict`, `forbidden` or `not_draft`, the scheduler stops for good and drops every later edit. The only signal is a muted "Reload to continue", and reloading loses what was typed since. Found by two reviewers.
- **Fix:** Switch the editor to read-only when saving stops and offer Reload in the page.
- **Evidence:** traced

#### I7 · Medium: No error boundaries anywhere

- **Status:** Open
- **Where:** `src/app/(product)`
- **What happens:** There is no `error.tsx` or `global-error.tsx`. Any error thrown inside a streamed section, or a backend outage, replaces the whole app with Next's default error page.
- **Fix:** Add `(product)/error.tsx`, `templates/[templateId]/error.tsx` and `global-error.tsx`.
- **Evidence:** traced

#### I8 · Medium: Submit can freeze content the dialog didn't list

- **Status:** Open
- **Where:** `src/components/workspace/workspace-actions.tsx` line 110; `src/server/actions/review.ts` line 249
- **What happens:** The editor stays editable while Submit flushes and fetches the summary, and `submitVersion` sends no rev, so saves that land in between are frozen unseen. Keystrokes still debouncing go out after the host unmounts and fail silently with `not_draft`. Likely, not reproduced.
- **Fix:** Put `rev` in the summary and make submit a compare-and-set; make the document inert from the moment Submit is clicked.
- **Evidence:** traced

#### I9 · Medium: "Revert to vN" has no error handling or pending guard

- **Status:** Open
- **Where:** `src/components/workspace/save-status.tsx` line 174
- **What happens:** A failed `getBaseVersion` call is an unhandled rejection with no feedback, and a double activation stacks two replaces and two Undo toasts. `getBaseVersion` also returns the base of whichever draft the template has, not the one on screen.
- **Fix:** Use the transition plus `runAction` pattern, disable the item while pending, and pass the version id.
- **Evidence:** verified

#### I10 · Medium: Large drafts can lose the last edits on tab close

- **Status:** Open
- **Where:** `src/components/workspace/autosave/save-transport.ts` line 13
- **What happens:** Bodies over 60 KB aren't sent with `keepalive` on pagehide, and there is no `beforeunload` guard. Long disclosures pass 60 KB easily because every block carries a UUID.
- **Fix:** A `beforeunload` prompt while the status isn't saved, or send diffs.
- **Evidence:** traced

#### I11 · Medium: The UI branches on exact English sentences

- **Status:** Open
- **Where:** `src/components/review/decision-model.ts` line 42; `src/components/versions/version-actions.tsx` line 157
- **What happens:** `reason === REASONS.generic` decides hidden versus blocked, and `reason === REASONS.ownRevoke` decides whether Confirm revoke shows. A copy edit, or a Spring backend wording things differently, silently changes behavior.
- **Fix:** Give every permission result a stable `code` and branch on it.
- **Evidence:** traced

#### I12 · Medium: Every page ships the whole template catalog, and the palette keeps the last persona's data

- **Status:** Open
- **Where:** `src/components/app-shell/top-bar-hole.tsx` line 12; `src/components/app-shell/command-palette.tsx` line 168
- **What happens:** The top bar loads every visible template and its versions into the RSC payload on every page and every `refresh()`, then the palette fetches the same catalog again. Its per-space cache isn't cleared on persona change and wins over fresh props until a refetch succeeds.
- **Fix:** Search server-side on open, and key the cache by viewer.
- **Evidence:** traced

#### I13 · Medium: Blocked decisions and charts aren't accessible

- **Status:** Open
- **Where:** `src/components/review/decision-rail.tsx` line 152; `src/components/usage/charts.tsx` line 332
- **What happens:** Blocked Approve and Request changes use native `disabled`, so the reason can't be reached by keyboard, against the repo's own `aria-disabled` convention. Stacked bars and the rate line expose only a short label; series differ by lightness of one hue; values are hover-only.
- **Fix:** `focusableWhenDisabled` as elsewhere; `sr-only` tables for every chart, like the heatmap has.
- **Evidence:** traced

#### I14 · Low: Every ⌘B in the editor also toggles the hidden sidebar

- **Status:** Open
- **Where:** `src/components/ui/sidebar.tsx` line 97
- **What happens:** The stock shadcn provider registers a window-level ⌘B listener that ignores `defaultPrevented`. Bold also toggles sidebar state and writes the `sidebar_state` cookie; the sidebar is `collapsible="none"`, so nothing visible happens.
- **Fix:** Remove the listener (this is a deliberate edit to a generated file; note it).
- **Evidence:** verified

#### I15 · Low: Focus and Esc handling is wired through DOM queries

- **Status:** Open
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

- **Status:** Open
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

- **Status:** Open
- **Where:** `src/server/queries/consumer-api.ts` line 264; `src/contracts/api-v1.ts` line 211
- **What happens:** Notices come newest-first with `since` and `limit` and no cursor or `hasMore`. A consumer polling with `since=lastSeen` that has more than `limit` new notices loses the oldest, which could be a revoke. Search is capped at 50 with no paging.
- **Fix:** Oldest-first opaque cursor (`after`), `nextCursor` and `hasMore`; paging for search.
- **Evidence:** traced

#### A3 · Medium: Six error shapes, and some actions throw

- **Status:** Open
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

- **Status:** Open
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
- **Where:** `src/server/actions/integration.ts` line 25
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

- **Status:** Partly fixed. The document rules (normalization, the content check, markers, links) are now single shared modules under `src/editor/model/` (PR #6). The lifecycle, comment and approver rules listed here are unchanged.
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

- **Status:** Open
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

- **Status:** Open
- **Where:** `src/server/actions/review.ts` line 60; `src/server/actions/access.ts` line 61; `src/server/actions/platform.ts` line 48
- **What happens:** Some actions throw, most return `ActionResult`; access parses before authorizing, platform authorizes first, review looks up, checks, then rejects. `Refusal`, `check` and `transact` are copied three times; the client-side `useActionRun` pattern four times.
- **Fix:** One shared, non-`"use server"` kit and one client hook.
- **Evidence:** traced

#### H2 · Medium: Client components re-implement domain rules

- **Status:** Open
- **Where:** `src/components/settings/platform/content-types.tsx` line 94; `src/components/settings/team/rows.tsx` line 20
- **What happens:** The content-types screen calls the real domain function on every render with a blank actor and `new Date(0)`. Teams and approval-chain screens mirror the server's refusal ladders; several settings views hard-code consequence sentences and compute due dates themselves. The platform channel screen does it right with `channelOffConsequences`.
- **Fix:** Server returns `can` plus consequence lines; for live validation, one exported pure `validateX` per rule.
- **Evidence:** verified

#### H3 · Medium: Forked primitives

- **Status:** Open
- **Where:** `src/components/preview/controls.tsx` line 20
- **What happens:** The segmented control is copied four times, a stat card three times, tablists hand-rolled twice beside Base UI tabs, clipboard-with-fallback three times, channel label maps three times, team icon maps three times.
- **Fix:** Promote each to `components/primitives` and delete the copies.
- **Evidence:** traced

#### H4 · Medium: Formatting helpers are duplicated and clash

- **Status:** Partly fixed. Variable values now have one formatting module (PR #6). The UI's date, plural and number helpers are still duplicated.
- **Where:** `src/domain/activity.ts` line 114; `src/domain/audit.ts` line 686
- **What happens:** An identical `date()` in two domain files; seven `plural` definitions; six or more "days ago" helpers; 13 `NumberFormat` instances; same-named functions with different signatures (`fmtDay`, `relativeTime`, `dayLabel`). `domain/dates.ts` calls itself the one way to write a date.
- **Fix:** Make `domain/dates.ts` plus one number and plural module the only homes.
- **Evidence:** traced

#### H5 · Low: Rebrand leftovers, two of them customer-visible

- **Status:** Open
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
- **The enterprise font.** Swap it into `src/server/render/channels/pdf-fonts.ts` (fix the font paths and names in [T8](#t8--medium-runtime-paths-assume-the-dev-machine) and [H5](#h5--low-rebrand-leftovers-two-of-them-customer-visible) at the same time), then `npm run golden:update` refreshes the Node-only PDF files.
- **PDF cell detection for Java.** The parity test finds PDF table cells from the rules the Node adapter draws; a Java engine needs its own way, as `docs/render-spec.md` notes.
