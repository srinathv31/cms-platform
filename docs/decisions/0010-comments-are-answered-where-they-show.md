# 0010. Comments are answered where they show

Status: Accepted
Date: 2026-10-09

## Context

Only a draft and a version in review take comments, but that rule lived in a client helper. The comment actions
checked the `review.comment` permission and nothing else, so a direct call could comment on an Active or
Superseded version. Finding
[S7](../handoff-review.md#s7--medium-comments-are-accepted-on-any-version-state) of the October 2026 review.

A user the waiting stage names (a Legal reviewer, say) comments from any team. The reply, resolve and reopen
actions counted them as named for every thread on the template while any version was in review, including threads
begun in an open draft, which they can't see. Finding
[S9](../handoff-review.md#s9--low-cross-team-stage-reviewers-can-act-on-any-thread-of-the-template).

Threads belong to the template, not to one version. They anchor to block ids (a message, which has no body,
anchors them to its channel fields' ids, such as `push.title`: `commentAnchors`), so one thread shows on several
versions. "The version a thread is on" therefore isn't one row.

## Decision

The rules live in [domain/comments.ts](../../src/domain/comments.ts):

- **A new thread** goes on a version that takes comments: a draft or a version in review (`canComment`).
- **A thread is answered where it shows on such a version** (`canActOnThread`). The open draft's margin shows every
  thread of the template. The version in review shows the threads that began by it (`threadBeganBy`), so an earlier
  version's thread, such as v1's change request on v2's screen, shows there too. With neither, the template's
  threads are a record, and replies, resolves and reopens are refused with "Only a draft or a version in review
  takes comments."
- **A user the waiting stage names** counts only for the version in review and the threads its screen shows. A
  thread begun in the draft is refused to them with the same generic refusal as a thread that doesn't exist.
- **The server works out where a thread shows** from the template's versions. The reply, resolve and reopen actions
  take only the thread id, as before.
- **The read models decide `can.comment`**: the review screen with the stage's named users, the workspace without
  them (the workspace belongs to the team). Every thread a screen lists is one the viewer may act on once
  `can.comment` is ok, so there is no per-thread flag.

## Alternatives considered

- **Only threads that began on the version in review.** Rejected: on v2's screen a named reviewer couldn't resolve
  the change request they raised on v1, though the screen shows it and offers Resolve today.
- **The client sends the version it is showing.** It would work, but the server would have to check that the
  version shows the thread anyway, and the answer can be worked out from the template alone.

## Consequences

- A new place that shows threads must show only threads that `canActOnThread` allows wherever it offers Reply or
  Resolve, or decide a per-thread permission.
- A decided version's screen offers no comment controls, as before. A direct call is refused and writes nothing.
