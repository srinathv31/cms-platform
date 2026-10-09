# 0018. Settings screens render decisions; the domain makes them

Status: Accepted
Date: 2026-10-09

## Context

The Team and Platform settings screens worked rules out for themselves
([handoff review H2](../handoff-review.md#h2--medium-client-components-re-implement-domain-rules)). The content types
editor ran the server's `updateRequiredSections` on every render with a blank actor and a 1970 date. Create team,
the channel switches and the chain editor's Remove copied the server's refusal ladders. The member, request,
recertification and inactivity strips wrote their own sentences, and two of them worked out deadlines from the
day: a review's due date and the day a kept member is flagged again. Each copy drifts from the rule it copies.

## Decision

- **Who may do what comes decided.** The read model returns `can: { action: PermissionResult }`, the domain's own
  answer run against the real facts and the demo clock. That includes each channel switch (`can.toggle`, from
  `channelRuleRefusal`) and whether a member's roles can change (`changeRoles` dry-run).
- **What an action does comes worded by the domain.** When the line depends only on stored facts (remove, restore,
  suspend or keep a member; approve or deny a request; start a review; remove a member in one), the read model
  returns it as `consequences` beside `can`, from `memberConsequences`, `requestConsequences`,
  `startRecertConsequence` and `recertRemoveConsequence`. How a settled row or a review reads comes the same way
  (`recertItemOutcome`, `recertFootnote`, `heldAsLastAdmin`).
- **What depends on what the admin is typing is a pure domain function the screen calls** with the read model's
  facts: `validateNewTeam` and `newTeamConsequences`, `describeSectionsChange` and `removeSectionRefusal`,
  `describeRoleChange`, `validateDecisionNote`, `removeStageRefusal`, as `validateChain` already was
  ([0008](0008-a-chain-must-be-approvable.md)). The transition the server action runs calls the same function, so
  the screen and the server refuse with the same sentence, in the same order.
- **Dates in those lines come from the function that sets them** (`recertDueAt`, `inactivity`), with `now` from the
  server.
- `src/components/settings/settings-decided.test.tsx` reads every settings component and fails on a refusal
  constant, a clock read, a made-up actor, a permissions import or a domain transition.

## Alternatives considered

- **Every line from the read model, typed ones too.** A typed name or a ticked role would need a server round trip per
  keystroke, or every combination precomputed.
- **Every line from the screen, calling domain functions.** It works while the domain is TypeScript, but a fixed
  line belongs with the facts it's made of. In the read model it's what a Spring Boot read model or a BFF has to
  return, and the read model's tests pin it.
- **Keep running the transitions on the client with stand-in facts.** That's what H2 found: the rule runs with an
  actor and a clock that aren't real, and nothing ties the copy to the action.

## Consequences

- A backend that takes over the read models returns `consequences` as well as `can`, or the BFF fills them in with
  these functions.
- A sentence or a deadline changes in one place. A screen only lays out what it's given (confirm labels, day counts).
- Two visible differences, both the server's answer: Create team now names a too-long description before a reserved
  or taken name, the order `createTeam` refuses in, and Inactivity says "Kept active" only when the sweep recorded
  that it kept the team's last Team Admin, not for every active member past day 120.
