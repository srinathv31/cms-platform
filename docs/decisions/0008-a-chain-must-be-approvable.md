# 0008. A saved approval chain must be one somebody can approve

Status: Accepted
Date: 2026-10-08

## Context

A content type's approval chain is configuration a Platform Admin edits. Until October 2026 the chain editor saved
chains that stall every submission
([handoff review D4](../handoff-review.md#d4--high-the-chain-editor-saves-chains-nobody-can-approve)): one person
named on two stages only added a warning line, although nobody approves two stages of one round; a `team_role` stage
could name Viewer, Author or Team Admin, none of which grants `version.decide`; and the rules against naming
yourself, an Auditor or someone without access ran only in the server action, and only for people newly named, so
a re-save kept a person who had lost access since.

## Decision

- One pure domain function, `validateChain` in [platform-config.ts](../../src/domain/platform-config.ts), decides
  whether a chain can be saved, and returns each problem with the stage and field it's about. `saveApprovalChain`
  refuses with the first; the chain editor runs the same function as the admin edits.
- A `team_role` stage may name only the Approver role. The action's input schema accepts nothing else, and
  `validateChain` refuses other roles that are already stored ("The Viewer role can't approve.").
- One person on two stages is refused at the later stage ("Dana Park already reviews stage 2."). Two Approver-role
  stages stay allowed: different people with the role take each.
- A named person must be able to approve: an active team role on some team, and not an Auditor
  (`cannotApprove`, matching `namedApprover` in [permissions.ts](../../src/domain/permissions.ts)). Their team
  doesn't matter, since a named person acts on every team.
- Every check that would stall the chain (no access, an Auditor, one person on two stages, a role other than
  Approver) applies to every named person on every save, whoever added them. A chain naming someone who has since
  lost access can't be saved until that stage names someone else, and the editor shows the reason at that stage as
  soon as it opens.
- Nobody names themselves (`approverProblem`). That rule is about the act of naming, which would let a Platform
  Admin grant themselves approval, so it applies only where the admin saving names themselves: on a new stage, or on
  an existing stage whose reviewer changes to them. A stage another admin already named them on (the same stage id
  in the saved chain) stays theirs, and they can save the rest of the chain. `validateChain` takes the saved chain
  as `current` for this.
- The server hands the editor the facts it needs (`approvers`: platform role and whether each person holds an active
  team role; `viewerId`; the saved stages it already shows), never a refusal ladder of its own. The editor shows
  each problem under its field, and keeps Save disabled with the first problem beside it. An empty name isn't
  flagged at the field while it's being typed.

## Alternatives considered

- **Keep the warning line.** A chain that saves and then stalls every submission is worse than one that can't be
  saved; the warning was easy to miss and nothing stopped the save.
- **Check only newly named people**, as before, so a re-save never fails over someone else's access. The chain
  would still stall on that person, and nobody would find out until a version waited on them.
- **Apply "nobody names themselves" to every stage too.** An admin whom another admin named on a stage would then be
  locked out of the whole chain, though keeping that stage grants them nothing new.
- **Mirror the server's checks in the component.** That is what the settings screens do today
  ([H2](../handoff-review.md#h2--medium-client-components-re-implement-domain-rules)); copies drift. One exported
  function with facts from the read model is the pattern H2 follows next.

## Consequences

- When a named person loses access, every edit to that chain is blocked until their stage changes. The editor says
  so at their stage, so the admin knows what to fix.
- A Platform Admin named on a stage by another admin can edit the rest of that chain, and reorder or rename their
  stage. Putting themselves on any other stage reads as naming themselves, since it's a different stage id.
- A version in review goes through the stages it recorded at submit, and reads only each stage's rule live
  ([0015](0015-a-version-keeps-the-stages-it-was-submitted-with.md)). These checks cover the chain as saved, not
  each version's own stages.
- A person can still lose access after the chain is saved. The chain then stalls until an admin edits it; nothing
  warns the admin before they open the editor.
