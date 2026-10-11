# 0037. An approver views every output before approving, and the server records it

Status: Accepted
Date: 2026-10-10

## Context

Approve never depended on the Preview. The review screen opens on the Document view (a document's body, or an
alert's fields), and an approver could approve without ever seeing what customers get. With five channels that
gap is wide: a version can go live as an SMS or a push notification nobody looked at, and a push looks different
on an iPhone and on an Android phone (the subtitle is iPhone-only, and each phone cuts the text at its own
length). This was the first follow-up of the render work ([handoff review](../handoff-review.md#follow-ups-from-the-render-work)).

A check only in the browser would be a hint: a stale tab, a script, or another client calling the action would
approve without it, and nothing would show afterwards what the approver saw.

## Decision

- **The rule is the domain's** ([review-outputs.ts](../../src/domain/review-outputs.ts)). A version's outputs are
  its enabled channels, with Push counted twice, `push.ios` and `push.android`, since the Preview has a platform
  toggle: `requiredOutputs(channels)`. What is still missing is `missingOutputs(channels, viewed)`, and
  `outputsRefusal` turns it into the refusal `output_not_viewed` (`OUTPUT_REFUSALS`), whose sentence names what's
  left in the Preview's words: "Preview Push (Android) and SMS first."
- **The server enforces it.** `approveVersion` takes `outputsViewed` (output keys, checked by zod). The approve
  transition works out the required outputs from the round's own channels and refuses before writing anything.
  Every approver on every stage is gated. The approval's audit row (`version.stage_approved` or
  `version.activated`) records `outputsViewed`: output keys only, never a value.
- **Request changes is not gated.** An approver can send a version back without looking at everything.
- **An output counts once it has rendered on screen**, in the Preview, for this round: Web and Email when the
  route's output is shown, a PDF when pdf.js has drawn it, Push on the phone picked and SMS when the browser
  rendered them. Picking a tab doesn't count, and neither does a render that failed. `PreviewView` reports each
  through `onViewed`.
- **The browser keeps the set per viewer, version and round** (`useViewedOutputs`), in sessionStorage with every
  read and write in try/catch, so a reload in the same tab doesn't make the approver start over. The viewer is in
  the key so the demo's persona switch, which keeps the tab, doesn't hand one approver's viewing to the next.
- **One function on both sides**, as with `validateChain`: the review screen asks `outputsRefusal` about the set
  and shows Approve blocked (`BlockedButton`) with the same sentence, on the stage's line in the rail and beside
  the stacked layout's bar. The Preview's channel and phone controls check off what has been viewed, a quiet
  status whose room is kept from the start so nothing moves when one appears.

## Alternatives considered

- **A browser-only check.** Quicker, but it's a hint, not a control, and leaves no record. The point is a rule a
  second backend keeps, with a stable code.
- **Recording views on the server as they happen** (a request per output rendered). It would prove more, but costs
  a write per tab switch, and the approval would still have to trust the client's word that the frame was on
  screen. The approval carrying what was viewed, checked and audited in its own transaction, is the same trust
  at one write.
- **Counting a tab as viewed when it is picked.** That would let an approver click through without waiting for the
  output, or count a failed render.
- **One push output.** The two phones render the push differently, and the Preview offers both.

## Consequences

- The approver pages through the Preview's channels (and Push's two phones) once per round, then approves: no
  extra clicks beyond viewing them. A reload keeps the set; a new tab or a new round starts again.
- The server trusts the client's list: it proves the client said it showed them, not that a person read them.
  With real sign-in, a backend could record views as they happen if that proof is needed.
- A version whose output fails to render for every sample set can't be approved until it renders; the approver
  sends it back instead.
- The e2e specs that approve call `viewEveryOutput` (`e2e/helpers/review.ts`) first.
