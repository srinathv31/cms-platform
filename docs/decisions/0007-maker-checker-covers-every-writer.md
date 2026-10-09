# 0007. Maker-checker covers everyone who wrote a version

Status: Accepted
Date: 2026-10-08

## Context

Maker-checker compared the person deciding a version with its `submittedBy` and nothing else. Holding Author and
Approver on one team is normal (approving an access request can add the role), so an author could write a draft,
have a teammate press Submit, and approve their own content. Finding
[S3](../handoff-review.md#s3--high-maker-checker-only-stops-the-submitter-not-the-author) of the October 2026
review.

## Decision

The owner's rule: anyone who wrote a version can't approve it or request changes on it. Writing means either of
these, in this review round or an earlier request-changes round of the same submission:

- starting the draft: New template, Import, or Edit on an Active template;
- saving any edit to it.

The submitter stays barred, as before. Holding Author and Approver on one team stays allowed.

How the code holds it:

- **The writers live on the version**, in `versions.writers`, a JSON array of user ids
  ([ucomp.ts](../../src/server/db/schema/ucomp.ts)). A new draft starts with whoever started it
  (`createDraft`, `editActive`). Each autosave adds its saver inside the save's transaction
  ([apply-patch.ts](../../src/server/drafts/apply-patch.ts)), and `submit` adds the submitter. Request changes copies
  the in-review version's writers into the new draft, or merges them into a draft that is already open. The
  approver who asked for changes isn't a writer unless they later edit it. A draft started from the Active version
  starts a fresh set, so having written an earlier released version bars nobody.
- **One rule in the domain**: `makerCheckerRefusal` in [permissions.ts](../../src/domain/permissions.ts). The
  `version.decide` guard in `can()` and the `approve` and `requestChanges` transitions in
  [lifecycle.ts](../../src/domain/lifecycle.ts) all ask it. The submitter reads "You submitted this version.";
  another writer reads "You wrote part of this version." The review screen shows the reason on one line in the
  stepper, so it stays as short as the submitter's.
- **Every place that decides passes the writers in**: the review actions, and the review queue and screen through
  `decideCheck`. Approve and Request changes show disabled with the reason, and the version stays out of the
  writer's "Waiting on me".
- **Nobody is asked to review what they wrote**: `stageRecipients` leaves a team role's writers out of the "review
  requested" notifications, at submit, when an earlier stage approves, and when a Platform Admin changes the rule of
  a stage versions wait on. A stage that names one person still tells them.
- **Rows from before the column** are backfilled by the migration
  ([0004_version_writers.sql](../../src/server/db/migrations/0004_version_writers.sql)). Each version gets its
  creator, its submitter, and its `draft.edited` actors, plus those of every change-requested version its draft was
  copied from. A test in [review.test.ts](../../src/server/actions/review.test.ts) checks that the backfill
  rebuilds the writers the app records.

## Alternatives considered

- **Read the writers from the audit log** (`draft.edited` rows) when deciding. Rejected: the audit log may move to
  another service ([B5](../handoff-review.md#b5--medium-autosave-conflict-recovery-reads-the-audit-log)), and a
  permission shouldn't depend on it.
- **A join table** (`version_writers`). It would work as well. The column won because the version row already
  reaches every place that decides, the set is a handful of ids, and every change to it happens in a transaction
  that already reads and writes that row. A Spring Boot port can map it to a list, or move it to a join table,
  without changing the rule.
- **Forbid Author and Approver on one team.** Rejected by the owner: approving an access request can add the role,
  and that's normal.
- **Bar the writers of earlier released versions too.** Rejected: each draft from the Active version is new work
  for review.

## Consequences

- Any new way to create or edit a draft must record its writers: set `DraftFields.writers`, or add the actor with
  `withWriter` in the same transaction as the edit.
- A co-author without the Approver role sees Approve and Request changes disabled with the reason, as the submitter
  does.
- A stage that names one person who wrote the version, or a team where every approver wrote it, leaves the version
  undecidable. A Platform Admin changing the stage's rule, or a Team Admin adding an approver, unblocks it.
