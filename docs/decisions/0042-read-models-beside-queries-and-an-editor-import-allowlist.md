# 0042. Read models sit beside their queries, and the editor's public API is a lint allowlist

Status: Accepted
Date: 2026-10-11

## Context

Two boundaries were written down and not enforced
([handoff review B6 and G5](../handoff-review.md#b6--medium-server-code-imports-from-components)).

`src/domain/review-types.ts` held the review area's rule types (effects, the approval chain, the redline) and eleven
screen view models (`ReviewScreenData`, `VersionsData`, `ThreadView`, …) side by side. The domain is the part meant to
port to the Spring Boot API; what one of this app's screens renders is not a business rule, and a backend that
replaces the queries would have to carry types it never builds.

With the `@/editor` barrel gone, nothing held code outside `src/editor` to the public API in the editor's README.
Application code imported internal modules (`lib/platform`, `model/usage`, `state/*`, …), `schema.ts` still exported
names the README calls removed, and the "frozen" API had three members nothing used.

## Decision

- **A type a domain function takes or returns stays in `src/domain`**: `Person`, `StepView`, `ConsumerUsage`, the
  effects, the redline, `ActionResult`. **A type that only describes what a screen renders is declared beside the query
  that builds it**, in `src/server/queries/`: `ActivityItem` in `activity.ts`, `ThreadView` and `CommentView` in
  `threads.ts`, the Versions tab's models in `versions.ts`, and the review queue's and screen's (with the sunset picker's
  `SunsetCalendar`, which the Versions tab shares) in `review-models.ts`, split from `review.ts` to keep that file
  readable. Components import them with `import type`, as they already did for `spaces.ts` and `base-version.ts`.
- **Code outside `src/editor` imports only the modules the editor README's Public API table lists.** The lint rule
  (`EDITOR_PUBLIC_MODULES` in `eslint.config.mjs`) is that table, and it applies to every file outside the editor.
  From `@/editor/schema` it allows `baseExtensions`, `BaseExtensionOptions` and `ensureBlockIds`; the file's other
  exports (`editorExtensions`, `inlineFieldExtensions`, `BLOCK_ID_TYPES`, …) are for the editor's own modules.
- **Where outside code already needed an internal module, the module was made public, not wrapped**: the pure model
  files the render pipeline and the lifecycle share (`model/links`, `model/list-markers`, `model/usage`), the list
  markers on static HTML (`extensions/list-markers`, for the redline), `lib/platform` (so a host's undo and redo
  labels read ⌘ or Ctrl as the editor's keys do), `state/variable-store` and `testing/editor` (tests that work a
  variable list or mount a live editor), and `styles.css`. A copilot test that built an editor from the runtime's
  internals now uses `mountBodyEditor` from `testing/editor`.
- **Unused members of the frozen API are removed, not implemented**: the `renderThread` prop, the `requiredSections`
  prop (and the workspace's pass-through of it), and the root runtime's `dispose()`.

## Alternatives considered

- **A separate read-models folder in the server layer**, as the finding worded it. The queries already own these shapes, components
  already import read-model types from `@/server/queries/*`, and a second folder is one more place to keep in step.
- **Moving `editorExtensions` and its helpers out of `schema.ts`** so the module's exports match the README. It would
  turn `buildBase` and the internal options into exports of the schema file; a name list in the rule does the same
  job with no code moved.
- **Exempting tests from the allowlist.** Flat config keeps one `no-restricted-imports` per file, so an exemption is
  another copy of every block. The three tests that reached into the editor use public modules now.
- **`import/no-restricted-paths`.** It works on resolved files and needs the resolver; every other boundary here is a
  `no-restricted-imports` pattern, so this one is too.

## Consequences

- A new screen's view model goes in its query's file (or a `*-models.ts` beside it when the file would grow past
  reading), and a domain rule never imports it. The lint rule that `src/server` never imports `@/components` stays.
- Making an editor module public is two edits in one change: a row in the README's table and a line in
  `EDITOR_PUBLIC_MODULES`. A reviewer sees the API grow.
- The older read models in `access-types.ts`, `golive-types.ts` and `import-types.ts` are still in the domain.
  Nothing enforces where a view model lives, so they move when someone next works on that screen.
- The rule matches imports through the `@/editor` alias. A relative path into the editor from outside it would pass; the repo
  uses `@/` throughout and none exist.
