# 0029. Every server action runs on one kit, and the browser runs them with one hook

Status: Accepted
Date: 2026-10-09

## Context

The server actions had three styles ([H1](../handoff-review.md#h1--medium-three-server-action-styles)). Review
actions looked a record up, checked the permission, then rejected bad input; access actions parsed first; platform
actions checked first. `RefusalError`, `refuse`, `check` and `transact` were private copies in three files, because a
`"use server"` file may export only actions. `startDraft` (Edit) and `createTemplate` (New template) threw their
refusals, so in production the person saw "Couldn't open a draft. Try again." instead of the domain's sentence
([A3](../handoff-review.md#a3--medium-six-error-shapes-and-some-actions-throw)). In the browser the same "one
request at a time, show the refusal" hook was written four times.

## Decision

- **One kit.** `serverAction(input, steps)` in `src/server/actions/kit.ts`, a `server-only` module that isn't
  `"use server"`, runs every action's steps in one order: `getViewer()`, parse with zod, `authorize` (read what the
  input names to learn whom to check, `check()` or `permit()`, refuse what's gone or too long), `now()` once, one
  `inTransaction` (busy retry), then `after` on success (revalidate, refresh, `redirect()` last). Each exported
  action stays a named `async function` with its own input type and calls the kit.
- **A refusal is a value.** `refuse(refusal)` in `authorize` or the transaction, or a transaction returning
  `{ ok: false, … }`, rolls the transaction back and is answered as `{ ok: false, code, reason }`. Anything else
  thrown is a bug and propagates; so does Next's redirect from `after`.
- **Input that doesn't parse is `invalid_input`**, unless the action names its own answer (access actions give the
  parser's first problem, `markNotificationRead` answers `notification_gone`). Review and comment actions used to
  answer `generic` for it, and platform actions checked the permission first; the UI never sends such input.
- **Access keeps two differences**, in `accessAction`: a request, membership or review that's gone is refused with
  its own sentence before the check (a colleague acting first deletes it, and the admin should read that), and the
  access sweep runs once the check has passed, outside the transaction.
- **Edit and New template answer their refusals** and still redirect on success. `planDraftStart` returns a coded
  refusal (`newer_in_review`, `not_editable`). Two Edit presses at once insert with `ON CONFLICT DO NOTHING` on the
  one-open-draft index, and the second opens the first's draft. The browser shows Edit's refusal in the toast that
  used to say only that it failed, and New template's under the cards.
- **One hook in the browser.** `useActionRun` (`src/components/primitives/use-action-run.ts`) runs an action in a
  transition, one at a time, with the refusal's sentence, `onOk` and `onRefused`; a thrown call is the code `failed`
  with the screen's own sentence, and `runAction` hands Next's redirect back to Next. `useActionDialog` is built on
  it, and the Team and Platform settings share one `Strip` (`src/components/settings/strip.tsx`).
- **The demo tools stay outside the kit.** `resetDemoAction`, `advanceClockAction` and `switchPersona` check no
  permission and call modules that write in their own transactions. Input they can't use is answered with
  `invalid_input` rather than thrown.

## Alternatives considered

- **A factory that returns the action** (`export const setSunset = action({...})`). The exported action's input type
  would be inferred from the schema rather than declared where client code reads it, and a named `async function`
  that calls the kit reads like any other function.
- **Share the helpers and leave the order to each action.** It removes the copies but not the three orders, which
  was the finding.
- **Return the workspace address and navigate in the browser** instead of redirecting from Edit and New template. It
  costs a second round trip and changes what Back does; the redirect already works, and `runAction` can tell it apart.

## Consequences

- A new action is its steps on the kit; the order and the refusal handling can't drift. A Spring Boot backend that
  ports an action ports the same steps.
- Any refusal an action can give reaches the person as its sentence, with a code a screen can branch on.
- Malformed input reads "Check the form and try again." where it used to read "You don't have access to do this."
- Not in this decision: the autosave route still answers `DraftSaveResponse` (`error`, `message`), import keeps its
  own codes, and `/api/v1` waits for the Java API ([A3](../handoff-review.md#a3--medium-six-error-shapes-and-some-actions-throw)).
