# 0021. The sidebar has no keyboard shortcut, an edit to a generated file

Status: Accepted
Date: 2026-10-09

## Context

shadcn's `SidebarProvider` ([ui/sidebar.tsx](../../src/components/ui/sidebar.tsx)) registered a window-level
⌘B / Ctrl+B listener that toggled the sidebar, called `preventDefault()`, and ignored whether anything had already
handled the key. ⌘B is Bold in the editor, so every Bold also flipped the sidebar's state and wrote the
`sidebar_state` cookie ([handoff review I14](../handoff-review.md#i14--low-every-b-in-the-editor-also-toggles-the-hidden-sidebar)).
Stencil's sidebar is `collapsible="none"` ([app-frame.tsx](../../src/components/app-shell/app-frame.tsx)), so
nothing visible happened; the shortcut only did harm.

The repo's rule is that `src/components/ui/` is generated and isn't edited.

## Decision

Remove the listener from `ui/sidebar.tsx`. It's the one deliberate edit to a generated file:

- A comment at the spot says why.
- The [components README](../../src/components/README.md#ui-shadcn-on-base-ui) lists it.
- [ui/sidebar.test.tsx](../../src/components/ui/sidebar.test.tsx) presses ⌘B and Ctrl+B on the window and in an
  editor, and fails if the sidebar's state or cookie changes. A `shadcn add sidebar` that brings the listener back
  fails it.

## Alternatives considered

- **Stop propagation of ⌘B in the editor.** The listener is on `window` and runs for keys pressed anywhere, so every
  other place that uses ⌘B would need the same guard, and a stopped event also hides the key from anything else
  listening.
- **Make the listener skip events that are `defaultPrevented`.** Still an edit to the generated file, and it keeps a
  shortcut for a sidebar that can't collapse.
- **Wrap `SidebarProvider` in a component of our own.** The listener lives inside the provider; a wrapper can't
  remove it.

## Consequences

- ⌘B and Ctrl+B do nothing outside the editor. If the sidebar ever becomes collapsible, give it a shortcut that no
  editor command uses, through `useSidebar().toggleSidebar`.
- Updating the sidebar from shadcn means removing the listener again; the test says so.
