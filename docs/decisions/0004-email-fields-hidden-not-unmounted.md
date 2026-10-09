# 0004. Email fields are hidden while Email is off, not unmounted

Status: Accepted
Date: 2026-10-08

## Context

The email subject and preheader are inline fields in the same editor root as the document. The root rewrites chips
when a variable's key changes, removes them when a variable is deleted with "Remove chips", and counts them for the
variables panel, but only in fields that are mounted. With Email off, the Email details group returned nothing, so the
fields left the root. A rename made then never reached the subject: with Email back on it showed an unknown chip, the
saved subject kept the old key, and Submit failed with "Define or remove {{first_name}}". The hidden chips didn't count
either, so a variable used only in the subject could be deleted as unused, without the confirm dialog
([handoff review I3](../handoff-review.md#i3--high-renaming-a-variable-with-email-off-orphans-its-chips-in-the-subject)).

## Decision

- With Email off, `EmailDetails` keeps the group and both fields mounted, with `hidden` on the group.
- `InlineVariableField` takes a `hidden` prop. A hidden field stays registered with its root: its chips count in the
  panel and the chip popover's "where it's used", renames and deletes reach it, and it saves through `onChange` like a
  visible one. Click-to-insert, undo and redo pass it by, as if it had gone (the root's `setFieldHidden` clears it as
  the last-focused field), until it shows again.

## Alternatives considered

- **Replay renames and deletes when a field mounts.** The root would apply its rename forwards and tombstones to a
  field's content as it mounts. That fixes the chip shown when Email comes back on, but while Email is off the saved
  subject still holds the old key and its chips still don't count. Both would need the root to keep and rewrite the
  content of fields that aren't there, which is what a mounted, hidden field already does.
- **Clear the subject and preheader when Email is turned off.** It loses what the author typed, and turning a channel
  off for a moment shouldn't cost work.

## Consequences

- Every draft's Content tab mounts two small one-line editors, even when Email is off.
- While Email is off, a variable used in the subject shows "Email subject" among the places it's used, and its row
  isn't muted as unused. Deleting it asks first, and "Remove chips" removes it from the subject too.
- A host that wants to put any inline field away for a while passes `hidden` rather than unmounting it (see
  [src/editor](../../src/editor/README.md#composition)).
