# 0009. Correct a revoked version from its content

Status: Accepted
Date: 2026-10-08

## Context

Revoke is the emergency stop for wrong legal text, and it's allowed on the Active version. Once two approvers had
revoked it, the template had no Active version, and `planDraftStart` refused Edit with "Only an Active template can
be edited." Nobody could write the correction, so the template was frozen for good
([handoff review D1](../handoff-review.md#d1--high-revoking-the-live-version-freezes-the-template-for-good)). Two
questions had to be answered: what the corrected draft starts from, and what its contract changes are compared with
when nothing is Active.

## Decision

- **Edit is offered when the template's latest version is Revoked**, as it is when the latest is Active.
  `planDraftStart` in [lifecycle.ts](../../src/domain/lifecycle.ts) plans a new draft from it, and the workspace
  shows Edit from the same plan. Nothing else changes: an open draft is still continued, a newer version in review
  still blocks Edit, and a revoke that's only pending leaves the version Active.
- **The corrected draft starts from the revoked version's content**: the body with its block ids (so comment threads
  carry over), variables, channels, the email subject and preheader, and sample sets. Its `basedOnVersionId` is the
  revoked version, so the header reads "Based on v2". `editLatest` (formerly `editActive`, the name
  [decision 0007](0007-maker-checker-covers-every-writer.md) uses) copies it the way Edit copies an Active version,
  and its writers start afresh with the person who pressed Edit.
- **Contract changes compare with the newest version that still renders** (`contractBaseline`): the Active one
  when there is one; otherwise the highest-numbered Superseded version whose sunset hasn't passed; otherwise none,
  the same as a first version. Submit freezes the diff against it, and the submit dialog and the workspace's variable
  flags show the same comparison. Consumers still rendering that version are the ones the changes affect.
- **Approving the correction goes live over nothing.** No version is superseded, the revoked version stays
  Revoked, and consumers get the usual `new_version` notice. The Approve dialog offers no sunset, since there's no
  previous Active version, and the server ignores a sunset date sent without one.

## Alternatives considered

- **Start from the newest version that still renders** (a Superseded one). It would drop every change the revoked
  version made, not just the wrong part, and comment threads on it would be orphaned.
- **Compare contract changes with the revoked version.** No consumer can render it, so the diff would describe a
  contract nobody uses. The consumers that matter are those still on a Superseded version, or none.
- **Reinstate the previous version as Active.** It brings back content nobody reviewed for this situation, and
  skips the approval chain.

## Consequences

- A revoked Active version no longer freezes its template; the fix goes through review like any other version.
- The review screen's redline and its "vs vN" label still compare with the Active version only, so a correction
  after a revoke shows no redline. Its contract changes come from submit, against the baseline above.
- The integration panel's error table no longer assumes an Active version: a `version_sunset` or `version_revoked`
  consumer moves to the Active version, or waits for a new one if none is Active.
