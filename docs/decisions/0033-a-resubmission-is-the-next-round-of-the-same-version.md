# 0033. A resubmission is the next round of the same version

Status: Accepted
Date: 2026-10-09

## Context

Submit gave each submission the template's highest number + 1, and a send-back kept the version it sent back as a
read-only record. So every send-back used up a number: v1 sent back came back as v2, and a disclosure that went back
and forth ten times was first released as v11. Consumers pin version numbers, and the Library, Usage, the integration
panel, notices and `/api/v1` all show them, so the gaps reached everyone, and v11 read as ten releases that never
happened.

## Decision

The owner's rule: the version number counts releases, what reached customers or will. Each submission for review is
an immutable round of the version it will become.

- **A send-back freezes its round as a record, and the resubmission is the next round of the same number.** Submit
  takes round 1 of the number after the highest released one, or, once that number has rounds, its next round
  (`nextRound` in [rounds.ts](../../src/domain/rounds.ts)): a first submit is v1 round 1, a resubmission after a
  send-back is v1 round 2, and the first submit after v1 goes live is v2 round 1. A Revoked version counts as
  released. Edit skips sent-back rounds, since they are records: with no open draft it starts from the latest
  released version, and that draft's submission is still the next round of the unreleased number.
- **One row per round.** `versions.round` is set at submit with `number` and never changes; a draft has neither.
  Each round keeps its own body, name, writers, recorded stages, approvals and comment threads, frozen and audited,
  as each submission did before. Unique indexes allow one row per (template, number, round) and at most one released
  row (Active, Superseded or Revoked) per number.
- **The word is "Round"**: "v2 · Round 2" where the label stands alone (headings, table cells, queue rows, select
  options), "v2, round 2" inside a sentence (dialog titles, buttons, notifications, audit lines). A round shows only
  once its number has been sent back: an unreleased round shows it when it is Changes requested or past round 1, and
  a released version reads "vN". A version approved on its first try never shows a round. Review history (the
  audit log and Activity for review events, comment threads' origin) names a released version's round too, so
  "approved v2 on round 3"; sunset and revoke events stay "v2". `versionLabel` in rounds.ts writes every label.
- **The Versions tab has one entry per number**, its head: the released row, else the highest round. A version
  released after send-backs says "Approved on round 3", and its rounds sit in a folded "Review history (3 rounds)",
  each with its decision and reason. Compare offers every round, and opens on the two newest versions (each
  number's head).
- **Links.** `/[team]/review/[templateId]/[version]` opens the number's head, and `?round=N` opens that round; a
  round that doesn't exist is a 404. Generated links (notifications, the review queue, the Versions tab) carry
  `?round=` exactly when the label shows the round. Otherwise the bare URL already reaches that row. One exception:
  a stage reviewer outside the template's team may open only the round waiting on their stage and the rounds they
  decided, so when the head is closed to them, the bare URL opens the newest round of that number they may open
  (`requireReviewVersion`). The team always gets the head, and nobody reaches a round they couldn't open by its
  `?round=`.
- **Consumers never see a round.** `/api/v1`, notices, the Library, Usage and the integration panel speak of released
  numbers only. A consumer's number means its head: the released version renders (or answers 410), and an unreleased
  head answers 409 without naming a round. `X-Stencil-Version` is the number. A CMS preview may send `round` to render
  one round; the render route keeps it only with `preview: true`. Previewing a round whose label shows it prints
  "UC-4F7K2Q · v3 · Round 2" in the PDF footer and names the file `UC-4F7K2Q-v3-round-2.pdf`.
- **Approve and Request changes name the round they decide.** A round that is no longer in review, such as round 1
  once round 2 exists, is refused like any decided version. Sunset and revoke take the number and act on its released
  row.
- **Earlier decisions hold per round.** Each round records the approval chain at its own submit, so a stage added
  while round 1 is in review applies from round 2 ([0015](0015-a-version-keeps-the-stages-it-was-submitted-with.md);
  its "one round" is one row). Writers carry from round to round through the draft a send-back opens, so whoever
  wrote round 1 can't decide round 2 ([0007](0007-maker-checker-covers-every-writer.md)). After a revoke, the
  redline's walk back to the revoked version goes through the sent-back rounds
  ([0031](0031-a-correction-is-redlined-against-the-revoked-version.md)).
- **Migration 0008** adds the column and makes every submitted row round 1. Existing numbers stay, because consumers
  have pinned them and the render log and notices hold them. Where an old send-back left an unreleased number above
  every released one (v1 sent back, then v2 in review), the next submission continues that number.

## Alternatives considered

- **Keep a number per submission and fold sent-back versions on the Versions tab.** The tab would read cleanly, but
  released numbers would still jump from v1 to v11, and consumers see those numbers because they pin them.
- **Call it a "revision".** It reads like an edit to the released version, as if it came after v2 went live.
- **Call it a release candidate ("rc").** Clear to developers, not to the business people who write and approve the
  content.
- **One row per number, overwritten by each resubmission.** It loses the frozen record of what an approver sent back,
  and the threads and approvals that point at it. A row per round keeps what numbering each submission was for: every
  submission immutable and audited.
- **Renumber existing versions in the migration.** Consumer pins, the render log and notices hold the old numbers, so
  they would point at different content.

## Consequences

- Released numbers run v1, v2, v3 with no gaps. A database migrated from before keeps its old gaps;
  `npm run db:reset` seeds the new shape (High-Yield Savings v2 approved on round 3, Cash Back v3 in review on
  round 2).
- Code that finds a version by number has to say which row it means: the head, one round, or released rows only.
  Usage reads released rows only, so an unreleased round never stands in for a released number.
- A link written before a send-back has no `?round=`, so afterwards it opens the number's latest round. That is
  intended: the live round is the one that needs attention, and the review history links to every round. A stage
  reviewer outside the team can't open the latest round until it reaches their stage, so until then their stored
  link opens the round they decided rather than a 404.
- The review screen's redline still compares with the Active version (or the review baseline), not with the previous
  round. Compare covers that; a "changes since round 1" view on the review screen is an open question. A round is
  never compared with its own number: once v2 goes live, its sent-back rounds compare with the released version they
  were drafted from (`reviewBaseline`), and show a rename against that version's name.
- `round` is one more CMS-only field on the shared render endpoint, beside `version: "draft"`, and `src/contracts`
  and Coral don't know it. It moves with them when CMS preview gets its own route
  ([A1](../handoff-review.md#a1--high-the-public-consumer-endpoint-also-serves-cms-previews)).
