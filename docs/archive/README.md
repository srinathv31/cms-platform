# Archive

> **These documents don't describe the current code.** They record how the prototype was planned and built, by a
> lead agent and parallel sub-agents working in phases, in October 2026. Paths, file names and rules in them are often
> out of date. Read them for history and intent; for anything you're about to build, use [the current docs](../README.md).

The product was called UCOMP while these were written; it's Stencil now.

| Document | What it was | Current source instead |
| --- | --- | --- |
| [discovery-brief.md](discovery-brief.md) | Product discovery: the problem, users, the Spring Boot "UCOMP API" the product was meant to sit on, and the target architecture. | Still the best product background. [architecture.md](../architecture.md) for the code as built. |
| [build-plan.md](build-plan.md) | The prototype's scope and experience principles, written for Claude Code. | [AGENTS.md](../../AGENTS.md) for the rules still in force. |
| [implementation-plan.md](implementation-plan.md) | Architecture, folder tree and the phase plan. About 35 tree entries no longer match. | [architecture.md](../architecture.md) |
| [agent-brief.md](agent-brief.md) | Shared rules for every build sub-agent: stack facts, design tokens, seed ids, the TipTap contract, multi-agent working rules. | [AGENTS.md](../../AGENTS.md); the document contract in [render-spec.md](../render-spec.md#2-stored-document-the-accepted-tiptap-json) |
| [design-reference.md](design-reference.md) | Measurements taken from third-party reference screenshots. | `src/styles/tokens.css`, `src/app/globals.css` and [ui-checklist.md](../reference/ui-checklist.md) |
| [phase-4-brief.md](phase-4-brief.md), [phase-5-brief.md](phase-5-brief.md), [phase-6-brief.md](phase-6-brief.md), [phase-7a-brief.md](phase-7a-brief.md) | Task briefs for each build phase: contracts and who implemented what. | The layer READMEs |
| [handoff-phases-5-7.md](handoff-phases-5-7.md) | Handoff between build sessions. | None |
| [final-review.md](final-review.md) | What Phases 5–7 built, written for the owner's review. | [architecture.md](../architecture.md) |
| [tracks/](tracks/README.md) | How the three parallel build tracks ran, with each track's report. | None |

Decisions made during the build are not archived: they're in [decisions/prototype-log.md](../decisions/prototype-log.md).
