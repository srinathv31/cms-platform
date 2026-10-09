# Stencil docs

New to the codebase? Read [architecture.md](architecture.md), then the README of the layer you're about to change.
Agents load [AGENTS.md](../AGENTS.md) automatically; it holds the rules every change follows. Setup and commands are in
the root [README.md](../README.md).

## Map

| Where | What it's for |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | The rules every change follows: commands, Next.js 16 rules, boundaries, UI rules, files to copy. |
| [architecture.md](architecture.md) | The layers, what may import what, how a page, a mutation, an autosave and a consumer render flow through the code, and the data model. |
| [render-spec.md](render-spec.md) | The render engine's specification: the stored document, normalization at save, values, links, lists, the `RenderDoc`, each channel, errors, and the golden-file contract. Normative: a second engine is built from it. Its golden files are in [src/server/render/golden](../src/server/render/golden/README.md). |
| [handoff-review.md](handoff-review.md) | The October 2026 codebase review as a working backlog: every finding's severity, status, location and fix, and what the fixes turned up. Its "Fix first" list is done; agents pick work from "Found while fixing" and "Alongside: tooling and hygiene", and the PR that fixes a finding updates its status. |
| Layer READMEs | One per folder under `src/`, next to the code: [app](../src/app/README.md), [components](../src/components/README.md), [contracts](../src/contracts/README.md), [domain](../src/domain/README.md), [editor](../src/editor/README.md), [server](../src/server/README.md), [simulator](../src/simulator/README.md). |
| [guides/](guides/) | Step-by-step how-tos. Today: the [demo script](guides/demo-script.md). |
| [reference/](reference/) | Lookup material. Today: the [UI checklist](reference/ui-checklist.md). |
| [decisions/](decisions/README.md) | Decision records: what was chosen, why, and what was rejected. |
| [archive/](archive/README.md) | How the prototype was planned and built. History only; doesn't describe the current code. |

## Where a new doc goes

- **It's about one layer** (how `src/server` actions are shaped, the domain glossary): that layer's README.
- **It crosses layers** (how a request flows, what may import what): [architecture.md](architecture.md).
- **It's a task someone will repeat** (add a server action, add a migration, run e2e without touching the demo
  database): a page in `guides/`, named for the task.
- **It's something people look up** (the `/api/v1` contract, error codes, UI rules): a page in `reference/`.
  [render-spec.md](render-spec.md) stays at the top of `docs/` because so much code cites it there.
- **It's a choice someone might question later**: a record in [decisions/](decisions/README.md).
- **It's a plan, a brief or a status report**: not here. Put it in the PR or issue; it goes stale as soon as the
  work lands. The one exception is [handoff-review.md](handoff-review.md): a backlog that stays true because
  each PR that fixes a finding updates it.

## Keeping them true

- Change the doc in the same PR as the code. If a PR changes how a layer works, its README changes too.
- Describe what the code does now. Don't explain through history ("Phase 5 added…"); a decision record holds the why.
- Link files with relative links, and name paths exactly. `npm run docs:check` fails on links and headings that don't
  resolve, backticked paths (`src/…`, `@/…`, `docs/…`, `e2e/…`, `scripts/…`) that don't exist, `docs/` paths in code
  comments that don't exist, and a folder under `src/` without a README.
- Write plainly: short sentences, present tense, Oxford comma, no filler. [src/editor/README.md](../src/editor/README.md)
  is a good model for depth.
- Don't copy what a file's header comment already says. Summarize, and link the file.
