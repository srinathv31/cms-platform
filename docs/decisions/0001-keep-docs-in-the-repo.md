# 0001. Keep the docs in the repo as Markdown

Status: Accepted
Date: 2026-10-08

## Context

The prototype is being handed to a dev team to build for production, and AI agents will keep doing much of the work.
Agents load `AGENTS.md` and copy whatever they find first, so a doc that has drifted from the code does active harm.

By October 2026 the project's real rules lived in a brief nothing loaded automatically, several planning docs
described code that no longer existed, and only one of seven `src/` layers had a README. The docs had no owner and
nothing checked them.

## Decision

- Docs are plain Markdown in this repo, changed in the same PR as the code they describe.
- [`AGENTS.md`](../../AGENTS.md) is the entry point every agent loads: commands, stack rules, boundaries, and the
  files to copy. It stays short and links out.
- Each folder directly under `src/` has a README next to its code. Cross-cutting material lives in `docs/`:
  `architecture.md`, `guides/`, `reference/`, `decisions/`.
- Documents that record how the prototype was built move to `docs/archive/` with a banner. They're kept for history
  and never updated.
- `npm run docs:check` ([`scripts/docs-check.ts`](../../scripts/docs-check.ts)) fails on broken links and headings,
  backticked repo paths that don't exist, `docs/` references in code comments that don't resolve, and a `src/` folder
  without a README.

## Alternatives considered

- **A docs site** (Fumadocs, Starlight, VitePress). Adds a build and a second place to look, and agents read the
  source files anyway. It can be added later on top of these same files.
- **Generated API reference** (TypeDoc). Worth it if the editor module is lifted into another app. Until then the
  editor README's API table is enough.
- **A wiki or Notion.** Agents can't see it, and it isn't reviewed with the code, so it drifts fastest.

## Consequences

- A PR that changes how a layer works updates that layer's README. Reviewers check it.
- `docs:check` catches moved and deleted files, not wrong descriptions. Prose still needs review.
- Once CI exists, `docs:check` runs there with lint and typecheck.
