# 0043. A file is split when it mixes concerns, not because it passes a line count

Status: Accepted
Date: 2026-10-11

## Context

The [handoff review (H8)](../handoff-review.md#h8--low-oversized-files-and-functions) counted 25 production files over
400 lines. Four of them were in the domain, the part a Java port maps file by file and the part agents copy from:
`lifecycle.ts` (about 1,560 lines), `access.ts` (1,110), `platform-config.ts` (915) and `redline.ts` (875). Each held
several things a reader has to tell apart. `lifecycle.ts` had the shapes, one refusal table and ten transitions,
and `setSunset` sat 450 lines below the `REFUSALS` entries it returns, with the `notify` helper it calls 340 lines
further down. Someone copying a transition, or porting one, read the whole file to find the part that was theirs.

A line count is not the cause. The 400-line `ReviewWorkspace` function was one concern with too many hands in it and
was split into hooks. A 1,000-line file of test fixtures, or of seed templates, is long and has nothing to separate.

## Decision

- **A file is split when it mixes concerns a reader has to tell apart,** not because it passes a line count. The test
  is whether one sentence says what the file holds. A long file that does one thing stays whole. A short file that
  does three things is a candidate.
- **Some files stay long on purpose:** test fixtures, golden files, seed templates, and modules of wire types (the
  `*-types.ts` contracts and `src/contracts`), where length is the number of things declared and there is nothing to
  separate.
- **The four domain files are the example.** Each became a folder of the same name, with one file per concern:
  - `src/domain/lifecycle/`: `types`, `refusals`, `helpers`, then a file per family of transitions (`drafts`,
    `baselines`, `submit`, `request-changes`, `approve`, `sunset`, `revoke`).
  - `src/domain/access/`: `roles`, `refusals`, `inactivity`, `requests`, `members`, `recertification`,
    `consequences`, `sweep`.
  - `src/domain/platform-config/`: `limits`, `refusals`, `effects`, then a file per kind of setting (`teams`,
    `sections`, `channels`, `approval-chains`, `time-zone`) and `contract`.
  - `src/domain/redline/`: the entries (`document`, `channel-fields`) and the engine from the bottom up (`context`,
    `nodes`, `similarity`, `align`, `block-diff`, `inline-diff`).
- **How a split is done:** a pure move, so no exported symbol is renamed and no signature, check or order changes
  (a helper that was private and is now shared is exported). Each refusal table stays whole in one file, with its
  codes and sentences, so `refusals.test.ts` still checks them together. There is no barrel: every import names the
  file that defines the symbol, as for the editor. The folder gets a README that lists its files in reading order.
  A test file moves beside the module it tests, and is split by `describe` where the blocks map onto the new files;
  inputs more than one test file builds go in the folder's `fixtures.ts`, and tests that cross files stay together
  (`lifecycle/transitions.test.ts`).
- **The other long files stay under this rule.** None is split for its length. One that mixes concerns is split when
  someone next works in it, the way these four were.

## Alternatives considered

- **A line limit, enforced by lint** (`max-lines`). It would split at the line that happens to be 400, produce files
  named by their order, and flag the fixtures and seed data that are fine.
- **A barrel `index.ts` per folder,** so no import changes. It hides which file defines what, which is what the split
  is for, and the editor's barrel was removed for the same reason.
- **Documenting the old files with section comments.** They already had banners and a header; a port still maps files.
- **Moving the tests whole.** It would keep `fixtures.ts` out, but then a 2,400-line test sits beside ten files and
  says nothing about which one it checks.

## Consequences

- A new transition, access rule, platform setting or diff stage goes in the file of its family, with its test beside
  it. The folder's README says which file that is.
- About 90 files had an import changed. Import paths like `@/domain/lifecycle` no longer resolve; use the file, such as
  `@/domain/lifecycle/sunset`.
- The domain README's "no shared fixtures" now has four exceptions, the `fixtures.ts` files in these folders.
- The files import in one direction (types, refusals and helpers first), so no module needs another that needs it back.
