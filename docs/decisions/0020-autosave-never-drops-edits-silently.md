# 0020. Autosave never drops an edit without saying so

Status: Accepted
Date: 2026-10-09

## Context

The workspace's autosave session dropped edits in three ways and kept showing "Saved" or a muted line:

- **A rename outside the Content tab** ([I1](../handoff-review.md#i1--high-renaming-a-draft-outside-the-content-tab-is-never-saved-but-shows-saved)).
  The name field is in the header on every tab, but only the Content page bound the session to the draft. Opened
  on Versions, Usage or Activity, a rename was held for a host that never came, and the status stayed "Saved".
- **Anything typed after a refusal retrying can't fix** ([I6](../handoff-review.md#i6--medium-after-a-save-conflict-the-editor-stays-editable-but-nothing-saves)).
  After a `conflict` (another tab saved first), `forbidden`, `not_draft` or `not_found`, the scheduler stopped for
  good, but the page stayed editable and every later keystroke went nowhere.
- **A large draft's last edits on tab close** ([I10](../handoff-review.md#i10--medium-large-drafts-can-lose-the-last-edits-on-tab-close)).
  A body over 60 KB can't go out with `keepalive`, so the browser may cancel the request a closing page sends.

## Decision

- **The header binds the session, on every tab.** `getWorkspaceHeader` returns `draft: { versionId, rev }` for an
  editable draft, and `WorkspaceHeader` renders `BindDraft` with it (null otherwise, which unbinds). The Content page
  binds the same draft too, and never unbinds. Binding the draft already bound changes nothing, so the two are one
  autosave session and its `rev` carries on. Content keeps binding because a tab switch doesn't re-render the
  layout: its data can be newer than the header's, and an editable draft it shows must save. It doesn't unbind
  because a read-only Content page under a header that still holds a draft is stale the other way, and the server
  settles that: the next save is refused, and the session stops (below).
- **A stopped save holds the page.** The scheduler's state carries `stopped`. The session's host takes an inert
  hold (`makeInert`, [decision 0012](0012-submit-freezes-only-what-it-showed.md)) when it stops and keeps it until
  the host goes (another draft bound, or none). Everything that edits the draft turns read-only; text can still be
  selected and copied.
- **The status says so plainly, and offers Reload.** The status reads "Not saved." and a line of its own under the
  status row, the header's full width, gives the reason ("Your latest changes can't be saved — this draft changed
  elsewhere.") and an outline Reload button. The sentences no longer end in "Reload to continue": that was an
  instruction, and Reload is now a control.
- **Leaving with something unsaved asks first.** `useDraftAutosave` registers a `beforeunload` guard while the
  status isn't "saved": waiting to save, saving, retrying, and stopped (what wasn't saved is still on the page to
  copy). It sends what is pending as it asks, so staying lets it land. It is removed once everything is saved, so a
  saved page leaves without a word.

## Alternatives considered

- **Make the name read-only until the Content page binds.** It hides the bug instead of fixing it, and renaming
  from Versions is reasonable.
- **Only the header binds.** One binder is simpler, but after a tab switch the Content page can show a draft the
  stale header doesn't know about, and its edits would be held for good.
- **The reason and Reload inside the status row.** The row shares its line with the Template ID; at 1280 the
  sentence wrapped to three centred lines. A shorter sentence ("Can't save") wouldn't say that the latest changes
  are lost.
- **Let Reload skip the browser's question.** Reload goes through the same `beforeunload` guard as closing the tab,
  so the browser asks once more. It's the last chance to copy what wasn't saved, and it needs no special case.
- **Prompt only for drafts too large for `keepalive`.** A keepalive request can still fail, and the rule "asks
  while unsaved" is the one people know from other editors.

## Consequences

- Autosave runs on every tab of an editable draft, so the session's "when you opened it" starts when the template
  opens, not when the Content tab first shows.
- The header grows by one line when saving stops, the one time it does apart from a long name.
- A refused save is a 409 the browser logs; the e2e spec for it expects that one console error.
- Submit still works out its own refusal when saving has stopped: its popover shows the same sentence.
