# 0025. Every refusal carries a stable code, and code branches on the code

Status: Accepted
Date: 2026-10-09

## Context

A refusal was `{ ok: false, reason }`, the sentence people read. Three screens told refusals apart by comparing that
sentence: the review screen hid the decision buttons when the reason was `REASONS.generic`, Confirm revoke stayed for
the approver who started the revoke when it was `REASONS.ownRevoke`, and the submit dialog offered Refresh summary
when it was `REFUSALS.summaryStale` ([I11](../handoff-review.md#i11--medium-the-ui-branches-on-exact-english-sentences)).
A copy edit, or a Spring Boot backend wording a refusal its own way, would silently change what those screens do.
Stable codes are also step 3 of [the backend seam](../handoff-review.md#the-backend-seam).

## Decision

- **A refusal is `{ ok: false, code, reason }`.** `PermissionResult`, `ActionResult`, the domain's `Refused` and the
  on-demand reads' `ReadRefusal` all carry the code wherever they carry the sentence. `src/domain/refusals.ts` holds
  the types, `refusal()`, `refuse()`, and `RefusalCode`, the union of every code.
- **Codes live beside their sentences.** Each area keeps its table (`REASONS`, `REFUSALS`, `STAGE_REFUSALS`,
  `COMMENT_REFUSALS`, `ACCESS_REFUSALS`, `PLATFORM_REFUSALS`), and every entry is `refusal("own_revoke", "You started
  this revoke. …")`, or a function of what the sentence names (`refusal("last_admin", (team) => …)`) whose `code` is
  readable without calling it. `RefusalCode` is derived from the tables, so a refusal without an entry doesn't
  type-check.
- **Codes are short snake_case identifiers, unique across every table**, like the `/api/v1` error codes.
  `refusals.test.ts` checks both, and fails if code under `src/components`, `src/server`, `src/app` or `src/lib`
  compares a refusal's sentence.
- **What the server refuses before a rule runs is in the domain too** (`REQUEST_REFUSALS`): input that doesn't parse,
  a record that's gone, a read with nothing to read, a compare-and-set that missed. These sentences were private
  tables in five action and read files, some repeated; each is now one entry. Sentences written inline in actions
  (an Auditor as a new team's admin or a requester, an access request or review already settled) became entries in
  their area's table.
- **A refusal made in the browser has the code `failed`** (the call threw, or the server couldn't be reached) and the
  screen's own sentence.
- **Code that tells refusals apart compares codes**: `generic` hides the decision buttons, `own_revoke` keeps Confirm
  revoke, `summary_stale` offers Refresh summary. Sentences are copy and can be reworded freely.

## Alternatives considered

- **Key the tables by code** (`REASONS.own_revoke` as the sentence, as `IMPORT_REFUSALS` does). Several areas reuse
  the same key for different refusals (`giveReason`, `notInReview`, `pickRole`), so the keys would have to be
  renamed and every caller with them. Entries carrying their code left the callers alone: `refuse(REFUSALS.x)` reads
  as before.
- **One central table of every code and sentence.** Sentences that name a role or a date import from their area
  (`ROLE_LABEL`, `formatLongDate`), so a central table would import every area and every area it. The derived union
  gives the one list without moving the sentences.
- **An optional code.** It would have let a refusal without one through; the contract is the code, so it is required.

## Consequences

- A backend that ports a rule returns the same code; the UI keeps working whatever sentence comes with it.
- A new refusal needs a table entry with a code no other refusal has. Reusing a meaning reuses its entry.
- The compare read's sentence for a template the viewer can't see is now "This template isn't available.", the one
  the other reads use (it was "… available to you."); the Compare dialog doesn't show it.
- Not in this scheme: import refusals keep their own codes (`ImportResponse.code`, keyed like `IMPORT_REFUSALS`), the
  autosave route answers `error` codes, `/api/v1` has `ApiErrorCode`, the audit export answers a status with a
  sentence, and `planDraftStart`'s blocked reason is thrown by `startDraft` rather than returned
  ([A3](../handoff-review.md#a3--medium-six-error-shapes-and-some-actions-throw)).
