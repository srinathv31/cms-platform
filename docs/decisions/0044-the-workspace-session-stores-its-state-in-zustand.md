# 0044. The workspace session stores its state in zustand

Status: Accepted
Date: 2026-10-11

## Context

Client state shared across subtrees was kept two ways. The editor's runtime
([editor-root.ts](../../src/editor/state/editor-root.ts)) holds its state in vanilla zustand stores. The workspace
session ([session-store.ts](../../src/components/workspace/session/session-store.ts)) and the Content page's live draft
([live-draft.ts](../../src/components/workspace/session/live-draft.ts)) each carried a hand-rolled store: a listener
`Set`, an `emit()`, a getter per value, and a `useSyncExternalStore` hook that repeated its server default as a
constant of its own (the saved status was written twice, in two files). The prototype's original build plan
(`docs/archive/implementation-plan.md`) chose zustand for the workspace; the session store was written by hand, then grew
fix by fix to the binding, the save status, the preview, undo and redo, revert, the inert hold and the failed-tab flag
([handoff review H8](../handoff-review.md#h8--low-oversized-files-and-functions)).

## Decision

- **What components read lives in a vanilla zustand store.** `createWorkspaceSession` makes it with `createStore`
  (`SessionState`: the binding, the status and save tick, the rail and preview state, the history bridge, what was edited
  and whether a revert can be offered, when the draft opened, the edit generation, the owned fields, and the inert and
  failed-tab flags). The `WorkspaceSession` interface is unchanged: `subscribe`, the getters and the methods behave as
  before, so no component and no test changed. A getter is `() => store.getState().x`; `subscribe` hands the store's
  `subscribe` a listener that takes no arguments.
- **What only the rules use stays in the closure, not in state**: the autosave `sink` and `flusher`, the changes `held`
  for a host that has not connected, the flushes `waiting` on them, the restore targets with their callbacks, the
  editor handle, the hold counters, and the focus-target registry (not subscribable, decision 0027). Putting them in
  state would notify subscribers of changes nothing renders.
- **The server and hydration render show `INITIAL_SESSION_STATE`**, the object the store starts from. Each hook's server
  snapshot reads it, so the defaults are written once.
- **The live draft is a zustand store the same way**, behind its unchanged `LiveDraft` interface.
- **The rules are code, not library behaviour.** Each rule moves the state with one `setState`, so subscribers hear once
  per change. zustand notifies on every `setState`, even one that changes nothing, so every existing no-change guard stays
  by hand: `bind` of the draft already bound, `setHistory` with equal controls, `setPreview` with equal values
  (`samePreviewValue`), `publishStatus` with the same status, `setRailOpen`, `selectRailView`, `showComments`, and the
  hold counters, which notify only on their 0-to-1 and 1-to-0 transitions. `apply` still runs the restore callbacks and
  `send` before the state moves, and the rules read the state again after it. Nothing writes the store during render:
  `BindDraft` binds in an effect and `openedAt` is set there.
- **A selector returns a primitive or a stable reference.** zustand 5 loops on a selector that returns a new object each
  call. The getters return what the state holds, the same object until it changes.

## Alternatives considered

- **Keep both hand-rolled stores.** Two idioms for the same job, and the next person to add a field copies whichever file
  they open first.
- **Put the rules in the store as actions (`create((set, get) => ({ …actions }))`).** It would move the rules into the
  state's shape and mix them with the parts that are not state. This change swaps the plumbing under the same interface; it
  is not a rewrite.
- **Expose the store on the session and read it with `useStore(store, selector)`.** It would add to the interface, and give
  any component a way to write state around the rules unless the store were read-only. The hooks keep
  `useSyncExternalStore` over the getters. A read-only `store` on the session is the next step if a component needs a slice
  that has no hook.
- **Split the file by concern in the same change.** Decision 0043 covers splitting; this one only changes where the state lives.

## Consequences

- One idiom for app state: zustand stores in the editor, the session and the live draft.
- `session-store.ts` stays long because most of it is rules (revert, restore, replace, holds, autosave hand-over), not
  storage.
- The notification guards are kept by hand. A new rule that writes the state writes once, and checks first when its
  change can be a no-op; the session tests count listener calls and catch a miss.
- zustand calls its listeners from a live `Set`: a listener removed during an emit, before its turn, is not called in
  that emit (the hand-rolled `emit` called a copy of the list). The same function subscribed twice is now two
  subscriptions, not one. Nothing in the app relies on either.
- The autosave scheduler (`autosave-scheduler.ts`, which owns `beforeunload`) is not state and did not change.
