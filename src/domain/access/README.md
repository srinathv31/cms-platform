# `src/domain/access`: who is on a team, and what the clock does about it

Team access as pure rules: asking for access and deciding a request, managing members, quarterly recertification,
inactivity, the clock-driven sweep that applies deadlines, and the sentences the Team settings screens show about
all of them. Every function takes `now` (the demo clock) and returns what to write (`changes`) and what to record
(`effects`); server code applies both in one transaction ([server/actions/access.ts](../../server/actions/access.ts),
[server/access-sweep.ts](../../server/access-sweep.ts)). Its contracts (inputs, effects, limits) are in
[access-types.ts](../access-types.ts).

One file per concern, split by concern ([decision 0043](../../../docs/decisions/0043-split-files-by-concern-not-by-line-count.md)).
There is no barrel: import each export from the file that defines it. They follow the [domain
rules](../README.md#rules).

## Files

In reading order: the vocabulary and the refusal table first, then the facts the rules read, then each rule, then
the sweep that applies the deadlines.

| File | Holds | Exports |
| --- | --- | --- |
| [roles.ts](roles.ts) | The team roles as people read them: labels, order, which can be asked for, and a membership's status word. | `ROLE_LABEL`, `sortRoles`, `rolesLabel`, `firstName`, `isRequestableRole`, `membershipStatusLabel` |
| [refusals.ts](refusals.ts) | `ACCESS_REFUSALS`, the whole refusal table of team access: every code with its sentence, in one place. | `ACCESS_REFUSALS` |
| [inactivity.ts](inactivity.ts) | The inactivity clock: its anchor, the 90-day flag and the 120-day suspension, and whether a flag or a held suspension is already recorded for the current clock. | `inactivity`, `inactivityAnchor`, `flaggedFor`, `suspensionHeld` |
| [requests.ts](requests.ts) | Asking for access (one pending request per team) and deciding it (a denial needs a note, nobody decides their own). | `requestAccess`, `decideAccessRequest`, `validateAccessReason`, `validateDecisionNote`, `requestDecisionRefusal` |
| [members.ts](members.ts) | Managing members: change roles, remove, suspend, keep and reinstate. Nobody changes their own access, and a team keeps at least one active Team Admin. | `changeRoles`, `removeMember`, `suspendInactive`, `keepInactive`, `reinstate`, `validateRoles`, `losesLastAdmin`, `reinstatedSet` |
| [recertification.ts](recertification.ts) | The quarterly review: its phase, who it covers and its progress, starting it, and keeping or removing a member in it. | `startRecert`, `decideRecertItem`, `recertPhase`, `recertSubjects`, `recertProgress`, `recertDueAt`, `quarterLabel` |
| [consequences.ts](consequences.ts) | What the Team settings sections say: each strip's line before the Team Admin confirms, a review's footnote and settled rows, and the roles editor's live line. | `memberConsequences`, `requestConsequences`, `startRecertConsequence`, `recertRemoveConsequence`, `recertFootnote`, `recertItemOutcome`, `describeRoleChange`, `heldAsLastAdmin` |
| [sweep.ts](sweep.ts) | What the clock did since last time: every deadline it has reached, backdated to the instant each was reached. | `sweepAccess` |

Tests sit beside each file. [fixtures.ts](fixtures.ts) holds the inputs more than one test file builds (`at(days)` and
`ago(days)` from a fixed base, memberships, requests, reviews).

## Rules

- Anyone may ask for Viewer, Author or Approver on a team, with a reason. One pending request per team. A Team Admin
  of that team approves or denies (a denial needs a note), never their own.
- Nobody changes their own access, and a team always keeps at least one active Team Admin.
- **Recertification.** Each member (Team Admins aside) is kept or removed by the deadline. Removing ends access at
  once. Anyone still unconfirmed when the deadline arrives lapses AT the deadline (`now >= dueAt`), and the review
  closes.
- **Inactivity.** Measured from the latest of the last sign-in, the date added, and a Team Admin's last Keep (or
  reinstatement). Flagged at 90 days; the Team Admin may Suspend or Keep; suspended automatically at 120 days.
- **Boundaries are inclusive:** the instant a deadline or a day count is reached, it applies.
- **The sweep is idempotent.** Applying its result and sweeping again at the same `now` changes nothing. When the
  clock would end the access of every active Team Admin a team has, the one whose access would end last is kept.
- **Screens render decisions.** The read models fill the consequence lines in with the demo clock's `now`, so a screen
  never words a rule or works out a date itself.
  [decision 0018](../../../docs/decisions/0018-settings-screens-render-decisions.md)
- **A refusal is a code and a sentence.**
  [decision 0025](../../../docs/decisions/0025-refusals-carry-stable-codes.md)

## Copy these

| To… | Copy |
| --- | --- |
| Add an access rule | `requestAccess` in [requests.ts](requests.ts); the form and the server share its limits and `validateAccessReason`. |
| Word what an action does before it is confirmed | `memberConsequences` in [consequences.ts](consequences.ts). |
| Apply a deadline from the clock | `sweepAccess` in [sweep.ts](sweep.ts). |
