# Decisions

Short records of choices that are expensive to reverse or that a newcomer would question: a library, a layer
boundary, a data shape, a rule about how code is written. One file per decision, numbered in order. Each says what was
decided and why, so it can be revisited without the person who made it.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-keep-docs-in-the-repo.md) | Keep the docs in the repo as Markdown | Accepted |
| [0002](0002-a-passed-sunset-is-final.md) | A passed sunset is final | Accepted |
| [0003](0003-undo-redo-always-shown.md) | Undo and redo are always shown, greyed out when idle, before the save status | Accepted |
| [0004](0004-email-fields-hidden-not-unmounted.md) | Email fields are hidden while Email is off, not unmounted | Accepted |
| [0005](0005-revert-undo-goes-when-anything-changes.md) | A revert's Undo goes as soon as anything else changes | Accepted |
| [0006](0006-page-notices-by-commit-order.md) | Page notices and search with an opaque cursor, notices in commit order | Accepted |
| [0007](0007-maker-checker-covers-every-writer.md) | Maker-checker covers everyone who wrote a version | Accepted |
| [0008](0008-a-chain-must-be-approvable.md) | A saved approval chain must be one somebody can approve | Accepted |
| [0009](0009-correct-a-revoked-version-from-its-content.md) | Correct a revoked version from its content | Accepted |
| [0010](0010-comments-are-answered-where-they-show.md) | Comments are answered where they show | Accepted |
| [0011](0011-cap-each-render-value.md) | Each render value is at most 1,000 characters | Accepted |
| [0012](0012-submit-freezes-only-what-it-showed.md) | Submit freezes only what it showed: a compare-and-set on `rev`, the workspace inert meanwhile | Accepted |
| [0013](0013-errors-are-caught-per-route-not-per-stream.md) | Errors are caught per route, not per streamed section | Accepted |
| [0014](0014-chart-values-never-hover-only.md) | Chart values are never hover-only, and series differ by hue | Accepted |
| [0015](0015-a-version-keeps-the-stages-it-was-submitted-with.md) | A version goes through the approval stages it was submitted with | Accepted |
| [0016](0016-the-name-is-versioned.md) | The template's name is a version field | Accepted |
| [0017](0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md) | A sunset date ends at 00:00 in the business time zone (Eastern by default, a Platform setting) | Accepted |
| [0018](0018-settings-screens-render-decisions.md) | Settings screens render decisions; the domain makes them | Accepted |
| [0019](0019-on-demand-reads-are-get-routes.md) | Reads a screen loads on demand are GET routes; only mutations are server actions | Accepted |
| [0020](0020-autosave-never-drops-edits-silently.md) | Autosave never drops an edit without saying so: the header binds it, a stopped save holds the page, leaving unsaved asks | Accepted |
| [0021](0021-the-sidebar-has-no-keyboard-shortcut.md) | The sidebar has no keyboard shortcut, an edit to a generated file | Accepted |
| [0022](0022-a-variable-keeps-its-identity-across-renames.md) | A variable keeps its identity across renames, so a renamed key is one contract change | Accepted |
| [0023](0023-the-email-preview-sends-from-stencil.md) | The email preview's fallback sender is Stencil's, and the other UCOMP names wait | Accepted |
| [0024](0024-the-palette-searches-on-the-server.md) | The ⌘K palette searches on the server, and keeps answers per viewer | Accepted |
| [0025](0025-refusals-carry-stable-codes.md) | Every refusal carries a stable code, and code branches on the code | Accepted |
| [0026](0026-a-passed-sunset-is-recorded-by-a-sweep.md) | A passed sunset is recorded by a sweep, in the audit log only: no notice, no notification | Accepted |
| [0027](0027-focus-targets-register-with-the-session.md) | Focus targets register with the workspace session; nothing finds them by label | Accepted |
| [0028](0028-today-and-yesterday-are-utc-calendar-days.md) | "Today" and "yesterday" are UTC calendar days, counted one way (a sunset's in the business time zone) | Accepted |

Calls made while the prototype was built (Phases 5–7) are in [prototype-log.md](prototype-log.md). It's history:
some entries have been superseded by later code, and it's not updated anymore.

## Writing one

1. Copy the template below into `NNNN-short-title.md` with the next number.
2. Keep it under a page. Context is what forced the choice; Decision is what we'll do; Consequences are what gets
   easier, what gets harder, and what follows from it.
3. Add a row to the table above in the same PR as the code it describes.
4. Don't rewrite an accepted decision. Write a new one, set the old one's status to "Superseded by NNNN", and link
   both ways.

```md
# NNNN. <Decision, in a few words>

Status: Proposed | Accepted | Superseded by [NNNN](NNNN-title.md)
Date: YYYY-MM-DD

## Context

## Decision

## Alternatives considered

## Consequences
```
