# 0015. A version goes through the approval stages it was submitted with

Status: Accepted
Date: 2026-10-09

## Context

Versions in review read their content type's approval chain live. `versions.current_stage` was a position in
today's chain, decisions stored only a position and a name, and a chain save remapped each version's position by
stage id. So editing the chain mid-review moved versions under their feet
([handoff review D3](../handoff-review.md#d3--high-editing-the-approval-chain-mid-review-stalls-or-skips-stages)):
with [Legal (Dana), Team], Dana approved Legal, the chain was reordered to [Team, Legal], Jordan approved Team, and
the version waited on Legal again with Dana refused as having approved an earlier stage, stuck for good. A stage
inserted before the current one showed as done though nobody had approved it, and the stepper put old decisions
under whatever stage held their position now.

## Decision

- **At submit a version records its stages**: the chain's stage ids and names, in order (`versions.stages`,
  `recordStages` in [approval-chain.ts](../../src/domain/approval-chain.ts)). It goes through exactly those. A
  reorder, insert, rename or new stage never changes a version already in review; the next submission picks it up.
- **`current_stage` is a position in the version's own stages**, not a stage id. Once the sequence can't change, a
  position is enough, and the column, "Stage 2 of 3" and the review actions' compare-and-set stay as they were.
- **Who decides a stage is read live**: the rule its `approval_stages` row has now, matched by id (`stageOf`). A
  Platform Admin changing a stage's rule still reaches the versions waiting on it, which is how
  [0007](0007-maker-checker-covers-every-writer.md) unblocks a stalled stage. What a version shows (its stepper,
  "Waiting on Legal reviewer.", its notifications) uses the names it recorded.
- **A stage an in-review version still needs can't be removed**: the one it waits on, or one ahead of it in its own
  stages. `saveApprovalChain` refuses ("1 version in review still needs Legal reviewer.") and the chain editor shows
  Remove disabled with that reason. So the stages a version will reach always have a live rule, and the recorded
  stages don't store rules. A stage every version has passed can go; their steppers keep its recorded name.
- **Decisions record the stage id** (`approvals.stage_id`), and the stepper matches decisions to the version's
  stages by it.
- **Nobody approves two stages of one round**: anyone who approved any stage of the version is refused ("You
  approved an earlier stage.", `approvedThisRound`), whatever stage their approval is recorded against. A version is
  reviewed in one round, so this is the rule as it was before stage ids. It doesn't depend on the stage ids the
  migration matched by position, which may put an old approval on the stage the version waits on now. The next
  stage's "review requested" leaves out everyone who approved a stage of the version.
- **Migration 0005** gives every submitted version today's chain as its stages (drafts stay null and follow the
  chain as it is), clamps `current_stage` to the last of them (a position past the end was read as the last stage),
  and gives each decision the stage at its position in today's chain. Best effort: nothing recorded which chain a
  version went through, so a version decided under an older chain shows today's stages, and a decision made before a
  reorder maps to whatever stage holds its position now. A decision at a position today's chain doesn't have keeps a
  null stage id, and the stepper shows no one for it.

## Alternatives considered

- **Store each stage's rule in the recorded stages**, applied when the stage has left the chain. A frozen rule can't
  be changed to unblock a version, and a stage that's gone from the chain would still be deciding versions.
- **`current_stage` as a stage id.** It works as well; a position was simpler with a sequence that can't change.
- **Keep the live chain and remap on save**, as before. It kept only the current stage in place; the stages before
  and after it still moved.
- **Add new stages to versions already in review** when they come after the current one. A version's approval path
  is fixed at submit like its number and content, so the audit reads one sequence per version.

## Consequences

- A new stage applies from the next submission. To put a version already in review through it, an approver
  requests changes and the author resubmits.
- Removing a stage waits until no version in review still needs it; the chain editor's count says how many do.
- [0008](0008-a-chain-must-be-approvable.md) checks the chain as saved, not each version's own stages. So any rule
  change that makes a stage still ahead of a version name someone who already approved one of its stages leaves it
  waiting on a person who is refused: swapping two stages' rules after Jordan approved the first, or removing a stage
  Dana approved once every version has passed it and naming her on a later one. That person isn't asked to review it.
  Changing that stage's rule again unblocks the version, as in 0007.
- A content type with no stages falls back to Release 1's "Team approver" (`DEFAULT_CHAIN` in
  [approval-chain.ts](../../src/domain/approval-chain.ts)), whose stage id is `default`. A version that recorded it
  keeps that stage's rule after the content type gets a chain of its own, so it stays decidable by the team's
  approvers. Adding an approver to the team unblocks it, the other half of 0007's path. A Platform Admin can't change
  its rule.
