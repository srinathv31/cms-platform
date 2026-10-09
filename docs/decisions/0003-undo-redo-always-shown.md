# 0003. Undo and redo are always shown, greyed out when idle, before the save status

Status: Accepted
Date: 2026-10-08

## Context

The draft's status row carries undo and redo buttons beside "Saved"
([save-status.tsx](../../src/components/workspace/save-status.tsx)). They first appeared only once there was history,
and the status gains a menu chevron ("Revert to v1") once the Content tab is on screen, which the server can't know.
Both changed the row after hydration, and the zero-layout-shift check in
[e2e/principles.spec.ts](../../e2e/principles.spec.ts) failed on every draft started from an earlier version
([T1](../handoff-review.md#t1--high-main-fails-e2e-the-undoredo-merge-added-a-layout-shift)).

## Decision

The owner's rules for the buttons:

- Always show both, undo and redo.
- When one has nothing to do, or the editor's history isn't ready yet (before hydration, and on the Versions, Usage
  and Activity tabs), show it disabled and visibly greyed, with a tooltip saying why ("Nothing to undo"). Never hide
  it. Use Base UI `Button` with `focusableWhenDisabled`, which sets `data-disabled` rather than the native
  `disabled`, and style it with `data-disabled:` variants.
- A click doesn't scroll the page: the buttons use `undoNoScroll` and `redoNoScroll`. ⌘Z may scroll.

To hold their place from the first paint, the server renders both buttons, and they sit before the save status:
`↶ ↷ Saved ⌄`. Everything that changes after hydration (the status's text as it saves, its revert chevron) is then
to their right and moves nothing.

## Alternatives considered

- **Keep them after the status** (`Saved ⌄ ↶ ↷`). Measured: the chevron's arrival moves both buttons 16px right on
  load, a larger shift than the one being fixed. Every "Saving…" to "Saved" also moves them about 11px, so a second
  click can land beside the button.
- **Reserve the chevron's and the longest status's width** after the text. Leaves a visible gap after "Saved" on
  most drafts, and a long error message still moves the buttons.
- **Decide on the server whether the Content tab is showing** (`useSelectedLayoutSegment`), so the chevron renders
  from the first paint. Fixes the load, not the width changes while saving, and the menu would show before the
  editor that carries out the revert has mounted.

## Consequences

- An untouched draft now shows two greyed icons where it used to show none.
- The status's own width can still change (the chevron moves as "Saving…" becomes "Saved"); nothing after it does.
- `UndoRedo` renders on the server, so the platform's shortcut (⌘ or Ctrl) is read after hydration, not during render.
