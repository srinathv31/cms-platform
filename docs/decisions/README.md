# Decisions

Short records of choices that are expensive to reverse or that a newcomer would question: a library, a layer
boundary, a data shape, a rule about how code is written. One file per decision, numbered in order. Each says what was
decided and why, so it can be revisited without the person who made it.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-keep-docs-in-the-repo.md) | Keep the docs in the repo as Markdown | Accepted |

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
