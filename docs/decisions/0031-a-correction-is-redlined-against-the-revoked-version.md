# 0031. After a revoke, the review redlines the correction against the revoked version

Status: Accepted
Date: 2026-10-09

## Context

The review screen's redline, its "vs vN" label and its change count compared a version with the Active one only.
After the Active version is revoked, Edit starts the correction from the revoked version's content
([decision 0009](0009-correct-a-revoked-version-from-its-content.md)), and nothing is Active while the correction
is in review. So the approver got no redline and no label: the whole document read as new, and they couldn't see
what the correction changed ([handoff review N1](../handoff-review.md#n1--medium-after-a-revoke-the-review-screen-shows-no-redline)).
The rename line on the same screen already compared with the version that still renders (`contractBaseline`).

## Decision

The owner's call: when nothing is Active, the redline compares with the version the draft was based on, the
revoked version the correction started from. The approver is there to check the fix to wrong content, so the
useful comparison is against the text being corrected.

- **With an Active version, nothing changes.** The redline is against it, and none shows on the Active version
  itself.
- **With none Active, the redline is against the released version the draft was based on** (`basedOnVersionId`).
  A draft a change request opened is based on the version sent back, so the walk goes on through those to the
  released one: every round of a correction is redlined against the same revoked text, as every round is against
  the Active version when there is one. A first version sent back for changes reaches nothing released, so it
  still shows no redline.
- **If there is no based-on version** (its row is missing, or the walk ends without a released one), the redline
  falls back to the newest version that still renders (`contractBaseline`), and with nothing rendering, to none,
  as for a first version.
- **The label names the version's state when it isn't Active**: "vs v3 (revoked)", or "vs v1 (superseded)" for
  the fallback. Against the Active version it stays "vs v2".
- `reviewBaseline` in [lifecycle.ts](../../src/domain/lifecycle.ts) decides it, and `getReviewScreen` returns it
  as `baseline` with its state.

## Alternatives considered

- **Compare with `contractBaseline`, as the rename line and the contract changes do.** After a revoke that is an
  older Superseded version, so the redline would show every change since then, the revoked version's own
  (including its wrong text) mixed in with the fix.
- **Compare with the based-on version as it is, without the walk.** In a second round the redline would show only
  what changed since the version sent back, unlike every review with an Active version, and a first version's
  second round would get a redline against text nobody approved.

## Consequences

- The redline and the rename line can name different versions after a revoke: the text is compared with what it
  corrects, the name with what customers get today ([decision 0016](0016-the-name-is-versioned.md)). The contract
  changes still come from submit, against `contractBaseline` (decision 0009).
- The Approve dialog's previous version stays apart: `getReviewScreen` returns it as `previousNumber`, the Active
  version only, so approving a correction still goes live over nothing. What the dialog should say about consumers
  still on a Superseded version is [N3](../handoff-review.md#n3--low-after-a-revoke-approves-consequences-read-as-a-first-version).
- Compare on the Versions tab is unaffected: its default pair is the two newest versions, whatever is Active.
