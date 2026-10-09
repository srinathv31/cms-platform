# 0016. The template's name is a version field

Status: Accepted
Date: 2026-10-09

## Context

The name lived on the template (`templates.name`), and autosave wrote it as an author typed in a draft. The
Active version's web `<title>`, its PDF title, the `/api/v1` `name`, the JSON Schema title and the consumer
notices all read it live, so a rename reached customers the moment it was typed, without review
([I5](../handoff-review.md#i5--high-a-draft-rename-goes-live-without-review)). Browsers and PDF viewers show
both titles, so the name is customer output like the body.

## Decision

The owner chose to version the name.

- **Each version keeps the name it was approved with.** `versions.name` (NOT NULL) holds it; a new draft copies
  it (Edit, a change request), the author renames only the draft, and submit freezes it. "Revert to vN" brings
  vN's name back with its content. Existing versions took their template's name in the migration.
- **`templates.name` is gone.** Kept as a cache of some version's name it would need a writer at every step that
  can change which version that is, and could drift. Nothing reads a template-level name.
- **Customer output uses the name of the version it renders or returns**: the web `<title>`, the PDF `/Title`,
  the JSON Schema `title`, and a notice's `templateName` (the notice's own version: a new version's notice names
  it as approved, a sunset or revoke names the old version as its consumers know it). Where `/api/v1` speaks of
  the template (search matching, ordering, the search cursor, search and detail `name`, the integration panel),
  it uses the Active version's name. With none Active (it was revoked), detail uses the name of the version
  that still renders (`contractBaseline`, [decision 0009](0009-correct-a-revoked-version-from-its-content.md)),
  and with nothing rendering, the newest released version's.
- **A rename goes through review like any change.** The submit dialog and the review screen's rail show it,
  old name struck through and new name inserted, against what customers get today: the Active version's name,
  or with none Active the name of the version that still renders, as the contract changes compare. Compare
  shows a rename between any two versions. It reaches customers only when that version goes live.
- **CMS screens follow one rule**: the open draft's name, otherwise the newest version's (`pickLatest`, or
  `currentName()` in SQL); a template with no version shows its id. That covers the workspace header on every
  tab (its name field edits the draft's name), the Library, the palette and Usage. Screens about one version use
  that version's name: the review screen and review queue (an approver reviews the name that was submitted),
  notifications (titled at the time, with the version's name), and the audit log and its export (an event
  about a version keeps that version's name; the template's creation and the Template filter use today's).
  The SHARE sheet shows what consumers get, so the Active version's name.

## Alternatives considered

- **A separate customer-facing title** (the review's suggestion: the first heading or a dedicated field). It
  leaves the CMS name unreviewed but still shown on customer output unless every channel changed, and adds a
  second name to explain. Versioning the one name keeps one source and reviews it.
- **Keep `templates.name` as "the Active version's name", written at go-live.** One writer, but a revoke, a
  draft of a never-published template and every CMS list still need a version's name, so it would be a second
  copy nothing needs.

## Consequences

- A consumer pinned to v2 keeps v2's title after v3 renames the template; search and detail follow the Active
  version, so a search cursor taken before a rename goes live can land the template elsewhere in the order (it
  is still a valid keyset cursor).
- Every reader of a name has to choose which version's: the server README lists them. A Java port reads
  `versions.name` the same way.
- Notifications keep the name they were written with; renaming later doesn't rewrite them.
- The CMS shows a draft's new name everywhere before review, by design: authors see their work in progress.
