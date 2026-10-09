# 0005. A revert's Undo goes as soon as anything else changes

Status: Accepted
Date: 2026-10-08

## Context

The save status menu offers "Revert to when you opened it" and "Revert to v3"
([save-status.tsx](../../src/components/workspace/save-status.tsx)). Each shows a toast with Undo for 10 seconds,
which puts back the values the revert replaced. A revert remounts the editor, so ⌘Z can't reach back past it, and
the toast's Undo is the only way back.

Undo used to apply those values whatever had happened since
([I2](../handoff-review.md#i2--high-the-revert-toasts-undo-overwrites-edits-made-after-the-revert)). A paragraph
typed after the revert was lost, with no history left to recover it. After a switch to another tab, Undo saved
content that the hidden editor didn't show, and the next keystroke there saved the reverted content back over it.
"Revert to v3" also had no pending guard or error handling
([I9](../handoff-review.md#i9--medium-revert-to-vn-has-no-error-handling-or-pending-guard)).

## Decision

- The workspace session counts edits: every save, revert, replace and restore, and binding another draft
  (`getEditGeneration` in [session-store.ts](../../src/components/workspace/session/session-store.ts)).
  `restore` takes the count from just after the revert and refuses, changing nothing, once it has moved, or when
  a field it would put back has no part of the page on screen to show it.
- The toast watches the session and goes as soon as Undo would be refused: with the first keystroke after the
  revert, or when the Content tab is left. An Undo that is offered always works, and it never drops an edit. A
  name-only revert keeps its Undo on every tab, since the name field is in the header on all of them.
- "Revert to v3" reads the base of the draft on screen, by its version id. While the read is out, the menu stays
  open with both items greyed out and "Reverting…" under the one pressed, so a second press can't start another. A
  failure (a refusal, or a thrown error through `runAction`) shows in a toast.
- The owner's rule applies: an action pressed from a button doesn't scroll the page. The remount after a revert
  or an Undo briefly shortens the page, which made the browser clamp the canvas's scroll to the top. The Content
  page puts the canvas back where it was in the same commit.

## Alternatives considered

- **Keep Undo, and merge it with the newer edits.** There is no sound merge of a whole-document revert with edits
  typed into the reverted content, and a wrong merge is lost work that nobody sees.
- **Keep the toast, and refuse with a message when Undo is pressed.** It offers something it won't do. Taking the
  toast away is quieter and leaves nothing to misread.
- **Close the menu at once and only show the outcome.** The pending state would show nowhere, and a slow backend
  would look like a press that did nothing.

## Consequences

- An author who types even one character after a revert can't undo the revert from the toast. Reverting is still
  on offer from the menu.
- Every save now notifies the session's subscribers (they read snapshots that rarely change, so nothing re-renders).
- [I1](../handoff-review.md#i1--high-renaming-a-draft-outside-the-content-tab-is-never-saved-but-shows-saved) and
  [I6](../handoff-review.md#i6--medium-after-a-save-conflict-the-editor-stays-editable-but-nothing-saves) will
  change the same store: whatever they add that changes the draft should move the edit generation.
