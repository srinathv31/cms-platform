# `src/domain/lifecycle`: the moves a template's versions make

Every transition a version goes through, from the first draft to a revoke, as pure rules: facts and `now` in,
`{ ok: true, changes, effects }` or a refusal out. `changes` are the field values to write; `effects` are the side
records (audit events, notifications, consumer notices) that
[server/services/local/effects.ts](../../server/services/local/effects.ts) writes in the same transaction. A
notification carries its kind's facts (names as they were) and a link, never a sentence: the bell words it when it
reads it ([notifications.ts](../notifications.ts), decision 0055). Nothing here touches the database, the framework or the clock. The backend's commands (such as
[server/services/local/review.ts](../../server/services/local/review.ts)) call these inside one transaction; read models call the
predicates (`sunsetPassed`, `contractBaseline`, `reviewBaseline`) so a screen never decides one itself.

One file per family of transitions, split by concern ([decision 0043](../../../docs/decisions/0043-split-files-by-concern-not-by-line-count.md)).
There is no barrel: import each export from the file that defines it. They follow the [domain
rules](../README.md#rules).

## Files

In reading order: the shapes and the refusal table first, then each family of transitions in the order a version goes
through them.

| File                                     | Holds                                                                                                                                                                                                                                                                                                                                                                     | Exports                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [types.ts](types.ts)                     | The shapes the transitions share: what a draft and a version carry, a transition's result, and the version as the review transitions read it.                                                                                                                                                                                                                             | `LifecycleResult`, `StarterContent`, `DraftContent`, `VersionSnapshot`, `DraftFields`, `LifecycleError`, `Ok`, `Outcome`, `ReviewVersion`, `ApprovalRecord`, `ReasonComment`                                                       |
| [refusals.ts](refusals.ts)               | `REFUSALS`, the whole refusal table of a submit or a review transition: every code with its sentence, in one place.                                                                                                                                                                                                                                                       | `REFUSALS`                                                                                                                                                                                                                         |
| [helpers.ts](helpers.ts)                 | The small helpers the transitions share: a version's number and round (a missing one throws, it is a bug), how a sentence names a round, the effect builders, and the longest note and reason a command takes.                                                                                                                                                            | `numberOf`, `roundOf`, `sentence`, `trimmed`, `unique`, `notify`, `teamApproversExcept`, `noteRefusal`, `reasonRefusal`                                                                                                            |
| [drafts.ts](drafts.ts)                   | How a draft comes to exist and who wrote it: a new template from a starter or an import and its channels, Edit on the latest version, and the writers that maker-checker reads.                                                                                                                                                                                           | `createDraft`, `createTemplateFrom`, `newTemplateRefusal`, `newTemplateContentType`, `newTemplateChannels`, `DEFAULT_CHANNELS`, `draftChannelsRefusal`, `planDraftStart`, `editLatest`, `copyToDraft`, `withWriter`, `withWriters` |
| [autosave.ts](autosave.ts)               | Whether an autosave lands on a draft (its state, its rev, a lost response its own session can carry on from, but not a send older than its last, the channels), what it writes there (the channel fields laid over the stored ones, the saver among the writers), and the editing session's `draft.edited` audit row. Both implementations of `DraftService.save` ask it. | `draftSaveRefusal`, `draftChanged`, `sessionOwnsRev`, `draftSaveChanges`, `recordedRev`, `mergeDraftEdit`, `changedFields`, `DRAFT_FIELDS`, `DRAFT_EDITED`                                                                         |
| [baselines.ts](baselines.ts)             | The version a draft or a round is compared with: what consumers can still render, and what the review screen redlines against; the four a round's review screen sets beside it.                                                                                                                                                                                           | `contractBaseline`, `reviewBaseline`, `renameBaseline`, `reviewScreenBaselines`                                                                                                                                                    |
| [submit.ts](submit.ts)                   | Draft to In review: numbered, with its contract changes, its stages and the rules a message's channels add; the draft it freezes and what its summary shows; the change requests a submit answers.                                                                                                                                                                        | `submit`, `smsFooterOf`, `draftToSubmit`, `submitFacts`, `answerChangeRequests`                                                                                                                                                    |
| [request-changes.ts](request-changes.ts) | In review to Changes requested, and the new draft that carries the block ids.                                                                                                                                                                                                                                                                                             | `requestChanges`                                                                                                                                                                                                                   |
| [approve.ts](approve.ts)                 | In review to the next stage, or Active at the last one, with the previous Active Superseded (`replacedActive`).                                                                                                                                                                                                                                                           | `approve`, `replacedActive`                                                                                                                                                                                                        |
| [decide-check.ts](decide-check.ts)       | Whether a viewer may approve or send back a version at its current stage (`decideCheck`): the queue, the review screen and the actions ask it; it refuses an earlier stage's approver by `approvedEarlierStage`, as the approve transition does. The two decide commands ask `can` about `decideResource`, then `stageRefusal` on the round read again.                   | `decideCheck`, `decideResource`, `stageRefusal`                                                                                                                                                                                    |
| [sunset.ts](sunset.ts)                   | The date a Superseded version stops rendering, the one test of "passed", and the sweep that records it.                                                                                                                                                                                                                                                                   | `setSunset`, `sunsetUnchanged`, `sunsetPassed`, `isAfterToday`, `sweepSunsets`                                                                                                                                                     |
| [revoke.ts](revoke.ts)                   | Two people withdraw a released version.                                                                                                                                                                                                                                                                                                                                   | `startRevoke`, `confirmRevoke`, `cancelRevoke`, `revokePending`                                                                                                                                                                    |
| [version-actions.ts](version-actions.ts) | What a viewer may do on a version now (the Versions tab's sunset and revoke controls), and in a template's workspace (edit, Edit, Submit): decided behind the service interfaces, refused with the transitions' codes.                                                                                                                                                    | `versionActions`, `VersionActions`, `workspaceActions`, `WorkspaceActions`                                                                                                                                                         |

Tests sit beside each file. [fixtures.ts](fixtures.ts) holds the inputs more than one test file builds;
[transitions.test.ts](transitions.test.ts) holds the tests that cross files: every review move from every state, the
review loop, maker-checker, and the two-person revoke.

## The transitions

```text
createDraft    — → Draft (a new template from a starter)
createTemplateFrom  — → Draft (a new template from the draft the BFF built and prepared, `DraftContent`: a starter, or an import);
               what both backends call, and `createDraft` is built on
editLatest     the latest version, Active or Revoked → a new Draft copied from it ("Based on v3")
submit         Draft → In review, numbered: round 1 of the next version after a release, or the next round of the
               number sent back (`nextRound` in rounds.ts), with its contract changes against `contractBaseline`
requestChanges In review → Changes requested, plus a new Draft carrying the block ids (and so the threads); its
               submit is the next round of the same number
approve        In review → the next stage, or Active at the last one (the previous Active → Superseded)
setSunset      Superseded → Superseded with a sunset date (or a moved one), until that date passes
sweepSunsets   the clock passed a sunset → its `version.sunset_passed` audit row and its `sunset_passed` consumer
               notice, once. Not a state change: `sunsetPassed` alone decides whether a version renders
startRevoke    Active or Superseded → revoke pending (one approver)
confirmRevoke  revoke pending → Revoked (a different approver)
cancelRevoke   revoke pending → no revoke
```

The lifecycle as a diagram, with the states, is in [the domain README](../README.md#vocabulary).

## Rules

- **A transition refuses, it doesn't throw.** A second tab or a slower colleague gets there first, and the person
  reads why: `{ ok: false, code, reason }` from `REFUSALS` (or `REASONS` for maker-checker). Only a bug throws
  (`LifecycleError`, from `numberOf` and `roundOf`). [decision 0025](../../../docs/decisions/0025-refusals-carry-stable-codes.md)
- **A number counts releases.** `submit` numbers a draft with `nextRound`; a send-back is another round of the same
  number. A notification names a round as people read it (`versionLabel`): "v2" until the number has been sent back,
  then "v2, round 2". Sunset and revoke are about released versions: "v2".
  [decision 0033](../../../docs/decisions/0033-a-resubmission-is-the-next-round-of-the-same-version.md)
- **Maker-checker covers every writer.** `approve` and `requestChanges` refuse anyone in the version's `writers`.
  [decision 0007](../../../docs/decisions/0007-maker-checker-covers-every-writer.md)
- **A version goes through the stages it recorded at submit,** whatever the chain becomes.
  [decision 0015](../../../docs/decisions/0015-a-version-keeps-the-stages-it-was-submitted-with.md)
- **The name is a version field.** A new draft copies it, the author renames the draft, and it freezes at submit; a
  transition's `templateName` is the name of the version it is about.
  [decision 0016](../../../docs/decisions/0016-the-name-is-versioned.md)
- **Submit freezes only what it showed.** `seenRev` is the draft's `rev` when the summary was read.
  [decision 0012](../../../docs/decisions/0012-submit-freezes-only-what-it-showed.md)
- **A message is held to its channels' rules at submit** (`messageRefusal` in submit.ts): GSM-7 as typed, the part
  budget and push size with the long sample values, no public shorteners.
  [decision 0034](../../../docs/decisions/0034-message-channels-families-and-the-fields-registry.md),
  [0035](../../../docs/decisions/0035-sms-characters-and-length.md)
- **Approve waits for every output to be viewed** (`outputsRefusal`).
  [decision 0037](../../../docs/decisions/0037-an-approver-views-every-output-before-approving.md)
- **A passed sunset is final.** `sunsetPassed` is the one test of it; a sunset day ends at 00:00 in the business time
  zone; the sweep records a passed sunset once.
  [0002](../../../docs/decisions/0002-a-passed-sunset-is-final.md),
  [0017](../../../docs/decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md),
  [0026](../../../docs/decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md),
  [0032](../../../docs/decisions/0032-consumers-are-told-when-a-sunset-passes.md)
- **After a revoke, Edit starts from the revoked version,** compared with the newest version that still renders.
  [0009](../../../docs/decisions/0009-correct-a-revoked-version-from-its-content.md),
  [0031](../../../docs/decisions/0031-a-correction-is-redlined-against-the-revoked-version.md)

## Copy these

| To…              | Copy                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Add a transition | `startRevoke` in [revoke.ts](revoke.ts) or `setSunset` in [sunset.ts](sunset.ts), with the test beside it.                             |
| Add a refusal    | An entry in `REFUSALS` ([refusals.ts](refusals.ts)) with a code no other refusal has ([refusals.test.ts](../refusals.test.ts) checks). |
