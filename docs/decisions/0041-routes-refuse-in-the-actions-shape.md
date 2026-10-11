# 0041. The browser's routes refuse in the shape server actions do

Status: Accepted
Date: 2026-10-11

## Context

Every refusal carries a stable code ([0025](0025-refusals-carry-stable-codes.md)) and every server action answers
`{ ok: false, code, reason }` on one kit ([0029](0029-every-action-runs-on-one-kit.md)). Three of Stencil's own route
handlers still had shapes of their own ([A3](../handoff-review.md#a3--medium-six-error-shapes-and-some-actions-throw)):
the autosave route's `DraftSaveResponse` (`error`, `message`, `rev?`), import's `ImportResponse` with codes of its own
(`size`, `type`, `permission`) and `{ error: "not_found" }` on its two reads, and the audit export's plain text with a
status. A backend that ports them had three more vocabularies to keep, and the browser branched on each.

## Decision

- **A refusal from these routes is `{ ok: false, code, reason }`**, with a code from a refusal table built with
  `refusal(code, sentence)`, unique across the tables (`refusals.test.ts`), and a status that still says the kind.
  Success bodies are as they were.
- **Autosave.** `version_gone` (404) and the permission refusal `generic` (403) before the body is read;
  `version_not_draft` (409, new); `draft_changed` (409, reused, carrying the current `rev`); `draft_too_large` (413,
  new); and 400 for the patch itself: `invalid_input` for a body that doesn't parse, a name or a document the check
  refuses (the sentence is the first problem found), and `no_channels` / `channel_unavailable` from
  `draftChannelsRefusal`. The scheduler decides by code: the four patch refusals wait for the next change, and
  any other code stops saving for good, so a refusal nobody planned for never overwrites silently. The four known
  stopping codes keep the screen's own sentences; an unknown one shows the server's.
- **Import.** `IMPORT_REFUSALS` is a table of `refusal()` entries (`import_unsupported_type`, `import_legacy_doc`,
  `import_not_pdf`, `import_not_word`, `import_too_large`, `import_empty`, `import_unreadable`, `import_too_long`,
  `import_pdf_no_text`, `import_pdf_locked`, `import_pdf_pages`, and the worded `import_content`, whose sentence
  ends with the document check's). `permission` is gone: it was the permission refusal under another name, so a viewer
  who may not create is answered `generic`. `importStatus` maps by code: 413, 415, 400 for the file's own refusals,
  403 for any other. The converters and the worker keep calling a failure by its key (`pdfLocked`), and the route
  turns it into the entry. The file and view reads answer `upload_unavailable` (404, new) through `readResponse`.
  The browser answers a response that isn't one of the route's with `failed`, the code it already gives its own
  refusals.
- **Audit export.** `getAuditExport` returns a `ReadRefusal` (status, code, reason): `generic` (403) for a viewer
  without `audit.view`, `space_unavailable` (404) for an unknown team, answered by `readResponse`. The Export button is
  now a client component: a plain click fetches the file and saves it, or shows the refusal's sentence in a toast; a
  modified click and a page without its script fall back to the download anchor.
- **Not changed.** `/api/v1` keeps its `{ error: { code, message } }` until the Java API decides its problem details,
  and Coral's routes keep the simulator's `SimResult`.

## Alternatives considered

- **Rename the fields and keep each route's codes.** `{ ok: false, code, reason }` with `size` and `not_draft` would
  look uniform and still be four vocabularies, two of them reusing a word for different things.
- **RFC 9457 problem details for these routes too.** The browser's clients already read the actions' shape through
  `readTemplate`, and the public half waits for the Java API; one change for both would have waited with it.
- **A code of its own for the audit export's 403** ("You don't have access to this audit log."). `generic` already
  means no role gives this, and the backend keeps one code fewer. The sentence is now the common one.
- **Leave the Export button a plain anchor.** Chrome fails a download whose response is a 403 without showing the
  body, so the refusal could never be read.

## Consequences

- One shape for every refusal the browser can receive; a Spring backend that serves these routes returns the same
  codes, and the codes are the contract. The wire change is breaking, which is fine before there are users.
- `REQUEST_REFUSALS` gained `version_not_draft`, `draft_too_large` and `upload_unavailable`; `RefusalCode` gained the
  twelve import codes.
- The 403 on the audit export reads "You don't have access to do this."; a missing team reads "This team isn't
  available to you."
- A route that adds a refusal adds a table entry, and, for autosave, decides in `stopsSaving` whether it ends saving.
- A3 stays partly fixed: only `/api/v1` is left.
