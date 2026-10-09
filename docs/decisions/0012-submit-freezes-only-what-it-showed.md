# 0012. Submit freezes only what it showed

Status: Accepted
Date: 2026-10-09

## Context

"Submit for review" sends the pending autosave, reads a summary of the saved draft (channels, sample data, contract
changes) and shows it in a dialog. Submitting from the dialog froze whatever the draft held at that moment
([I8](../handoff-review.md#i8--medium-submit-can-freeze-content-the-dialog-didnt-list)). The editor stayed editable
while the summary loaded, and `submitVersion` took no `rev`, so a save that landed after the summary was read (from
this page or another tab) went into the version without being listed. Keystrokes still in the autosave debounce
went out after the page turned read-only and failed with `not_draft`, with nowhere left to say so.

## Decision

- **Submit is a compare-and-set on the summary's `rev`.** `getSubmitSummary` returns the draft's `rev`, and
  `submitVersion` requires it. The domain's `submit` takes it as `seenRev` and refuses a draft whose `rev` has moved
  (`REFUSALS.summaryStale`, "This draft changed after this summary was made."), before its content checks, so the
  author sees what changed before any other refusal about it.
- **The dialog offers to refresh.** On that refusal its one black button becomes "Refresh summary", which sends what
  is pending, reads the summary again and goes back to "Submit v{N}". The note is kept.
- **The workspace is inert from the click.** The session store has a general hold (`makeInert`, read with `useInert`)
  that stacks and is let go by the function it returns. While it is held, every part that edits the draft shows
  read-only without remounting: the editor root's `readOnly` (the document, the email fields, the variables panel,
  undo and redo), the channels (greyed out in place), the sample sets, the name (`readOnly`, keys ignored) and the
  revert menu (greyed out). `revert`, `replace` and `restore` refuse, so a revert's toast loses its Undo.
- **Submit takes the hold before it flushes,** not after: anything typed between the flush and the hold would
  otherwise be frozen unlisted, or sent after the page turned read-only. It lets go when the dialog closes without
  submitting, or when the save or the summary fails (the reason shows under the button). After a submit it keeps
  the hold until the button unmounts with the draft, so nothing can be typed into a version being frozen.
- **Autosave keeps running while held.** Disabling it would drop what it holds. Instead the submit flushes once more
  before sending: if something was still pending, its save moves the `rev`, and the server refuses the stale summary
  rather than freezing it.

## Alternatives considered

- **An optional `rev`.** A caller that left it out would freeze unlisted content, and a Java port would copy the
  hole. Every caller now sends it; tests read it with `draftRev`.
- **Refresh the summary automatically on a stale refusal.** The list would change under the author's eyes, with
  the same button still reading "Submit". Asking keeps one deliberate step between seeing and freezing.
- **The `inert` HTML attribute on the page.** It would keep every layout as it is, but it doesn't stop the header's
  undo, redo and revert, and it can't be the read-only state a stopped save needs (selecting text to copy must
  still work).
- **Disable autosave while held.** `setDisabled(true)` drops pending changes, which is the loss this fixes.

## Consequences

- While the hold is on, the variables panel shows its read-only layout (no New variable, Required as text), so the
  rail rearranges under the dialog's scrim. A panel that keeps its layout when read-only would need a change in
  `src/editor`.
- The dialog recognises the stale refusal by its sentence, like the other comparisons
  [I11](../handoff-review.md#i11--medium-the-ui-branches-on-exact-english-sentences) replaces with stable codes.
- [I6](../handoff-review.md#i6--medium-after-a-save-conflict-the-editor-stays-editable-but-nothing-saves) can take
  the same hold when saving stops, and never let it go.
- A variable form left open in the panel closes while the hold is on, and reopens on Cancel without what was typed
  into it. Unsaved, that text was never part of the draft.
